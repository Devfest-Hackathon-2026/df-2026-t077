param([Alias('Profile')][ValidateSet('frontend','backend','full')][string]$SetupProfile = 'frontend')
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskVersions = Get-Content -LiteralPath (Join-Path $taskRepo 'tools/versions.json') -Raw | ConvertFrom-Json
Push-Location $taskRepo
try {
    $taskVolta = Get-Command volta -ErrorAction SilentlyContinue
    if ($taskVolta) {
        & $taskVolta.Source run --node $taskVersions.node --npm $taskVersions.npm npm run setup -- $SetupProfile
    } else {
        $taskNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $taskNpm) { throw 'Install Volta (recommended) or the pinned Node/npm versions, reopen the terminal and rerun.' }
        & $taskNpm.Source run setup -- $SetupProfile
    }
    if ($LASTEXITCODE -ne 0) { throw 'Setup failed. Resolve the displayed error and rerun; existing .env files are preserved.' }
} finally { Pop-Location }
