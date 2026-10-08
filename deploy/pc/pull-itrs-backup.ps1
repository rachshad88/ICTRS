<#
  Pulls the newest ITRS backup from the server onto this office PC, so a copy survives if the server dies.
  Runs daily from Task Scheduler. Uses the OpenSSH client and tar.exe built into Windows 10/11.

  ONE-TIME SETUP (PowerShell, as the Windows user who will own the backups):
    1. Make a key just for this job (press Enter twice for no passphrase):
         ssh-keygen -t ed25519 -C itrs-backup-pc -f $env:USERPROFILE\.ssh\itrs_backup
    2. Send the contents of  $env:USERPROFILE\.ssh\itrs_backup.pub  to the ITRS admin. It is added on the
       server limited to downloading backups (see deploy/backup-export.sh); it cannot log in or delete anything.
    3. Copy this script to C:\ITRS-Backups\ and test it once:
         powershell -NoProfile -ExecutionPolicy Bypass -File C:\ITRS-Backups\pull-itrs-backup.ps1
       The first run asks nothing (the server's host key is accepted and remembered) and should log "ok".
    4. Schedule it daily. StartWhenAvailable makes it run as soon as the PC is on if it was off at 9:00:
         $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\ITRS-Backups\pull-itrs-backup.ps1"'
         $t = New-ScheduledTaskTrigger -Daily -At 9:00am
         $s = New-ScheduledTaskSettingsSet -StartWhenAvailable
         Register-ScheduledTask -TaskName 'ITRS backup pull' -Action $a -Trigger $t -Settings $s
  Each backup lands in C:\ITRS-Backups\itrs-<stamp>\ (database, uploads, settings file, latest.json).
  The log is C:\ITRS-Backups\pull.log: "ok", "already have", "WARNING" (server backup is old) or "FAILED".
  The itrs-env-* file holds the database password: keep this folder on this PC only.
#>
param(
    [string]$Server = '192.168.110.28',
    [string]$User = 'user',
    [string]$Key = "$env:USERPROFILE\.ssh\itrs_backup",
    [string]$Dest = 'C:\ITRS-Backups',
    [int]$KeepDays = 30,
    [int]$KeepMonthlyDays = 365
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Log = Join-Path $Dest 'pull.log'

function Write-Log([string]$Message) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $Log -Value $line
    Write-Output $line
}

$incoming = Join-Path $Dest 'incoming'
try {
    if (Test-Path $incoming) { Remove-Item $incoming -Recurse -Force }
    New-Item -ItemType Directory -Path $incoming | Out-Null
    $tarFile = Join-Path $incoming 'download.tar'

    # cmd.exe redirection keeps the bytes exact; PowerShell 5's own > would re-encode the tar as text.
    $ssh = "ssh.exe -i `"$Key`" -o BatchMode=yes -o StrictHostKeyChecking=accept-new $User@$Server"
    cmd.exe /c "$ssh > `"$tarFile`""
    if ($LASTEXITCODE -ne 0) { throw "ssh to $Server failed (exit code $LASTEXITCODE). Is the server on and the key installed?" }

    tar.exe -xf $tarFile -C $incoming
    if ($LASTEXITCODE -ne 0) { throw 'the download could not be unpacked' }
    Remove-Item $tarFile

    $latest = Get-Content (Join-Path $incoming 'latest.json') -Raw | ConvertFrom-Json
    foreach ($file in $latest.files.PSObject.Properties.Value) {
        $path = Join-Path $incoming $file.name
        if (-not (Test-Path $path)) { throw "$($file.name) is missing from the download" }
        $hash = (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLower()
        if ($hash -ne $file.sha256) { throw "$($file.name) arrived damaged (checksum does not match)" }
    }

    $name = 'itrs-' + $latest.stamp
    $target = Join-Path $Dest $name
    if (Test-Path $target) {
        Remove-Item $incoming -Recurse -Force
        Write-Log "already have $name; nothing new on the server"
    } else {
        Rename-Item -Path $incoming -NewName $name
        $counts = ($latest.counts.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' '
        Write-Log "ok: $name ($counts)"
    }

    $age = [DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($latest.created_at)
    if ($age.TotalDays -gt 2) {
        Write-Log ("WARNING: the newest backup on the server is {0:N0} days old; its nightly backup may have stopped" -f $age.TotalDays)
    }

    # Keep KeepDays of daily copies, and the first backup of each month for KeepMonthlyDays.
    foreach ($dir in Get-ChildItem -Path $Dest -Directory) {
        if ($dir.Name -notmatch '^itrs-(\d{8})-\d{4}$') { continue }
        $stampDay = $Matches[1]
        $day = [DateTime]::ParseExact($stampDay, 'yyyyMMdd', [Globalization.CultureInfo]::InvariantCulture)
        $days = ((Get-Date) - $day).TotalDays
        $monthly = $stampDay.EndsWith('01')
        if (($monthly -and $days -gt $KeepMonthlyDays) -or (-not $monthly -and $days -gt $KeepDays)) {
            Remove-Item $dir.FullName -Recurse -Force
            Write-Log "removed old $($dir.Name)"
        }
    }
} catch {
    Write-Log "FAILED: $($_.Exception.Message)"
    exit 1
}
