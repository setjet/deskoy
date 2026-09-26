# Embedded by defender_windows.rs and run as a fixed command. File paths arrive as
# JSON on stdin, never as PowerShell source. Do not emit raw Defender output.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Reply($value) {
    [Console]::Out.Write(($value | ConvertTo-Json -Compress -Depth 8))
}

function NormalPath([string]$value) {
    $value = $value.Trim().Replace('/', '\')
    if ($value.StartsWith('\\?\')) { $value = $value.Substring(4) }
    return $value.ToLowerInvariant()
}

function ResourceMatches([string]$resource, [string]$target) {
    # Defender's file/container resources are delimited, not substring matches.
    foreach ($part in $resource.Split(';')) {
        $candidate = $part.Trim()
        if ($candidate.StartsWith('file:_', [StringComparison]::OrdinalIgnoreCase)) {
            $candidate = $candidate.Substring(6)
        } elseif ($candidate.StartsWith('containerfile:_', [StringComparison]::OrdinalIgnoreCase)) {
            $candidate = $candidate.Substring(15)
        }
        if ((NormalPath $candidate) -eq $target) { return $true }
    }
    return $false
}

function DetectionMatches($detection, [string]$target) {
    foreach ($resource in @($detection.Resources)) {
        if (ResourceMatches ([string]$resource) $target) { return $true }
    }
    return $false
}

function Milliseconds($value) {
    if ($null -eq $value) { return 0L }
    return ([DateTimeOffset]([DateTime]$value)).ToUnixTimeMilliseconds()
}

function EventFields($event) {
    $xml = [xml]$event.ToXml()
    $fields = @{}
    foreach ($item in @($xml.Event.EventData.Data)) {
        $fields[[string]$item.Name] = [string]$item.'#text'
    }
    return $fields
}

try {
    # Restrict module discovery to Windows' protected in-box module directory.
    $systemModules = Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\Modules'
    $env:PSModulePath = $systemModules
    $configManifest = Join-Path $systemModules 'ConfigDefender\ConfigDefender.psd1'
    $legacyManifest = Join-Path $systemModules 'Defender\Defender.psd1'
    $defenderManifest = if (Test-Path -LiteralPath $configManifest -PathType Leaf) { $configManifest } else { $legacyManifest }
    $defenderModule = (Import-Module -Name $defenderManifest -Force -PassThru -ErrorAction Stop).Name
    $securityManifest = Join-Path $systemModules 'Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
    Import-Module -Name $securityManifest -Force -ErrorAction Stop
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $logName = 'Microsoft-Windows-Windows Defender/Operational'
    if ($request.mode -eq 'status') {
        $status = & "$defenderModule\Get-MpComputerStatus" -ErrorAction Stop
        Reply @{ ok = $true; runningMode = [string]$status.AMRunningMode;
            antivirusEnabled = [bool]$status.AntivirusEnabled;
            realTimeEnabled = [bool]$status.RealTimeProtectionEnabled;
            behaviorMonitorEnabled = [bool]$status.BehaviorMonitorEnabled;
            onAccessEnabled = [bool]$status.OnAccessProtectionEnabled;
            downloadScanningEnabled = [bool]$status.IoavProtectionEnabled }
    } elseif ($request.mode -eq 'prepare') {
        $target = NormalPath ([string]$request.path)
        $status = & "$defenderModule\Get-MpComputerStatus" -ErrorAction Stop
        if (-not $status.AMServiceEnabled -or -not $status.AntivirusEnabled -or $status.AMRunningMode -ne 'Normal') {
            Reply @{ ok = $false; error = 'unavailable' }
            exit
        }
        $platform = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'Microsoft\Windows Defender\Platform'
        $candidates = @()
        if (Test-Path -LiteralPath $platform -PathType Container) {
            $versions = @(Get-ChildItem -LiteralPath $platform -Directory | Where-Object {
                $_.Name -match '^\d+\.\d+\.\d+\.\d+-\d+$'
            } | Sort-Object { [Version]($_.Name.Split('-')[0]) } -Descending)
            foreach ($version in $versions) { $candidates += Join-Path $version.FullName 'MpCmdRun.exe' }
        }
        $candidates += Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Windows Defender\MpCmdRun.exe'
        $mpPath = $null
        foreach ($candidate in $candidates) {
            if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
            try {
                $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $candidate -ErrorAction Stop
            } catch {
                # Defender can retain a platform directory while rotating its files.
                # Skip inaccessible/stale candidates and continue to the next signed one.
                continue
            }
            if ($signature.Status -eq 'Valid' -and $null -ne $signature.SignerCertificate -and
                $signature.SignerCertificate.Subject -match '(^|,\s*)O=Microsoft Corporation(,|$)') {
                $mpPath = $candidate
                break
            }
        }
        if ($null -eq $mpPath) {
            Reply @{ ok = $false; error = 'unavailable' }
            exit
        }
        # Check only this path. Preserve the device's configured exclusions.
        & $mpPath '-CheckExclusion' '-Path' ([string]$request.path) *> $null
        $exclusionCode = $LASTEXITCODE
        if ($exclusionCode -eq 0) {
            Reply @{ ok = $false; error = 'excluded' }
            exit
        }
        $exclusionVerified = $exclusionCode -eq 1
        # Fail closed if this user cannot read either evidence source.
        $log = Get-WinEvent -ListLog $logName -ErrorAction Stop
        if (-not $log.IsEnabled) {
            Reply @{ ok = $false; error = 'telemetry' }
            exit
        }
        $cursor = 0L
        if ($log.RecordCount -gt 0) {
            $cursor = [long](Get-WinEvent -LogName $logName -MaxEvents 1 -ErrorAction Stop).RecordId
        }
        $baseline = @(& "$defenderModule\Get-MpThreatDetection" -ErrorAction Stop | ForEach-Object { [string]$_.DetectionID })
        if ($baseline.Count -gt 10000) {
            Reply @{ ok = $false; error = 'telemetry' }
            exit
        }
        Reply @{ ok = $true; mpPath = $mpPath; exclusionVerified = $exclusionVerified;
            cursor = $cursor; baseline = $baseline;
            startedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    } elseif ($request.mode -eq 'collect') {
        $target = NormalPath ([string]$request.path)
        $cursor = [long]$request.cursor
        $startedMs = [long]$request.startedMs
        $baseline = @($request.baseline)
        $events = @()
        try {
            # The only interpolated query value is a parsed integer, not a path.
            $query = "*[System[(EventID=1000 or EventID=1001 or EventID=1002 or EventID=1116 or EventID=1117 or EventID=1118 or EventID=1119) and EventRecordID > $cursor]]"
            $events = @(Get-WinEvent -LogName $logName -FilterXPath $query -MaxEvents 1025 -ErrorAction Stop)
        } catch {
            if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw }
        }
        $log = Get-WinEvent -ListLog $logName -ErrorAction Stop
        $latest = if ($log.RecordCount -gt 0) { [long](Get-WinEvent -LogName $logName -MaxEvents 1).RecordId } else { 0L }
        $telemetry = $log.IsEnabled -and $latest -ge $cursor -and $events.Count -le 1024
        $scanIds = @()
        $completedIds = @()
        $cancelledIds = @()
        $matchingDetectionIds = @()
        $unmatchedDetection = $false
        foreach ($event in $events) {
            $fields = EventFields $event
            if ($event.Id -eq 1000 -and (ResourceMatches ([string]$fields['Scan Resources']) $target)) {
                $scanIds += [string]$fields['Scan ID']
            } elseif ($event.Id -eq 1001) {
                $completedIds += [string]$fields['Scan ID']
            } elseif ($event.Id -eq 1002) {
                $cancelledIds += [string]$fields['Scan ID']
            } elseif ($event.Id -in 1116, 1117, 1118, 1119) {
                if (ResourceMatches ([string]$fields['Path']) $target) {
                    $matchingDetectionIds += [string]$fields['Detection ID']
                } elseif ($event.Id -eq 1116) { $unmatchedDetection = $true }
            }
        }
        $detections = @()
        foreach ($detection in @(& "$defenderModule\Get-MpThreatDetection" -ErrorAction Stop)) {
            $id = [string]$detection.DetectionID
            $fresh = $id -notin $baseline -or $id -in $matchingDetectionIds
            if (-not $fresh) { continue }
            if (DetectionMatches $detection $target) {
                $detections += @{ id = $id; actionSuccess = [bool]$detection.ActionSuccess;
                    status = [int]$detection.ThreatStatusID; error = [long]$detection.ThreatStatusErrorCode;
                    additional = [long]$detection.AdditionalActionsBitMask;
                    remediationMs = (Milliseconds $detection.RemediationTime) }
            } else { $unmatchedDetection = $true }
        }
        $uniqueScans = @($scanIds | Where-Object { $_ } | Select-Object -Unique)
        $oneScan = $uniqueScans.Count -eq 1
        Reply @{ ok = $true; telemetry = [bool]$telemetry; started = $oneScan;
            completed = [bool]($oneScan -and $uniqueScans[0] -in $completedIds);
            cancelled = [bool]($oneScan -and $uniqueScans[0] -in $cancelledIds);
            ambiguous = [bool]($uniqueScans.Count -gt 1 -or $unmatchedDetection);
            detected = [bool]($matchingDetectionIds.Count -gt 0 -or $detections.Count -gt 0);
            detections = $detections }
    } else {
        Reply @{ ok = $false; error = 'probe' }
    }
} catch {
    $denied = $_.Exception -is [UnauthorizedAccessException] -or
        $_.Exception.HResult -eq -2147024891 -or $_.CategoryInfo.Category -eq 'PermissionDenied'
    Reply @{ ok = $false; error = $(if ($denied) { 'permission' } else { 'telemetry' }) }
}
