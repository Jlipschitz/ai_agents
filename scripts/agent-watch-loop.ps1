param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [Parameter(Mandatory = $true)]
  [string]$CoordinatorScriptPath,
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,
  [Parameter(Mandatory = $true)]
  [int]$IntervalMs,
  [string]$CoordinationRoot = ''
)

$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $WorkspaceRoot

if ($CoordinationRoot) {
  $env:AGENT_COORDINATION_ROOT = $CoordinationRoot
  $env:AGENT_COORDINATION_DIR = ''
}

while ($true) {
  & $NodePath $CoordinatorScriptPath watch-tick --watcher-pid $PID --interval $IntervalMs
  Start-Sleep -Milliseconds $IntervalMs
}
