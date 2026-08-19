/**
 * @description MeshCentral HW Health Plugin - Agent Side
 * @note Runs in MeshCore (duktape) - ES5 compliant. All code and comments in English.
 */

"use strict";

var mesh;
var obj = this;

/**
 * Main consoleaction handler - receives commands routed from the server
 */
function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    
    var fnname = null;
    if (typeof args['_'] != 'undefined') {
        fnname = args['_'][1];
    } else if (args.pluginaction) {
        fnname = args.pluginaction;
    }

    if (fnname == null) {
        return;
    }

    var currentSessionid = args.sessionid || sessionid;

    switch (fnname) {
        case 'getHealth':
            doGetHealth(currentSessionid, args.nodeid);
            break;
        default:
            break;
    }
}

/**
 * Executes a PowerShell command synchronously using waitExit()
 */
function runPowerShell(command, callback) {
    var Xerr = null;
    var Xstdout = null;
    var Xstderr = null;
    
    try {
        var child = require('child_process').execFile(
            process.env['windir'] + '\\system32\\WindowsPowerShell\\v1.0\\powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
            { cwd: process.env['TEMP'] },
            function(err, stdout, stderr) {
                Xerr = err;
                Xstdout = stdout;
                Xstderr = stderr;
            }
        );
        
        child.stdout.str = '';
        child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        child.waitExit();

        Xstdout = child.stdout.str.trim();
        callback(Xerr, Xstdout, Xstderr);
    } catch (e) {
        callback(e, null, null);
    }
}

/**
 * Packages and sends the final result back to the server for routing
 */
function sendResult(action, success, data, message, sessionid, nodeid) {
    mesh.SendCommand({
        action: 'plugin',
        plugin: 'hwhealth',
        pluginaction: action, 
        success: success,
        data: data,
        message: message,
        sessionid: sessionid,
        nodeid: nodeid
    });
}

/**
 * Collects hardware telemetry via PowerShell
 */
function doGetHealth(sessionid, nodeid) {
    if (process.platform !== 'win32') {
        sendResult('healthError', false, null, 'Platform not supported. Windows only.', sessionid, nodeid);
        return;
    }

    // PowerShell script strictly using single quotes
    // Added: Pending Reboot, BitLocker Status, Disk Health
   var psCommand =
    "$ErrorActionPreference = 'SilentlyContinue'; " +
    "$cs = Get-CimInstance Win32_ComputerSystem; " +
    "$bios = Get-CimInstance Win32_BIOS; " +
    "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; " +
    "$ram = Get-CimInstance Win32_OperatingSystem; " +
    "$batt = Get-CimInstance Win32_Battery | Select-Object -First 1; " +

    "$cpuTempRaw = (Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi | Select-Object -First 1).CurrentTemperature; " +
    "if ($cpuTempRaw) { $cpuTemp = [math]::Round(($cpuTempRaw/10)-273.15, 1).ToString() + ' C' } else { $cpuTemp = 'N/A' }; " +

    "if ($batt) { " +
    "  $status = switch ($batt.BatteryStatus) { 3 { 'Fully Charged' } 4 { 'Low' } 5 { 'Critical' } 6 { 'Charging' } 7 { 'Charging (High)' } 8 { 'Charging (Low)' } 9 { 'Charging (Critical)' } 11 { 'Partially Charged' } 2 { 'Unknown' } 1 { 'Other' } default { 'Unknown' } }; " +
    "  $staticBatt = Get-WmiObject -Namespace root/wmi -Class BatteryStaticData | Select-Object -First 1; " +
    "  $fullBatt = Get-WmiObject -Namespace root/wmi -Class BatteryFullChargedCapacity | Select-Object -First 1; " +
    "  $designCap = $staticBatt.DesignedCapacity; " +
    "  $fullCap = $fullBatt.FullChargedCapacity; " +
    "  if ($designCap -and $fullCap -and $designCap -gt 0) { " +
    "    $wearLevel = [math]::Round((1 - ($fullCap / $designCap)) * 100, 1); " +
    "    $wearLevel = [math]::Min(100, [math]::Max(0, $wearLevel)); " +
    "    $wearText = ' (Wear level: ' + $wearLevel.ToString() + '%)'; " +
    "  } else { " +
    "    $wearText = ' (Wear level: N/A)'; " +
    "  }; " +
    "  $charge = if ($null -ne $batt.EstimatedChargeRemaining) { $batt.EstimatedChargeRemaining.ToString() + '%' } else { 'N/A' }; " +
    "  $battSummary = $charge + ' (Status: ' + $status + ')' + $wearText; " +
    "} else { " +
    "  $battSummary = 'No Battery / Desktop'; " +
    "}; " +

    "$memUsed = [math]::Round(($ram.TotalVisibleMemorySize-$ram.FreePhysicalMemory)/1MB, 2).ToString(); " +
    "$memTotal = [math]::Round($ram.TotalVisibleMemorySize/1MB, 2).ToString(); " +

    "$rebootReq = if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { 'Yes' } else { 'No' }; " +

    "$bl = Get-WmiObject -Namespace root\\CIMv2\\Security\\MicrosoftVolumeEncryption -Class Win32_EncryptableVolume -Filter \"DriveLetter='C:'\" | Select-Object -First 1; " +
    "$blStatus = if ($bl) { if ($bl.ProtectionStatus -eq 1) { 'Encrypted' } else { 'Not Encrypted / Suspended' } } else { 'Unknown / Off' }; " +

    "$disks = Get-PhysicalDisk; " +
    "$diskHealth = if ($disks) { ($disks | ForEach-Object { 'Disk ' + $_.DeviceID + ': ' + $_.FriendlyName + ' | Serial: ' + $_.SerialNumber }) -join [Environment]::NewLine } else { 'Unknown' }; " +

    // Download and extract HDSentinel only when not already installed
    "$hdsBasePath = 'C:\\Program Files\\SIDC'; " +
    "$hdsPath = Join-Path $hdsBasePath 'hdsentinel_pro_portable'; " +
    "$hdsZip = Join-Path $hdsBasePath 'hdsentinel_pro_portable.zip'; " +
    "$hdsUrl = 'https://www.harddisksentinel.com/hdsentinel_pro_portable.zip'; " +

    "if (-not (Test-Path $hdsPath)) { " +
        "if (-not (Test-Path $hdsBasePath)) { New-Item -ItemType Directory -Path $hdsBasePath -Force | Out-Null }; " +
        "Invoke-WebRequest -Uri $hdsUrl -OutFile $hdsZip -UseBasicParsing; " +
        "if (Test-Path $hdsZip) { " +
            "Expand-Archive -Path $hdsZip -DestinationPath $hdsPath -Force; " +
            "Remove-Item $hdsZip -Force; " +
        "}; " +
    "}; " +

    "$hdsExe = Join-Path $hdsPath 'HDSentinel.exe'; " +
    "$hdsDataFolder = Join-Path $hdsPath 'HDSDATA'; " +
    "if (Test-Path $hdsDataFolder) { Remove-Item -Path $hdsDataFolder -Recurse -Force -ErrorAction SilentlyContinue }; " +
    "if (Test-Path $hdsExe) { " +
        "& $hdsExe /REPORT; " +
        "$waitCount = 0; " +
        "while (-not (Get-ChildItem -Path $hdsDataFolder -Filter 'HDSentinel_* PRO_report.txt' -File -ErrorAction SilentlyContinue) -and $waitCount -lt 60) { Start-Sleep -Milliseconds 500; $waitCount++ }; " +
    "}; " +
    "$hdsReport = Get-ChildItem -Path $hdsDataFolder -Filter 'HDSentinel_* PRO_report.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; " +
    "$hdsSummary = if (Test-Path $hdsReport) { (Get-Content $hdsReport | Select-String 'Physical Disk|Health') -join [Environment]::NewLine } else { 'HDSentinel report not found' }; " +
    
    // Prepare the final result object

    "$result = @{ " +
    "computerName = $cs.Name; " +
    "manufacturer = $cs.Manufacturer; " +
    "model = $cs.Model; " +
    "serialNumber = $bios.SerialNumber; " +
    "biosVersion = $bios.SMBIOSBIOSVersion; " +
    "cpuName = $cpu.Name; " +
    "cpuLoad = $cpu.LoadPercentage.ToString() + '%'; " +
    "cpuTemp = $cpuTemp; " +
    "memorySummary = $memUsed + ' GB Used / ' + $memTotal + ' GB Total'; " +
    "batterySummary = $battSummary; " +
    "pendingReboot = $rebootReq; " +
    "bitlockerStatus = $blStatus; " +
    "diskHealth = $diskHealth; " +
    "hdsentinel = $hdsSummary; " +
    "collectedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') " +
    "}; " +
    
    "$result | ConvertTo-Json -Compress";

    runPowerShell(psCommand, function(err, stdout, stderr) {
        var data = null;
        var isSuccess = false;

        if (stdout && stdout.length > 0) {
            try {
                data = JSON.parse(stdout);
                isSuccess = true;
            } catch (e) {
                // Parsing failed
            }
        }

        if (isSuccess) {
            sendResult('healthData', true, data, null, sessionid, nodeid);
        } else {
            var errorDetails = 'PowerShell Execution Failed. ';
            if (err) errorDetails += 'Exit Code: ' + err + ' | ';
            if (stderr) errorDetails += 'StdErr: ' + stderr + ' | ';
            if (stdout) errorDetails += 'StdOut: ' + stdout;
            
            sendResult('healthError', false, null, errorDetails, sessionid, nodeid);
        }
    });
}

// Expose functions to the MeshCore engine
module.exports = { consoleaction: consoleaction };
