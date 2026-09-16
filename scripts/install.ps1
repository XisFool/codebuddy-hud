# CodeBuddy HUD Windows One-Key Installer
$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "✔ $msg" -ForegroundColor Green }
function Write-ErrorMsg($msg) { Write-Host "✖ $msg" -ForegroundColor Red }

Write-Host "`n🚀 Installing codebuddy-hud...`n" -ForegroundColor Cyan

# 1. Check Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-ErrorMsg "Node.js is not found in PATH. Please install Node.js >= 18.0.0 first: https://nodejs.org"
    exit 1
}
try {
    $nodeVersionRaw = node -v
    $cleanVer = $nodeVersionRaw.TrimStart('v')
    $major = [int]($cleanVer.Split('.')[0])
    if ($major -lt 18) {
        Write-ErrorMsg "Node.js version $nodeVersionRaw is too old. codebuddy-hud requires Node.js >= 18.0.0."
        exit 1
    }
    Write-Success "Found Node.js $nodeVersionRaw"
} catch {
    Write-ErrorMsg "Failed to verify Node.js: $_"
    exit 1
}

# 2. Download bootstrap.js and execute
$TempBootstrap = Join-Path $env:TEMP "codebuddy-hud-bootstrap-$PID.js"
$BootstrapUrl = if ($env:CODEBUDDY_HUD_BOOTSTRAP_URL) {
    $env:CODEBUDDY_HUD_BOOTSTRAP_URL
} elseif ($env:CODEBUDDY_HUD_MIRROR) {
    "$($env:CODEBUDDY_HUD_MIRROR.TrimEnd('/'))/https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/bootstrap.js"
} else {
    "https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/bootstrap.js"
}

try {
    Write-Info "Downloading bootstrap installer..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $BootstrapUrl -OutFile $TempBootstrap -UseBasicParsing
    
    node $TempBootstrap
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Bootstrap installer exited with code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} catch {
    Write-ErrorMsg "Installation failed: $_"
    exit 1
} finally {
    if (Test-Path $TempBootstrap) {
        Remove-Item -Path $TempBootstrap -Force -ErrorAction SilentlyContinue
    }
}

# 3. Auto-register PATH (skip with CODEBUDDY_HUD_NO_PATH=1)
if ($env:CODEBUDDY_HUD_NO_PATH -ne '1') {
    $CodebuddyHome = if ($env:CODEBUDDY_HOME) { $env:CODEBUDDY_HOME } else { Join-Path $env:USERPROFILE '.codebuddy' }
    $BinDir = Join-Path $CodebuddyHome 'codebuddy-hud-runtime\runtime\bin'

    if (Test-Path (Join-Path $BinDir 'codebuddy-hud.cmd')) {
        # Update current session immediately
        if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $BinDir })) {
            $env:PATH = "$BinDir;$env:PATH"
        }

        # Persist to user-level registry (no admin required)
        try {
            $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            if (-not $UserPath) { $UserPath = '' }
            $PathEntries = $UserPath -split ';' | Where-Object { $_.Trim() -ne '' }
            if (-not ($PathEntries | Where-Object { $_ -eq $BinDir })) {
                $NewUserPath = (@($BinDir) + $PathEntries) -join ';'
                [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
                Write-Success "Added to PATH: $BinDir"
                Write-Info "The 'codebuddy-hud' command is available in this and all future terminals."
            }
        } catch {
            Write-Info "Could not persist PATH (non-fatal): $_"
            Write-Info "Current terminal can still use 'codebuddy-hud'; add '$BinDir' to PATH manually for persistence."
        }
    }
}
