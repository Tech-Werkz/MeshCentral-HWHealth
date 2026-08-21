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

    // Get the requested plugin action.
    var fnname = null;
    if (typeof args['_'] != 'undefined') {
        fnname = args['_'][1];
    } else if (args.pluginaction) {
        fnname = args.pluginaction;
    }

    if (fnname == null) {
        return;
    }

    // Use the provided session ID or the current session.
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
        // Execute Windows PowerShell.
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

        // Capture PowerShell output.
        child.stdout.str = '';
        child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });

        // Wait for the command to finish.
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
    // Send the result through MeshCentral.
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
    // This plugin supports Windows only.
    if (process.platform !== 'win32') {
        sendResult('healthError', false, null, 'Platform not supported. Windows only.', sessionid, nodeid);
        return;
    }

    // Build the PowerShell hardware health query.
    var psCommand =
    "$ErrorActionPreference = 'SilentlyContinue'; " +

    // Get basic system information.
    "$cs = Get-CimInstance Win32_ComputerSystem; " +
    "$bios = Get-CimInstance Win32_BIOS; " +
    "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; " +
    "$ram = Get-CimInstance Win32_OperatingSystem; " +
    "$batt = Get-CimInstance Win32_Battery | Select-Object -First 1; " +

    // Get CPU temperature from the ACPI thermal zone.
    "$cpuTempRaw = (Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi | Select-Object -First 1).CurrentTemperature; " +
    "if ($cpuTempRaw) { $cpuTemp = [math]::Round(($cpuTempRaw/10)-273.15, 1).ToString() + ' C' } else { $cpuTemp = 'N/A' }; " +

    // Get battery charge and status.
    "if ($batt) { $status = if ($batt.BatteryStatus -eq 2) { 'Charging' } else { 'Not Charging' }; $battSummary = $batt.EstimatedChargeRemaining.ToString() + '% (Status: ' + $status + ')' } else { $battSummary = 'No Battery / Desktop' }; " +

    // Calculate memory usage.
    "$memUsed = [math]::Round(($ram.TotalVisibleMemorySize-$ram.FreePhysicalMemory)/1MB, 2).ToString(); " +
    "$memTotal = [math]::Round($ram.TotalVisibleMemorySize/1MB, 2).ToString(); " +

    // Check if Windows requires a reboot.
    "$rebootReq = if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { 'Yes' } else { 'No' }; " +

    // Check BitLocker status on the C: drive.
    "$bl = Get-WmiObject -Namespace root\\CIMv2\\Security\\MicrosoftVolumeEncryption -Class Win32_EncryptableVolume -Filter \"DriveLetter='C:'\" | Select-Object -First 1; " +
    "$blStatus = if ($bl) { if ($bl.ProtectionStatus -eq 1) { 'Encrypted' } else { 'Not Encrypted / Suspended' } } else { 'Unknown / Off' }; " +

    // Get physical disk information.
    "$disks = Get-PhysicalDisk; " +
    "$diskHealth = if ($disks) { ($disks | ForEach-Object { 'Disk ' + $_.DeviceID + ': ' + $_.FriendlyName + ' | Media Type: ' + $_.MediaType }) -join [Environment]::NewLine } else { 'Unknown' }; " +

    // HDSentinel installation paths.
    "$hdsBasePath = 'C:\\Program Files\\SIDC'; " +
    "$hdsPath = Join-Path $hdsBasePath 'hdsentinel_pro_portable'; " +
    "$hdsZip = Join-Path $hdsBasePath 'hdsentinel_pro_portable.zip'; " +
    "$hdsUrl = 'https://www.harddisksentinel.com/hdsentinel_pro_portable.zip'; " +

    // Download HDSentinel if it is not installed.
    "if (-not (Test-Path $hdsPath)) { " +
        "if (-not (Test-Path $hdsBasePath)) { New-Item -ItemType Directory -Path $hdsBasePath -Force | Out-Null }; " +
        "Invoke-WebRequest -Uri $hdsUrl -OutFile $hdsZip -UseBasicParsing; " +
        "if (Test-Path $hdsZip) { " +
            "Expand-Archive -Path $hdsZip -DestinationPath $hdsPath -Force; " +
            "Remove-Item $hdsZip -Force; " +
        "}; " +
    "}; " +

    // Generate a new HDSentinel report.
    "$hdsExe = Join-Path $hdsPath 'HDSentinel.exe'; " +
    "$hdsDataFolder = Join-Path $hdsPath 'HDSDATA'; " +
    "if (Test-Path $hdsDataFolder) { Remove-Item -Path $hdsDataFolder -Recurse -Force -ErrorAction SilentlyContinue }; " +
    "if (Test-Path $hdsExe) { " +
    "& $hdsExe /REPORT; " +
    "$hdsReport = $null; " +

    // Wait for the report to be created.
    "while (-not $hdsReport) { $hdsReport = Get-ChildItem -Path $hdsDataFolder -Filter '*PRO_report.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $hdsReport) { Start-Sleep -Milliseconds 500 } }; " +
    "}; " +

    // Read the important HDSentinel report lines.
    "$hdsSummary = if ($hdsReport) { (Get-Content -Path $hdsReport.FullName | Select-String 'Physical Disk|Hard Disk Serial Number|Health') -join [Environment]::NewLine } else { 'HDSentinel report not found' }; " +

    // Prepare the final result object.
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

    // Convert the result to compact JSON.
    "$result | ConvertTo-Json -Compress";

    // Run PowerShell and process the result.
    runPowerShell(psCommand, function(err, stdout, stderr) {
        var data = null;
        var isSuccess = false;

        if (stdout && stdout.length > 0) {
            try {
                // Parse the PowerShell JSON response.
                data = JSON.parse(stdout);
                isSuccess = true;
            } catch (e) {
                // JSON parsing failed.
            }
        }

        if (isSuccess) {
            // Send successful health data.
            sendResult('healthData', true, data, null, sessionid, nodeid);
        } else {
            // Build an error message.
            var errorDetails = 'PowerShell Execution Failed. ';
            if (err) errorDetails += 'Exit Code: ' + err + ' | ';
            if (stderr) errorDetails += 'StdErr: ' + stderr + ' | ';
            if (stdout) errorDetails += 'StdOut: ' + stdout;

            // Send the error back to the server.
            sendResult('healthError', false, null, errorDetails, sessionid, nodeid);
        }
    });
}

// Expose the plugin action to MeshCore.
module.exports = { consoleaction: consoleaction };