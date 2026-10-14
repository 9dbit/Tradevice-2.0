# Dedicated read-only console; never accepts or dispatches trading commands.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'TRADEVICE | Read-only engine journal'
& 'D:\GoldTrapCore\.venv\Scripts\python.exe' -u (Join-Path $PSScriptRoot 'viewer.py') --publish
exit $LASTEXITCODE
