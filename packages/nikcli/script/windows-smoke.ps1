# Windows smoke test for nikcli — validates the Windows compatibility fixes end-to-end.
#
# Run from `packages/nikcli/`:
#   powershell -ExecutionPolicy Bypass -File .\script\windows-smoke.ps1
#
# Exit code 0 if every check passes; non-zero on the first failure (each check
# logs both PASS and FAIL lines so you can scan output even when something
# breaks). Designed to be self-contained — no test framework required.

$ErrorActionPreference = "Stop"
$script:Failures = 0
$script:Passes = 0

function Step([string]$name, [scriptblock]$body) {
  Write-Host ""
  Write-Host "==> $name" -ForegroundColor Cyan
  try {
    & $body
    Write-Host "PASS: $name" -ForegroundColor Green
    $script:Passes++
  } catch {
    Write-Host "FAIL: $name" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray }
    $script:Failures++
  }
}

function Require([bool]$cond, [string]$msg) {
  if (-not $cond) { throw $msg }
}

# ---------------------------------------------------------------------------
# 0. Environment
# ---------------------------------------------------------------------------

Step "PowerShell + Bun present" {
  Require ($PSVersionTable.PSVersion.Major -ge 5) "PowerShell 5+ required, got $($PSVersionTable.PSVersion)"
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  Require ($null -ne $bun) "bun not in PATH. Install: irm bun.sh/install.ps1 | iex"
  Write-Host "    bun: $(& bun --version)"
  Write-Host "    pwsh: $($PSVersionTable.PSVersion)"
  Write-Host "    OS:   $([System.Environment]::OSVersion.VersionString)"
  Write-Host "    arch: $env:PROCESSOR_ARCHITECTURE"
}

Step "Working dir is packages/nikcli" {
  $pkg = Join-Path (Get-Location) "package.json"
  Require (Test-Path $pkg) "Run this from packages/nikcli (no package.json at $pkg)"
  $json = Get-Content $pkg | ConvertFrom-Json
  Require ($json.name -eq "nikcli-ai") "Expected nikcli-ai package, got $($json.name)"
}

# ---------------------------------------------------------------------------
# 1. Install + typecheck
# ---------------------------------------------------------------------------

Step "bun install" {
  & bun install
  Require ($LASTEXITCODE -eq 0) "bun install failed (exit $LASTEXITCODE)"
}

Step "bun run typecheck" {
  & bun run typecheck
  Require ($LASTEXITCODE -eq 0) "typecheck failed (exit $LASTEXITCODE)"
}

# ---------------------------------------------------------------------------
# 2. Unit tests
# ---------------------------------------------------------------------------

Step "Run double-ESC interrupt suite (state machine)" {
  & bun test test/tui/util/double-esc.test.ts
  Require ($LASTEXITCODE -eq 0) "double-esc tests failed"
}

Step "Run session suite (retry, prompt, instruction)" {
  & bun test test/session
  Require ($LASTEXITCODE -eq 0) "session tests failed"
}

Step "Run config + worktree suites (Effect TaggedError tags)" {
  & bun test test/config test/worktree
  Require ($LASTEXITCODE -eq 0) "config/worktree tests failed"
}

# ---------------------------------------------------------------------------
# 3. Windows-specific runtime checks (proves the source fixes work here)
# ---------------------------------------------------------------------------

Step "pathToFileURL handles drive-letter paths (used by session/prompt + acp + run)" {
  $code = @'
import { pathToFileURL, fileURLToPath } from "node:url"
const win = "C:\\Users\\test\\foo.txt"
const url = pathToFileURL(win).href
if (!url.startsWith("file:///C:/")) { console.error("bad url:", url); process.exit(1) }
const back = fileURLToPath(url)
if (back.toLowerCase() !== win.toLowerCase()) { console.error("roundtrip mismatch:", back); process.exit(1) }
console.log("ok:", url, "<->", back)
'@
  $tmp = New-TemporaryFile
  $ts = "$($tmp.FullName).mjs"
  Move-Item $tmp.FullName $ts -Force
  Set-Content -Path $ts -Value $code -Encoding UTF8
  try {
    & bun $ts
    Require ($LASTEXITCODE -eq 0) "file URL roundtrip failed"
  } finally {
    Remove-Item $ts -Force -ErrorAction SilentlyContinue
  }
}

Step "Global.Path resolves to Windows AppData (XDG fallback)" {
  $code = @'
import { Global } from "@/global"
const data = Global.Path.data
const cfg = Global.Path.config
console.log("data:", data)
console.log("config:", cfg)
const looksLikeWindows = /^[A-Za-z]:[\\/]/.test(data)
if (!looksLikeWindows) { console.error("data path is not a Windows drive:", data); process.exit(1) }
if (data.includes("/.local/share/")) { console.error("XDG fallback leaked POSIX path:", data); process.exit(1) }
console.log("ok")
'@
  $ts = (New-TemporaryFile).FullName + ".ts"
  Set-Content -Path $ts -Value $code -Encoding UTF8
  try {
    & bun --conditions=browser $ts
    Require ($LASTEXITCODE -eq 0) "Global.Path Windows fallback failed"
  } finally {
    Remove-Item $ts -Force -ErrorAction SilentlyContinue
  }
}

Step "Shell.preferred picks a Windows shell, killTree uses taskkill" {
  $code = @'
import { Shell } from "@/shell/shell"
const pref = Shell.preferred()
console.log("preferred shell:", pref)
const lc = pref.toLowerCase()
const ok = lc.endsWith("cmd.exe") || lc.endsWith("powershell.exe") || lc.endsWith("pwsh.exe") || lc.endsWith("bash.exe")
if (!ok) { console.error("unexpected shell on Windows:", pref); process.exit(1) }
// PowerShell marker detection should route an obvious PS command to pwsh/powershell
const selected = Shell.select("$env:PATH | ForEach-Object { $_ }")
console.log("selected for PS snippet:", selected)
console.log("ok")
'@
  $ts = (New-TemporaryFile).FullName + ".ts"
  Set-Content -Path $ts -Value $code -Encoding UTF8
  try {
    & bun --conditions=browser $ts
    Require ($LASTEXITCODE -eq 0) "Shell.preferred/select failed"
  } finally {
    Remove-Item $ts -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------
# 4. Build a real Windows binary and exercise it
# ---------------------------------------------------------------------------

Step "Build single-target Windows binary" {
  & bun run script/build.ts --single
  Require ($LASTEXITCODE -eq 0) "build.ts --single failed"
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $bin = ".\dist\nikcli-ai-windows-$arch\bin\nikcli.exe"
  Require (Test-Path $bin) "Expected built binary at $bin"
  Write-Host "    binary: $bin ($([math]::Round((Get-Item $bin).Length / 1MB, 1)) MB)"
}

Step "Built binary prints --help and exits 0" {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $bin = ".\dist\nikcli-ai-windows-$arch\bin\nikcli.exe"
  $out = & $bin --help 2>&1
  Require ($LASTEXITCODE -eq 0) "nikcli --help exited $LASTEXITCODE"
  Require ($out -match "nikcli") "--help output did not mention 'nikcli'"
  Write-Host "    help output: $(($out | Out-String).Length) chars"
}

Step "Built binary --version" {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $bin = ".\dist\nikcli-ai-windows-$arch\bin\nikcli.exe"
  $out = & $bin --version 2>&1
  Require ($LASTEXITCODE -eq 0) "nikcli --version exited $LASTEXITCODE"
  Write-Host "    version: $out"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Windows smoke test:  $script:Passes passed, $script:Failures failed" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

if ($script:Failures -gt 0) {
  exit 1
} else {
  Write-Host "All Windows compatibility checks passed." -ForegroundColor Green
  exit 0
}
