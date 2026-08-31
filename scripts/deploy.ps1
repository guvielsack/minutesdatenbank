param(
  [string] $ServerHost = '172.24.4.13',
  [string] $User = 'gvielsack',
  [string] $RemotePath = '~/apps/minutesdatenbank',
  [string] $RepoUrl = 'https://github.com/guvielsack/minutesdatenbank.git',
  [string] $ContainerService = 'minutesdatenbank',
  [int] $AppPort = 8002,
  [string] $IdentityFile = '',
  [string] $RemoteName = 'origin',
  [string] $Branch = '',
  [switch] $AutoCommit,
  [string] $CommitMessage = '',
  [string[]] $AutoCommitPaths = @(),
  [switch] $IncludeDocs,
  [switch] $SkipGitPush,
  [switch] $SkipBackup,
  [switch] $AllowDirty
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]] $GitArgs)

  & git @GitArgs
  if ($LASTEXITCODE -ne 0) {
    throw ('git ' + ($GitArgs -join ' ') + ' failed (exit ' + $LASTEXITCODE + ')')
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$resolvedBranch = $Branch.Trim()
if (-not $resolvedBranch) { $resolvedBranch = (& git rev-parse --abbrev-ref HEAD).Trim() }

$defaultPaths = @(
  'app', 'scripts',
  'Dockerfile', 'docker-compose.yml', 'requirements.txt',
  'README.md', 'DEPLOY.md', '.env.example', '.gitignore',
  'Deploy_Server.bat', 'start-minutes-tool.bat'
)
if ($IncludeDocs) { $defaultPaths += 'docs' }
$paths = $AutoCommitPaths
if (-not $paths -or $paths.Count -eq 0) { $paths = $defaultPaths }

$dirty = (& git status --porcelain)
if ($dirty) {
  if ($AutoCommit) {
    Write-Host 'Local changes found; AutoCommit enabled.' -ForegroundColor Cyan
    Write-Host ('AutoCommit paths: ' + ($paths -join ', ')) -ForegroundColor DarkGray
    Invoke-Git (@('add', '--') + $paths)
    & git diff --cached --quiet
    $hasStaged = ($LASTEXITCODE -ne 0)
    if ($hasStaged) {
      $msg = $CommitMessage.Trim()
      if (-not $msg) { $msg = 'Deploy: ' + $resolvedBranch + ' ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') }
      Invoke-Git @('commit', '-m', $msg)
    } else {
      Write-Host 'AutoCommit: nothing to commit.' -ForegroundColor Yellow
    }
  } elseif (-not $AllowDirty) {
    Write-Host 'Git working tree not clean. Commit/stash or use -AllowDirty.' -ForegroundColor Red
    Write-Host $dirty
    exit 1
  }
}

Write-Host ('Local branch: ' + $resolvedBranch) -ForegroundColor Cyan
if (-not $SkipGitPush) {
  Write-Host ('1) git push ' + $RemoteName + ' ' + $resolvedBranch + ' ...')
  Invoke-Git @('push', $RemoteName, $resolvedBranch)
} else {
  Write-Host '1) Skip git push (-SkipGitPush)' -ForegroundColor Yellow
}

$at = [char]64
Write-Host ('2) SSH test: ' + $User + $at + $ServerHost + ' ...')
$sshArgs = @('-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes')
if ($IdentityFile -and (Test-Path -LiteralPath $IdentityFile)) { $sshArgs += @('-i', $IdentityFile) }

ssh @sshArgs ($User + $at + $ServerHost) 'echo SSH_OK; hostname; pwd'
if ($LASTEXITCODE -ne 0) { Write-Host 'SSH failed.' -ForegroundColor Red; exit 1 }

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteParent = $RemotePath.Substring(0, $RemotePath.LastIndexOf('/'))

$remote = New-Object System.Collections.Generic.List[string]
$remote.Add('set -eu')
$remote.Add('if [ ! -d ' + $RemotePath + '/.git ]; then')
$remote.Add('  echo "Initial clone -> ' + $RemotePath + '"')
$remote.Add('  mkdir -p ' + $remoteParent)
$remote.Add('  git clone ' + $RepoUrl + ' ' + $RemotePath)
$remote.Add('fi')
$remote.Add('cd ' + $RemotePath)
$remote.Add('git fetch ' + $RemoteName)
$remote.Add('git reset --hard ' + $RemoteName + '/' + $resolvedBranch)
$remote.Add('docker compose up -d --build')

if (-not $SkipBackup) {
  $backupDb = '/data/backup-pre-deploy-' + $ts + '.db'
  $remote.Add('if docker compose exec -T ' + $ContainerService + ' test -f /data/minutesdatenbank.db; then')
  $remote.Add('  docker compose exec -T ' + $ContainerService + ' python -c ''import sqlite3; src=sqlite3.connect("/data/minutesdatenbank.db"); dst=sqlite3.connect("' + $backupDb + '"); src.backup(dst); src.close(); dst.close(); print("backup_ok")''')
  $remote.Add('else echo backup_skip; fi')
}

$remote.Add('docker compose ps')

$remoteCmd = [string]::Join("`n", $remote)

Write-Host '3) Remote deploy ...'
Write-Host $remoteCmd -ForegroundColor DarkGray

($remoteCmd -replace "`r", "") | ssh @sshArgs ($User + $at + $ServerHost) 'bash -s'
if ($LASTEXITCODE -ne 0) { Write-Host 'Remote deploy failed.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host ('Done. Check app: http://' + $ServerHost + ':' + $AppPort + '/') -ForegroundColor Green
