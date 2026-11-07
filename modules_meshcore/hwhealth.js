/**
 * @description MeshCentral HW Health Plugin - Agent Side
 * @note Runs in MeshCore (duktape) - ES5 compliant. All code and comments in English.
 */

"use strict";

var mesh;
var obj = this;

// Guards against overlapping scans on this agent (auto-expires so it can never get stuck)
var scanBusy = false;
var scanStart = 0;

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
 * Executes a PowerShell script synchronously using waitExit().
 * The script is written to a temp .ps1 file and run with -File, because very long
 * -Command strings (about 4 KB and up) get corrupted by the MeshAgent command line handling.
 */
function runPowerShell(command, callback) {
    var Xerr = null;
    var Xstdout = null;
    var Xstderr = null;
    var tmpFile = null;
    var fs = null;

    try {
        var psArgs = null;
        try {
            fs = require('fs');
            tmpFile = process.env['TEMP'] + '\\hwhealth_' + Date.now() + '_' + Math.floor(Math.random() * 100000) + '.ps1';
            fs.writeFileSync(tmpFile, command);
            psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile];
        } catch (e) {
            tmpFile = null;
            if (command.length > 3500) {
                callback('Could not write the temporary script file: ' + e, null, null);
                return;
            }
            psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command];
        }

        // Execute Windows PowerShell.
        var child = require('child_process').execFile(
            process.env['windir'] + '\\system32\\WindowsPowerShell\\v1.0\\powershell.exe',
            psArgs,
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
        try { child.stderr.str = ''; child.stderr.on('data', function (chunk) { this.str += chunk.toString(); }); } catch (e) {}

        // Wait for the command to finish.
        child.waitExit();

        Xstdout = child.stdout.str.trim();
        try { if (child.stderr && child.stderr.str) { Xstderr = child.stderr.str.trim(); } } catch (e) {}
        try { if (tmpFile) { fs.unlinkSync(tmpFile); } } catch (e) {}
        callback(Xerr, Xstdout, Xstderr);
    } catch (e) {
        try { if (tmpFile && fs) { fs.unlinkSync(tmpFile); } } catch (e2) {}
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
 * Battery health from the powercfg battery report. Runs as a separate PowerShell call
 * so a failure here can never break the main hardware report.
 */
function getBatteryHealth(callback) {
    var psBattery =
    "$ErrorActionPreference = 'Stop'; " +
    "$r = @{ batteryHealth = ''; batteryWear = ''; batteryHealthStatus = 'Unknown'; batteryCapacity = '' }; " +
    "try { " +
        "$rp = Join-Path $env:TEMP 'battery-report.html'; " +
        "powercfg /batteryreport /output $rp | Out-Null; " +
        "$bhtml = Get-Content $rp -Raw; " +
        "Remove-Item $rp -Force; " +
        "$dm = [regex]::Match($bhtml, '(?is)DESIGN CAPACITY</span>\\s*</td>\\s*<td[^>]*>\\s*([\\d,]+)\\s*mWh'); " +
        "$fm = [regex]::Match($bhtml, '(?is)FULL CHARGE CAPACITY</span>\\s*</td>\\s*<td[^>]*>\\s*([\\d,]+)\\s*mWh'); " +
        "if ($dm.Success -and $fm.Success) { " +
            "$design = [double]($dm.Groups[1].Value -replace ',', ''); " +
            "$full = [double]($fm.Groups[1].Value -replace ',', ''); " +
            "$h = [math]::Round(($full / $design) * 100, 2); " +
            "$r.batteryHealth = $h.ToString() + '%'; " +
            "$r.batteryWear = [math]::Round(100 - $h, 2).ToString() + '%'; " +
            "$r.batteryCapacity = 'Full ' + $full + ' / Design ' + $design + ' mWh'; " +
            "if ($h -ge 90) { $r.batteryHealthStatus = 'Excellent' } elseif ($h -ge 80) { $r.batteryHealthStatus = 'Good' } elseif ($h -ge 70) { $r.batteryHealthStatus = 'Degraded' } else { $r.batteryHealthStatus = 'Poor' }; " +
        "} else { $r.batteryHealth = 'Unable to extract battery capacity from the report' }; " +
    "} catch { $r.batteryHealth = 'Error: ' + $_.Exception.Message }; " +
    "$r | ConvertTo-Json -Compress";

    runPowerShell(psBattery, function (err, stdout, stderr) {
        var bd = null;
        try {
            // Tolerate stray text around the JSON
            var i = stdout.indexOf('{'), j = stdout.lastIndexOf('}');
            bd = JSON.parse(stdout.substring(i, j + 1));
        } catch (e) {}
        callback(bd);
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

    // Block overlapping scans (a stale lock older than 2.5 minutes is ignored)
    if (scanBusy && (Date.now() - scanStart) < 150000) {
        sendResult('healthError', false, null, 'A scan is already running on this device.', sessionid, nodeid);
        return;
    }
    scanBusy = true;
    scanStart = Date.now();

    // Releases the lock and sends the result back
    function finish(action, success, data, message) {
        scanBusy = false;
        sendResult(action, success, data, message, sessionid, nodeid);
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
    "$cpuTempRaw = (Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -OperationTimeoutSec 5 | Select-Object -First 1).CurrentTemperature; " +
    "if ($cpuTempRaw) { $cpuTemp = [math]::Round(($cpuTempRaw/10)-273.15, 1).ToString() + ' C' } else { $cpuTemp = 'N/A' }; " +

    // Get battery charge and status (null-safe casts so VMs/odd hardware cannot break the scan).
    "if ($batt) { $status = if ($batt.BatteryStatus -eq 2) { 'Charging' } else { 'Not Charging' }; $battSummary = [string]$batt.EstimatedChargeRemaining + '% (Status: ' + $status + ')' } else { $battSummary = 'No Battery / Desktop' }; " +

    // Calculate memory usage.
    "$memUsed = [math]::Round(($ram.TotalVisibleMemorySize-$ram.FreePhysicalMemory)/1MB, 2).ToString(); " +
    "$memTotal = [math]::Round($ram.TotalVisibleMemorySize/1MB, 2).ToString(); " +

    // Check if Windows requires a reboot.
    "$rebootReq = if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { 'Yes' } else { 'No' }; " +

    // Check BitLocker status on the C: drive.
    "$bl = Get-CimInstance -Namespace root\\CIMv2\\Security\\MicrosoftVolumeEncryption -ClassName Win32_EncryptableVolume -Filter \"DriveLetter='C:'\" -OperationTimeoutSec 10 | Select-Object -First 1; " +
    "$blStatus = if ($bl) { if ($bl.ProtectionStatus -eq 1) { 'Encrypted' } else { 'Not Encrypted / Suspended' } } else { 'Unknown / Off' }; " +

    // Get physical disk information.
    "$disks = Get-PhysicalDisk; " +
    "$diskHealth = if ($disks) { ($disks | ForEach-Object { 'Disk ' + $_.DeviceID + ': ' + $_.FriendlyName + ' | Media Type: ' + $_.MediaType }) -join [Environment]::NewLine } else { 'Unknown' }; " +

    // HDSentinel installation paths.
    "$hdsBasePath = 'C:\\Program Files\\SIDC'; " +
    "$hdsPath = Join-Path $hdsBasePath 'hdsentinel_pro_portable'; " +
    "$hdsZip = Join-Path $hdsBasePath 'hdsentinel_pro_portable.zip'; " +
    "$hdsUrl = 'https://www.harddisksentinel.com/hdsentinel_pro_portable.zip'; " +

    // Download HDSentinel if it is not installed, but never block the full scan for it.
    "if (-not (Test-Path $hdsPath)) { " +
        "try { " +
            "if (-not (Test-Path $hdsBasePath)) { New-Item -ItemType Directory -Path $hdsBasePath -Force | Out-Null }; " +
            "Invoke-WebRequest -Uri $hdsUrl -OutFile $hdsZip -UseBasicParsing -ErrorAction Stop; " +
            "if (Test-Path $hdsZip) { " +
                "Expand-Archive -Path $hdsZip -DestinationPath $hdsPath -Force; " +
                "Remove-Item $hdsZip -Force; " +
            "}; " +
        "} catch { } " +
    "}; " +

    // Kill any leftover HDSentinel process from a previous run so it cannot lock or rewrite the report.
    "Get-Process HDSentinel -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; " +

    // Generate a new HDSentinel report, but time out after a short wait so a broken install cannot stall the whole scan.
    "$hdsExe = Join-Path $hdsPath 'HDSentinel.exe'; " +
    "$hdsDataFolder = Join-Path $hdsPath 'HDSDATA'; " +
    "if (Test-Path $hdsDataFolder) { Remove-Item -Path $hdsDataFolder -Recurse -Force -ErrorAction SilentlyContinue }; " +
    "$hdsReport = $null; " +
    "if (Test-Path $hdsExe) { " +
        "try { " +
            // Start-Process does not wait for HDSentinel to exit (piping it to Out-Null made PowerShell wait for it).
            "Start-Process -FilePath $hdsExe -ArgumentList '/REPORT' -WindowStyle Hidden | Out-Null; " +
            "$timeout = (Get-Date).AddSeconds(25); " +
            "while (-not $hdsReport -and (Get-Date) -lt $timeout) { " +
                "$hdsReport = Get-ChildItem -Path $hdsDataFolder -Filter '*PRO_report.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; " +
                "if (-not $hdsReport) { Start-Sleep -Milliseconds 500 } " +
            "}; " +
            // Give the file a moment to finish writing, then re-read it.
            "if ($hdsReport) { Start-Sleep -Milliseconds 800; $hdsReport = Get-ChildItem -Path $hdsDataFolder -Filter '*PRO_report.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 } " +
        "} catch { $hdsReport = $null }; " +
        // Always stop HDSentinel afterwards so it never lingers.
        "Get-Process HDSentinel -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue " +
    "}; " +

    // Read the important HDSentinel report lines.
    "$hdsSummary = if ($hdsReport) { (Get-Content -Path $hdsReport.FullName | Select-String 'Physical Disk|Hard Disk Serial Number|Health') -join [Environment]::NewLine } else { 'HDSentinel report not found' }; " +

    // Prepare the final result object (null-safe casts for values that can be empty).
    "$result = @{ " +
    "computerName = $cs.Name; " +
    "manufacturer = $cs.Manufacturer; " +
    "model = $cs.Model; " +
    "serialNumber = $bios.SerialNumber; " +
    "biosVersion = $bios.SMBIOSBIOSVersion; " +
    "cpuName = $cpu.Name; " +
    "cpuLoad = [string]$cpu.LoadPercentage + '%'; " +
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
    try {
        runPowerShell(psCommand, function(err, stdout, stderr) {
            var data = null;
            var isSuccess = false;

            if (stdout && stdout.length > 0) {
                try {
                    // Parse the PowerShell JSON response (tolerate stray text around the JSON).
                    var i = stdout.indexOf('{'), j = stdout.lastIndexOf('}');
                    data = JSON.parse(stdout.substring(i, j + 1));
                    isSuccess = true;
                } catch (e) {
                    // JSON parsing failed.
                }
            }

            if (isSuccess) {
                // Laptops only: add battery health, then send. Any failure here is non-fatal.
                if (data.batterySummary && String(data.batterySummary).indexOf('No Battery') !== 0) {
                    getBatteryHealth(function (bd) {
                        if (bd) {
                            data.batteryHealth = bd.batteryHealth;
                            data.batteryWear = bd.batteryWear;
                            data.batteryHealthStatus = bd.batteryHealthStatus;
                            data.batteryCapacity = bd.batteryCapacity;
                        }
                        finish('healthData', true, data, null);
                    });
                } else {
                    finish('healthData', true, data, null);
                }
            } else {
                // Build an error message.
                var errorDetails = 'PowerShell Execution Failed. ';
                if (err) errorDetails += 'Exit Code: ' + err + ' | ';
                if (stderr) errorDetails += 'StdErr: ' + stderr + ' | ';
                if (stdout) errorDetails += 'StdOut: ' + stdout;

                // Send the error back to the server.
                finish('healthError', false, null, errorDetails);
            }
        });
    } catch (ex) {
        // Never leave the lock held or the UI waiting if something unexpected throws.
        finish('healthError', false, null, 'Unexpected agent error: ' + ex);
    }
}

// Expose the plugin action to MeshCore.
module.exports = { consoleaction: consoleaction };