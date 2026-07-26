#!/usr/bin/env pwsh
# nikcli Windows installer - Windows PowerShell 5.1 and PowerShell 7+.
#
#   irm https://nikcli.store/install.ps1 | iex
#
# Piped invocation cannot pass parameters, so every option is also an
# environment variable:
#   $env:NIKCLI_VERSION         install a specific version (e.g. 1.204.0)
#   $env:NIKCLI_BASELINE        "1" to force the baseline build (pre-AVX2 CPUs)
#   $env:NIKCLI_NO_MODIFY_PATH  "1" to skip the PATH update
#   $env:NIKCLI_INSTALL_DIR     override the install directory

param(
    [string] $Version,
    [switch] $Baseline,
    [switch] $NoModifyPath,
    [string] $InstallDir
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$App = "nikcli"
$AssetPrefix = "nikcli-ai"
$Repo = "nikomatt69/nikcli"

if (-not $Version) { $Version = $env:NIKCLI_VERSION }
if (-not $Version) { $Version = $env:VERSION }
if (-not $InstallDir) { $InstallDir = $env:NIKCLI_INSTALL_DIR }
if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE ".nikcli\bin" }
if ($env:NIKCLI_BASELINE -eq "1") { $Baseline = $true }
if ($env:NIKCLI_NO_MODIFY_PATH -eq "1") { $NoModifyPath = $true }

function Write-Step { param([string] $Message) Write-Host "  $Message" }
function Write-Ok { param([string] $Message) Write-Host "  $Message" -ForegroundColor Green }
function Write-Warn { param([string] $Message) Write-Host "  $Message" -ForegroundColor Yellow }
function Write-Fail { param([string] $Message) Write-Host "  $Message" -ForegroundColor Red }

function Get-Target {
    $machine = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $machine = $env:PROCESSOR_ARCHITEW6432 }
    switch ($machine) {
        "AMD64" { return "x64" }
        "ARM64" { return "arm64" }
    }
    throw "Unsupported architecture '$machine'. nikcli ships x64 and arm64 builds only."
}

function Resolve-LatestVersion {
    $headers = @{ "User-Agent" = "nikcli-installer" }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -UseBasicParsing
    $tag = $release.tag_name
    if (-not $tag) { throw "Could not read the latest release tag from GitHub." }
    return $tag -replace "^v", ""
}

function Save-Asset {
    param([string] $Filename, [string] $ReleaseTag, [string] $Destination)

    $urls = @(
        "https://nikcli.store/releases/download/$ReleaseTag/$Filename",
        "https://github.com/$Repo/releases/download/$ReleaseTag/$Filename"
    )
    foreach ($url in $urls) {
        try {
            $client = New-Object System.Net.WebClient
            $client.Headers.Add("User-Agent", "nikcli-installer")
            $client.DownloadFile($url, $Destination)
            if ((Get-Item $Destination).Length -gt 0) { return $true }
        } catch {
            Write-Warn "download failed from $url"
        } finally {
            if ($client) { $client.Dispose() }
        }
    }
    return $false
}

function Expand-Asset {
    param([string] $Archive, [string] $Destination)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}

function Install-Target {
    param([string] $Target, [string] $ReleaseTag)

    $filename = "$AssetPrefix-windows-$Target.zip"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("nikcli-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tmp | Out-Null

    try {
        $archive = Join-Path $tmp $filename
        Write-Step "downloading $filename"
        if (-not (Save-Asset -Filename $filename -ReleaseTag $ReleaseTag -Destination $archive)) {
            throw "Could not download $filename from either nikcli.store or GitHub."
        }

        Write-Step "extracting"
        $extractDir = Join-Path $tmp "unpacked"
        Expand-Asset -Archive $archive -Destination $extractDir

        $binary = Join-Path $extractDir "bin\$App.exe"
        if (-not (Test-Path $binary)) {
            $binary = Join-Path $extractDir "$AssetPrefix-windows-$Target\bin\$App.exe"
        }
        if (-not (Test-Path $binary)) {
            throw "$App.exe not found inside $filename."
        }

        if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
        $installed = Join-Path $InstallDir "$App.exe"
        Copy-Item -Path $binary -Destination $installed -Force
        return $installed
    } finally {
        Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-Binary {
    param([string] $Path)

    try {
        & $Path --version | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Add-InstallDirToPath {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    $entries = $userPath -split ";" | Where-Object { $_ -ne "" }
    if ($entries -contains $InstallDir) {
        Write-Step "$InstallDir already on PATH"
        return
    }
    $updated = (($entries + $InstallDir) -join ";")
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Ok "added $InstallDir to your user PATH"
    Write-Step "open a new terminal for the PATH change to apply"
}

Write-Host ""
Write-Host "  nikcli installer" -ForegroundColor Cyan
Write-Host ""

$target = Get-Target
if ($Baseline) { $target = "$target-baseline" }

if (-not $Version) {
    Write-Step "resolving latest version"
    $Version = Resolve-LatestVersion
}
$Version = $Version -replace "^v", ""
$releaseTag = "v$Version"
Write-Step "installing $App $Version (windows-$target)"

$installed = Install-Target -Target $target -ReleaseTag $releaseTag

# A non-baseline build dies with an illegal instruction on pre-AVX2 CPUs. The
# failure is silent enough that users read it as "the installer is broken", so
# fall back once instead of leaving a binary that cannot start.
if (-not (Test-Binary -Path $installed)) {
    if ($target -like "*-baseline") {
        Write-Fail "$App.exe failed to run after install"
        exit 1
    }
    Write-Warn "$App.exe failed to run, retrying with the baseline build"
    $installed = Install-Target -Target "$target-baseline" -ReleaseTag $releaseTag
    if (-not (Test-Binary -Path $installed)) {
        Write-Fail "$App.exe failed to run after install"
        exit 1
    }
}

Write-Ok "installed to $installed"

if ($NoModifyPath) {
    Write-Step "PATH not modified - add $InstallDir yourself"
} else {
    Add-InstallDirToPath
}

Write-Host ""
Write-Ok "run '$App' to get started"
Write-Host "  docs: https://nikcli.store/docs"
Write-Host ""
