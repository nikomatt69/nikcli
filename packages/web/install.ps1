# Cache-bust: 2026-07-29T00-00-00Z
# nikcli installer for Windows (PowerShell 5.1+ / pwsh 7+)
#
#   irm https://nikcli.store/install.ps1 | iex
#
# Configuration (env vars, because `iex` cannot forward parameters):
#   $env:NIKCLI_VERSION      install a specific version instead of the latest
#   $env:NIKCLI_INSTALL_DIR  install location (default: $HOME\.nikcli\bin)
#   $env:NIKCLI_NO_PATH      set to 1 to skip modifying the user PATH

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$App = "nikcli"
$AssetPrefix = "nikcli-ai"
$Repo = "nikomatt69/nikcli"

# Windows PowerShell 5.1 still defaults to TLS 1.0, which GitHub refuses.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
  # pwsh 7 negotiates TLS on its own and does not expose this knob.
}

function Write-Rail([string]$Glyph, [string]$Text, [string]$Color) {
  Write-Host "$Glyph  " -ForegroundColor $Color -NoNewline
  Write-Host $Text
}
function Step([string]$Text) { Write-Rail "*" $Text "Cyan" }
function Warn([string]$Text) { Write-Rail "!" $Text "Yellow" }
function Fail([string]$Text) { Write-Rail "x" $Text "Red"; exit 1 }

Write-Host ""
Write-Host "  nikcli installer" -ForegroundColor White
Write-Host ""

# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------

function Get-Arch {
  # PROCESSOR_ARCHITECTURE reports the *process* architecture, so an x86 host
  # process on ARM64 would lie; ARCHITEW6432 and RuntimeInformation do not.
  $native = $env:PROCESSOR_ARCHITEW6432
  if (-not $native) { $native = $env:PROCESSOR_ARCHITECTURE }
  try {
    $os = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    if ($os) { $native = $os }
  } catch {
    # RuntimeInformation is unavailable on Windows PowerShell 5.1 in some hosts.
  }
  switch -Regex ($native) {
    "^(ARM64|Arm64)$" { return "arm64" }
    "^(AMD64|X64|x86_64)$" { return "x64" }
    default { return $null }
  }
}

function Test-Avx2 {
  # PF_AVX2_INSTRUCTIONS_AVAILABLE == 40. Getting this wrong is not a slowdown:
  # an AVX2 build on a CPU without AVX2 dies with an illegal instruction.
  try {
    $kernel = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' -Name "NikcliKernel32" -Namespace "Win32" -PassThru
    return [bool]$kernel::IsProcessorFeaturePresent(40)
  } catch {
    return $false
  }
}

$arch = Get-Arch
if (-not $arch) { Fail "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }

$target = "windows-$arch"
if ($arch -eq "x64" -and -not (Test-Avx2)) {
  $target = "$target-baseline"
  Step "Detected: windows ($arch, no AVX2 - using baseline build)"
} else {
  Step "Detected: windows ($arch)"
}

$filename = "$AssetPrefix-$target.zip"

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------

$requested = $env:NIKCLI_VERSION
if ($requested) {
  $version = $requested.TrimStart("v")
  $tag = "v$version"
  Step "Target version: $version"
} else {
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "nikcli-install" } -UseBasicParsing
    $version = ([string]$release.tag_name).TrimStart("v")
  } catch {
    Fail "Failed to fetch version information: $($_.Exception.Message)"
  }
  if (-not $version) { Fail "Failed to resolve the latest nikcli version" }
  $tag = "v$version"
  Step "Latest version: $version"
}

# GitHub first: nikcli.store does not proxy release assets today, and the bash
# installer keeps it only as a legacy primary.
$urls = @(
  "https://github.com/$Repo/releases/download/$tag/$filename",
  "https://nikcli.store/releases/download/$tag/$filename"
)

# ---------------------------------------------------------------------------
# Install location
# ---------------------------------------------------------------------------

$installDir = $env:NIKCLI_INSTALL_DIR
if (-not $installDir) { $installDir = Join-Path $HOME ".nikcli\bin" }
$targetExe = Join-Path $installDir "$App.exe"

# Same path the bash installer uses under Git Bash, so `nikcli upgrade` keeps
# detecting the standalone install method on both.
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

if (Test-Path $targetExe) {
  try {
    $installed = (& $targetExe --version 2>$null | Select-Object -First 1)
    if ($installed) { $installed = $installed.Trim() }
    if ($installed -eq $version) {
      Step "Version $version already installed"
      Write-Host ""
      exit 0
    }
    if ($installed) { Step "Currently installed: $installed -> $version" }
  } catch {
    # An unreadable or half-written binary just gets replaced below.
  }
}

# ---------------------------------------------------------------------------
# Download + extract
# ---------------------------------------------------------------------------

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("nikcli_install_" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $archive = Join-Path $tmp $filename
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
      if ((Test-Path $archive) -and ((Get-Item $archive).Length -gt 0)) {
        $downloaded = $true
        break
      }
    } catch {
      Remove-Item $archive -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $downloaded) { Fail "Failed to download $filename" }
  Step "Downloaded $filename"

  $extract = Join-Path $tmp "extract"
  try {
    Expand-Archive -Path $archive -DestinationPath $extract -Force
  } catch {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $extract)
  }

  # Archive layout is <triplet>/bin/nikcli.exe today; older releases were flat.
  $found = Get-ChildItem -Path $extract -Filter "$App.exe" -Recurse -File | Select-Object -First 1
  if (-not $found) { Fail "$App.exe not found inside $filename" }

  try {
    Copy-Item -Path $found.FullName -Destination $targetExe -Force
  } catch {
    Fail "Could not write $targetExe - close any running nikcli process and retry. ($($_.Exception.Message))"
  }
  Step "Installed to $targetExe"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# PATH (user scope only - never needs elevation)
# ---------------------------------------------------------------------------

if ($env:NIKCLI_NO_PATH -ne "1") {
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($null -eq $current) { $current = "" }
  $parts = $current -split ";" | Where-Object { $_ -ne "" }
  if ($parts -notcontains $installDir) {
    [Environment]::SetEnvironmentVariable("Path", (($parts + $installDir) -join ";"), "User")
    Step "Added $installDir to your user PATH"
    Warn "Open a new terminal for the PATH change to take effect"
  } else {
    Step "$installDir already on PATH"
  }
  # Make it usable immediately in this session too.
  if (($env:Path -split ";") -notcontains $installDir) {
    $env:Path = "$env:Path;$installDir"
  }
}

Write-Host ""
Write-Host "  nikcli $version installed" -ForegroundColor Green
Write-Host ""
Write-Host "   Next steps"
Write-Host "   cd <project>          # open your project"
Write-Host "   nikcli                # start nikcli"
Write-Host ""
Write-Host "   Docs: https://nikcli.store/docs"
Write-Host ""
