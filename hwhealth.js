"use strict";

module.exports.hwhealth = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    
    // Functions exposed to the frontend browser
    obj.exports = ['onDeviceRefreshEnd', 'loadHealthData', 'loadHealthError', 'renderHealthData'];

    obj.server_startup = function () {
        console.log('HW Health plugin loaded on server.');
    };

    // ==========================================
    // Part 1: Client-Side Code (Injected into browser)
    // ==========================================
    
    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || currentNode == null) return;
        if (!currentNode.osdesc || currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;

        pluginHandler.registerPluginTab({ tabTitle: 'HW Health', tabId: 'pluginHwHealth' });

        // Per-device pending state. It survives panel rebuilds and expires after 120 seconds.
        var pend = window.hwhealthPending;
        var isPending = !!(pend && pend.nodeid === currentNode._id && (Date.now() - pend.t) < 120000);
        var statusText = isPending
            ? 'Collecting hardware data from endpoint... (If first time, this may take a few seconds while the agent downloads required tools.)'
            : 'Ready.';

        // Dark Mode compatibility: 
        // Used rgba() for background/border to create a transparent overlay that adapts to Light/Dark themes.
        // Used opacity: 0.7 instead of hardcoded hex colors for secondary text.
        var html = ''
            + '<div style="padding:12px;">'
            + '  <div style="font-size:18px;font-weight:bold;margin-bottom:10px;">Hardware Health</div>'
            + '  <div id="hwhealthStatus" style="margin-bottom:10px; opacity:0.7;">' + statusText + '</div>'
            + '  <div style="margin-bottom:15px;">'
            + '    <button id="hwhealthRefreshBtn" class="btn btn-primary">Refresh Hardware Data</button>'
            + '  </div>'
            + '  <div id="hwhealthSummary" style="margin-bottom:12px; font-size: 14px; line-height: 1.6; background: rgba(128,128,128,0.1); padding: 15px; border-radius: 5px; border: 1px solid rgba(128,128,128,0.2); max-height: 310px; overflow-y: auto; overflow-x: hidden;"></div>'
            + '</div>';

        QA('pluginHwHealth', html);

        // Keep the button disabled while a scan is still running for this device
        if (isPending) {
            var pb = document.getElementById('hwhealthRefreshBtn');
            if (pb) pb.disabled = true;
        }

        if (!document._hwhealthRefreshHandlerInstalled) {
            document._hwhealthRefreshHandlerInstalled = true;

            document.addEventListener('click', function (event) {
                event = event || window.event;
                var target = event.target || event.srcElement;
                if (!target) return;

                var refreshButton = target;
                while (refreshButton && refreshButton !== document) {
                    if (refreshButton.id === 'hwhealthRefreshBtn') {
                        break;
                    }
                    refreshButton = refreshButton.parentNode;
                }

                if (!refreshButton || refreshButton === document) return;
                if (event.preventDefault) event.preventDefault();

                if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
                    if (pluginHandler.hwhealth && pluginHandler.hwhealth.loadHealthError) {
                        pluginHandler.hwhealth.loadHealthError(null, { message: 'No device selected.' });
                    }
                    return;
                }

                // Ignore clicks while a scan for this device is already running
                var cp = window.hwhealthPending;
                if (cp && cp.nodeid === currentNode._id && (Date.now() - cp.t) < 120000) return;

                var started = Date.now();
                window.hwhealthCache = null;
                window.hwhealthPending = { nodeid: currentNode._id, t: started };
                QH('hwhealthSummary', '');
                QH('hwhealthStatus', 'Collecting hardware data from endpoint... (If first time, this may take a few seconds while the agent downloads required tools.)');
                refreshButton.disabled = true;

                try {
                    // Send request using the global WebSocket object
                    if (typeof meshserver !== 'undefined' && meshserver != null) {
                        meshserver.send({ 
                            action: 'plugin', 
                            plugin: 'hwhealth', 
                            pluginaction: 'getHealth', 
                            nodeid: currentNode._id 
                        });
                    } else if (typeof server !== 'undefined' && server != null) {
                        server.send({ 
                            action: 'plugin', 
                            plugin: 'hwhealth', 
                            pluginaction: 'getHealth', 
                            nodeid: currentNode._id 
                        });
                    } else {
                        throw new Error("WebSocket object not found.");
                    }
                } catch (err) {
                    window.hwhealthPending = null;
                    refreshButton.disabled = false;
                    if (pluginHandler.hwhealth && pluginHandler.hwhealth.loadHealthError) {
                        pluginHandler.hwhealth.loadHealthError(null, { message: 'WebSocket Error: ' + (err && err.message ? err.message : String(err)) });
                    }
                    return;
                }

                // Timeout: if no reply arrives, show an error instead of staying idle
                setTimeout(function () {
                    if (window.hwhealthPending && window.hwhealthPending.t === started) {
                        pluginHandler.hwhealth.loadHealthError(null, { message: 'Scan timed out. The agent did not respond (offline, reconnecting, or script failed).' });
                    }
                }, 120000);
            }, false);
        }

        // Restore the cached result if it belongs to the device being viewed
        var c = window.hwhealthCache;
        if (!isPending && c && c.nodeid === currentNode._id && c.data) {
            pluginHandler.hwhealth.renderHealthData(c.data);
            QH('hwhealthStatus', 'Hardware data loaded (kept from last scan).');
        }
    };

    obj.loadHealthData = function (serverObj, msg) {
        var statusEl = document.getElementById('hwhealthStatus');
        var summaryEl = document.getElementById('hwhealthSummary');

        // Scan finished: clear pending state and re-enable the button
        window.hwhealthPending = null;
        var rb = document.getElementById('hwhealthRefreshBtn');
        if (rb) rb.disabled = false;

        if (!msg || !msg.data) {
            if (statusEl) statusEl.innerText = 'Failed to load hardware data.';
            if (summaryEl) summaryEl.innerHTML = '<span style="color:#d9534f; font-weight:bold;">No data returned from Agent.</span>';
            return;
        }

        // Cache the result for this device so it survives panel rebuilds
        window.hwhealthCache = { nodeid: msg.nodeid, data: msg.data };

        // Only draw it if the user is still looking at that device
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === msg.nodeid) {
            if (statusEl) statusEl.innerText = 'Hardware data loaded successfully.';
            pluginHandler.hwhealth.renderHealthData(msg.data);
        }
    };

    obj.renderHealthData = function (d) {
        // Helper function to escape special characters, embedded here to be sent to the browser
        function esc(s) {
            if (s == null) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        var summaryEl = document.getElementById('hwhealthSummary');
        if (!summaryEl || !d) return;

        // Visual warning for pending reboots
        var rebootWarning = (d.pendingReboot === 'Yes') ? '<span style="color:#d9534f; font-weight:bold;">Yes (Reboot Required)</span>' : 'No';
        var hr = '<div><hr style="margin: 10px 0; border: 0; border-top: 1px solid rgba(128,128,128,0.3);"></div>';

        var h = '';
        h += '<div><b>Computer Name:</b> ' + esc(d.computerName) + '</div>';
        h += '<div><b>Manufacturer / Model:</b> ' + esc(d.manufacturer) + ' / ' + esc(d.model) + '</div>';
        h += '<div><b>Serial Number:</b> ' + esc(d.serialNumber) + '</div>';
        h += '<div><b>BIOS Version:</b> ' + esc(d.biosVersion) + '</div>';
        h += hr;
        h += '<div><b>CPU:</b> ' + esc(d.cpuName) + ' (Load: ' + esc(d.cpuLoad) + ', Temp: ' + esc(d.cpuTemp) + ')</div>';
        h += '<div><b>RAM:</b> ' + esc(d.memorySummary) + '</div>';
        h += '<div><b>Battery:</b> ' + esc(d.batterySummary) + '</div>';
        if (d.batteryHealthStatus) {
            var colors = { Excellent: '#5cb85c', Good: '#5cb85c', Degraded: '#f0ad4e', Poor: '#d9534f' };
            var col = colors[d.batteryHealthStatus] || 'inherit';
            h += '<div><b>Battery Health:</b> ' + esc(d.batteryHealth)
              + ' <span style="color:' + col + '; font-weight:bold;">(' + esc(d.batteryHealthStatus) + ')</span>'
              + (d.batteryWear ? ' &nbsp;|&nbsp; Wear: ' + esc(d.batteryWear) : '')
              + (d.batteryCapacity ? ' &nbsp;|&nbsp; ' + esc(d.batteryCapacity) : '') + '</div>';
            h += '<div style="opacity:0.6; font-size:12px;">90%+ Excellent &middot; 80-89% Good &middot; 70-79% Degraded &middot; below 70% Poor (replacement recommended)</div>';
        }
        h += hr;
        h += '<div><b>Drive Health Status:</b></div>';
        h += '<pre style="margin:6px 0 0 0; white-space:pre-wrap; font-family:monospace;">' + esc(d.diskHealth) + '</pre>';
        h += '<div><b>HDSentinel Report:</b></div>';
        // Color the "Health" lines of the HDSentinel report by percentage (90+ green, 70-89 orange, below 70 red)
        var hdsHtml = String(d.hdsentinel == null ? '' : d.hdsentinel).split(/\r?\n/).map(function (line) {
            var t = esc(line);
            var m = /health/i.test(line) ? line.match(/(\d+(?:[.,]\d+)?)\s*%/) : null;
            if (m) {
                var p = parseFloat(m[1].replace(',', '.'));
                var hc = (p >= 90) ? '#5cb85c' : ((p >= 70) ? '#f0ad4e' : '#d9534f');
                return '<span style="color:' + hc + '; font-weight:bold;">' + t + '</span>';
            }
            return t;
        }).join('\n');
        h += '<pre style="margin:6px 0 0 0; white-space:pre-wrap; font-family:monospace;">' + hdsHtml + '</pre>';
        h += '<div><b>BitLocker (C:):</b> ' + esc(d.bitlockerStatus) + '</div>';
        h += '<div><b>Pending Reboot:</b> ' + rebootWarning + '</div>';
        // Used opacity instead of hardcoded colors for Dark Mode
        h += '<div style="margin-top: 15px; opacity: 0.6; font-size: 12px; text-align: right;"><i>Collected At: ' + esc(d.collectedAt) + '</i></div>';

        summaryEl.innerHTML = h;
    };

    obj.loadHealthError = function (serverObj, msg) {
        var statusEl = document.getElementById('hwhealthStatus');
        var summaryEl = document.getElementById('hwhealthSummary');

        // Scan ended (with an error): clear pending state and re-enable the button
        window.hwhealthPending = null;
        var rb = document.getElementById('hwhealthRefreshBtn');
        if (rb) rb.disabled = false;
        
        if (statusEl) statusEl.innerText = 'Failed to load hardware data.';
        
        if (summaryEl) {
            var errorText = (msg && msg.message) ? msg.message : 'Unknown error occurred.';
            summaryEl.innerHTML = '<span style="color:#d9534f;"><b>Error:</b> ' + String(errorText).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
        }
    };

    // ==========================================
    // Part 2: Server-Side Code (Message Routing)
    // ==========================================

    obj.serveraction = function(command, myparent, grandparent) {
        if (command.plugin !== 'hwhealth') return;

        var sessionid = null;
        try {
            sessionid = myparent.ws.sessionId;
        } catch (e) {}

        var currentSessionid = command.sessionid || sessionid;

        switch (command.pluginaction) {
            
            // Route request from Admin UI to Remote Agent
            case 'getHealth':
                var agent = obj.meshServer.webserver.wsagents[command.nodeid];
                if (agent != null) {
                    agent.send(JSON.stringify({
                        action: 'plugin',
                        plugin: 'hwhealth',
                        pluginaction: 'getHealth',
                        sessionid: currentSessionid,
                        nodeid: command.nodeid
                    }));
                } else {
                    if (currentSessionid && obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[currentSessionid]) {
                        obj.meshServer.webserver.wssessions2[currentSessionid].send(JSON.stringify({
                            action: 'plugin',
                            plugin: 'hwhealth',
                            method: 'loadHealthError',
                            message: 'Agent is offline or disconnected.',
                            nodeid: command.nodeid
                        }));
                    }
                }
                break;

            // Route response from Remote Agent back to Admin UI
            case 'healthData':
            case 'healthError':
                var targetSessionid = command.sessionid;
                var response = {
                    action: 'plugin',
                    plugin: 'hwhealth',
                    method: command.pluginaction === 'healthData' ? 'loadHealthData' : 'loadHealthError',
                    data: command.data,
                    message: command.message,
                    nodeid: command.nodeid
                };
                
                if (targetSessionid && obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[targetSessionid]) {
                    try {
                        obj.meshServer.webserver.wssessions2[targetSessionid].send(JSON.stringify(response));
                    } catch (e) {
                        console.log('HW Health routing error:', e);
                    }
                }
                break;
        }
    };

    return obj;
};