# LORE Install Script for Windows (PowerShell)
# Usage: .\install.ps1 [-Dev] [-Uninstall] [-Update]
#
# -Dev:       Editable install (changes to source are live immediately)
# -Uninstall: Remove LORE installation
# -Update:    Pull latest from git and reinstall
#
# Creates a virtual environment at %APPDATA%\lore\venv
# Installs a 'lore' wrapper script at %APPDATA%\Python\Scripts or %USERPROFILE%\bin

param(
    [switch]$Dev,
    [switch]$Uninstall,
    [switch]$Update
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:APPDATA "lore"
$VenvDir = Join-Path $InstallDir "venv"

# --- Uninstall ---
if ($Uninstall) {
    Write-Host "=== Uninstalling LORE ===" -ForegroundColor Cyan
    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
        Write-Host "  Removed: $InstallDir"
    }
    # Remove wrapper scripts
    $wrapperPaths = @(
        (Join-Path $env:APPDATA "Python\Scripts\lore.exe"),
        (Join-Path $env:APPDATA "Python\Scripts\lore.cmd"),
        (Join-Path $env:USERPROFILE "bin\lore.cmd")
    )
    foreach ($p in $wrapperPaths) {
        if (Test-Path $p) {
            Remove-Item -Force $p
            Write-Host "  Removed: $p"
        }
    }
    Write-Host "`n✅ LORE uninstalled." -ForegroundColor Green
    exit 0
}

# --- Update ---
if ($Update) {
    Write-Host "=== Updating LORE ===" -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $ScriptDir ".git"))) {
        Write-Host "Error: -Update requires a git repository." -ForegroundColor Red
        Write-Host "Clone first: git clone https://github.com/tbox99/lore.git"
        exit 1
    }
    Write-Host "Pulling latest changes..."
    Push-Location $ScriptDir
    git pull
    Pop-Location
    Write-Host ""
    # Fall through to reinstall
}

Write-Host "=== LORE Install Script (Windows) ===" -ForegroundColor Cyan
Write-Host ""

# Check Python
$pythonCmd = $null
foreach ($cmd in @("python3", "python")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonCmd = $cmd
            break
        }
    } catch { }
}

if (-not $pythonCmd) {
    Write-Host "Error: Python not found. Install Python 3.10+ from https://python.org" -ForegroundColor Red
    Write-Host "Make sure to check 'Add Python to PATH' during installation." -ForegroundColor Yellow
    exit 1
}

# Check Python version
$versionLine = & $pythonCmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1
$versionParts = $versionLine -split '\.'
$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]

Write-Host "Python: $versionLine"

if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) {
    Write-Host "Error: Python 3.10+ required, found $versionLine" -ForegroundColor Red
    exit 1
}

# Create venv
if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating virtual environment..."
    & $pythonCmd -m venv $VenvDir
} else {
    Write-Host "Using existing virtual environment"
}

# Activate venv
$activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
. $activateScript

# Install
if ($Dev) {
    Write-Host "Installing LORE (editable/development mode)..."
    pip install --upgrade pip
    pip install -e "$ScriptDir[dev]"
} else {
    Write-Host "Installing LORE..."
    pip install --upgrade pip
    pip install -e $ScriptDir
}

# Verify lore command exists in venv
$loreExe = Join-Path $VenvDir "Scripts\lore.exe"
if (-not (Test-Path $loreExe)) {
    # Try lore.cmd
    $loreCmd = Join-Path $VenvDir "Scripts\lore.cmd"
    if (-not (Test-Path $loreCmd)) {
        Write-Host ""
        Write-Host "Error: 'lore' command not found after installation." -ForegroundColor Red
        exit 1
    }
}

# Create wrapper script in a user-local bin directory
$BinDir = Join-Path $env:USERPROFILE "bin"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}

$wrapperPath = Join-Path $BinDir "lore.cmd"
$venvLore = Join-Path $VenvDir "Scripts\lore.exe"
if (Test-Path $venvLore) {
    # Direct wrapper to venv lore.exe
    @"
@echo off
REM LORE wrapper - runs lore from virtual environment
"$venvLore" %*
"@ | Set-Content -Path $wrapperPath -Encoding ASCII
} else {
    # Fallback: activate venv and run
    $venvActivate = Join-Path $VenvDir "Scripts\activate.bat"
    @"
@echo off
REM LORE wrapper - activates venv and runs lore
call "$venvActivate"
lore %*
"@ | Set-Content -Path $wrapperPath -Encoding ASCII
}

# Also try to copy to Python Scripts if accessible
$pythonScripts = Join-Path $env:APPDATA "Python\Scripts"
if (Test-Path $pythonScripts) {
    Copy-Item -Path $wrapperPath -Destination (Join-Path $pythonScripts "lore.cmd") -Force -ErrorAction SilentlyContinue
}

# PATH check
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    Write-Host ""
    Write-Host "⚠️  $BinDir is not in your PATH." -ForegroundColor Yellow
    Write-Host "   Run this to add it:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   `$env:Path += `";$BinDir`"" -ForegroundColor White
    Write-Host "   # Or permanently:" -ForegroundColor Yellow
    Write-Host "   [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + `";$BinDir`", 'User')" -ForegroundColor White
}

# Verify
Write-Host ""
Write-Host "Verifying..."
$version = & $pythonCmd -c "import importlib.metadata; print(importlib.metadata.version('lore'))" 2>$null
if ($LASTEXITCODE -ne 0) { $version = "unknown" }
Write-Host "✅ LORE $version installed" -ForegroundColor Green
Write-Host "   Command:  lore"
Write-Host "   Venv:     $VenvDir"
if ($Dev) {
    Write-Host "   Mode:     development (editable)"
    Write-Host "   Source:   $ScriptDir"
} else {
    Write-Host "   Mode:     production"
}
Write-Host ""
Write-Host "Update:  .\install.ps1 -Update"
Write-Host "   or:   git pull; .\install.ps1"