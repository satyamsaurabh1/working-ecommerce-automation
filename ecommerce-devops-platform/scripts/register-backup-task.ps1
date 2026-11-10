#Requires -Version 7.0
<#
.SYNOPSIS  Registers a daily 02:00 backup in Windows Task Scheduler (current user, no admin rights).
.EXAMPLE   pwsh ./scripts/register-backup-task.ps1      # remove with -Unregister
#>
param([string]$At = '02:00', [int]$RetentionDays = 7, [switch]$Unregister)
$ErrorActionPreference = 'Stop'
$taskName = 'ecommerce-mongodb-backup'
if (-not $IsWindows) { throw "Task Scheduler is Windows-only. On Linux use cron: 0 2 * * * pwsh /path/scripts/backup.ps1" }

if ($Unregister) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host "Removed $taskName"; return }

$script = Join-Path $PSScriptRoot 'backup.ps1'
$log = Join-Path (Split-Path $PSScriptRoot -Parent) 'backups/backup-task.log'
$action = New-ScheduledTaskAction -Execute 'pwsh.exe' `
    -Argument "-NoProfile -NonInteractive -Command `"& '$script' -RetentionDays $RetentionDays *>> '$log'`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "[OK]   Registered '$taskName': daily at $At, keeps $RetentionDays days, log: $log"
Write-Host "       Test it now: Start-ScheduledTask -TaskName $taskName"
