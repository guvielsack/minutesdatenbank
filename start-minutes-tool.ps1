# Minutes-Tool starten (PowerShell-Wrapper)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot
& (Join-Path $ProjectRoot "start-minutes-tool.bat")
