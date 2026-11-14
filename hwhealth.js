"use strict";

module.exports.hwhealth = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    
    // Functions exposed to the frontend browser (MeshCentral serializes them with toString, so each one
    // must be self-contained and call the others through pluginHandler.hwhealth.<fn>)
    obj.exports = ['onDeviceRefreshEnd', 'buildTab', 'loadHealthData', 'loadHealthError', 'renderHealthData',
                   'elCan', 'requestAccess', 'recheckAccess', 'accessGate', 'onAccess'];

    obj.server_startup = function () {
        console.log('HW Health plugin loaded on server.');
        if (!obj.registerPermissions()) console.log('HW Health: no plugin permission API (registerPermissions); limited to full administrators');
        else console.log('HW Health: plugin permissions registered; ' + obj.describePermissionApi());
    };

    // ==========================================
    // Part 0: Permissions (server side, default = denied)
    // ==========================================

    obj.PERMISSIONS = {
        runScan: {
            title: 'HW Health: view the tab and run hardware scans',
            desc: 'Allows opening the HW Health tab on a device and running a live hardware scan on it. Denied by default.',
            default: 'denied'
        }
    };
    // pluginaction -> permission key (browser-originated actions only)
    obj.ACTION_PERMISSION = { getHealth: 'runScan' };

    obj.registerPermissions = function () {
        if (obj._permsRegistered) return true;
        var cands = [obj.parent, obj.meshServer && obj.meshServer.pluginHandler];
        for (var i = 0; i < cands.length; i++) {
            if (cands[i] != null && typeof cands[i].registerPermissions == 'function') {
                try { cands[i].registerPermissions('hwhealth', obj.PERMISSIONS); obj._permsRegistered = true; return true; }
                catch (e) { console.log('HW Health: could not register plugin permissions: ' + (e.message || e)); }
            }
        }
        return false;
    };

    obj.permissionCall = function (user, ctx) {
        if (typeof obj.getAccessPermissions == 'function') {           // attached to the plugin object
            obj._permMode = 'plugin object: getAccessPermissions(user, context)';
            return Promise.resolve(obj.getAccessPermissions(user, ctx));
        }
        var hosts = [obj.parent, obj.meshServer && obj.meshServer.pluginHandler];
        for (var i = 0; i < hosts.length; i++) {
            var host = hosts[i];
            if (host == null || typeof host.getAccessPermissions != 'function') continue;
            var src = ''; try { src = Function.prototype.toString.call(host.getAccessPermissions); } catch (e) { }
            var m = src.match(/^[^(]*\(\s*([A-Za-z_$][\w$]*)/);
            var takesName = (m != null) && /^(plugin|pluginname|plugin_name|pluginid|shortname|name|id)$/i.test(m[1]);
            obj._permMode = takesName ? 'plugin handler: getAccessPermissions(pluginName, user, context)' : 'plugin handler: getAccessPermissions(user, context)';
            return Promise.resolve(takesName ? host.getAccessPermissions('hwhealth', user, ctx) : host.getAccessPermissions(user, ctx));
        }
        return null;                                                    // no permission API in this MeshCentral
    };

    obj.describePermissionApi = function () {                           // one startup log line
        if (typeof obj.getAccessPermissions == 'function') return 'getAccessPermissions on the plugin object';
        var hosts = [obj.parent, obj.meshServer && obj.meshServer.pluginHandler];
        for (var i = 0; i < hosts.length; i++) {
            if (hosts[i] != null && typeof hosts[i].getAccessPermissions == 'function') {
                var src = ''; try { src = Function.prototype.toString.call(hosts[i].getAccessPermissions).split('\n')[0].substring(0, 120); } catch (e) { }
                return 'getAccessPermissions on the plugin handler: ' + src;
            }
        }
        return 'no getAccessPermissions found';
    };

    obj._decisionLogged = {};
    obj.logDecision = function (granted, user, key, ctx, detail) {
        try {
            var k = (granted ? 'g|' : 'd|') + (user && user._id) + '|' + key + '|' + (ctx && ctx.nodeid), now = Date.now();
            if (obj._decisionLogged[k] != null && (now - obj._decisionLogged[k]) < (granted ? 300000 : 60000)) return;
            obj._decisionLogged[k] = now;
            console.log('HW Health: permission "' + key + '" ' + (granted ? 'granted to ' : 'refused for ') + (user && (user.name || user._id)) +
                ' (siteadmin=' + (user && user.siteadmin) + ') on ' + (ctx && (ctx.nodeid || ctx.meshid)) + ' - ' + detail + ' [' + (obj._permMode || 'no API') + ']');
        } catch (e) { }
    };

    // Resolves true / false. Fails closed.
    obj.canUse = function (user, key, ctx) {
        try {
            if (user == null) return Promise.resolve(false);
            var call = obj.permissionCall(user, ctx);
            if (call == null) {
                var admin = ((user.siteadmin >>> 0) === 0xFFFFFFFF);
                obj.logDecision(admin, user, key, ctx, 'no plugin permission API; only full administrators are allowed');
                return Promise.resolve(admin);
            }
            return call.then(function (has) {
                var allowed = false, what;
                if (typeof has == 'function') { var r = has(key); allowed = (r === true); what = 'the permission check returned ' + String(r); }
                else if (has != null && typeof has == 'object') { var r2 = has[key]; allowed = (r2 === true); what = 'the permission object has ' + key + ' = ' + String(r2); }
                else what = 'getAccessPermissions returned ' + String(has);
                obj.logDecision(allowed, user, key, ctx, what);
                return allowed;
            }).catch(function (e) { obj.logDecision(false, user, key, ctx, 'permission check threw: ' + ((e && e.message) || e)); return false; });
        } catch (e) { obj.logDecision(false, user, key, ctx, 'permission check threw: ' + ((e && e.message) || e)); return Promise.resolve(false); }
    };

    // The user must also have MeshCentral rights on the device. Fails closed (no function / error / 0 = no).
    obj.hasNodeRights = function (user, command, grandparent) {
        try {
            if (command == null || command.nodeid == null) return false;
            if (grandparent != null && typeof grandparent.GetNodeRights == 'function') return (grandparent.GetNodeRights(user, command.meshid, command.nodeid) != 0);
        } catch (e) { }
        return false;
    };

    // Answer for the browser: which permissions this user has on this device.
    obj.sendAccess = function (myparent, command, grandparent) {
        var ctx = { nodeid: command.nodeid, meshid: command.meshid };
        var rights = obj.hasNodeRights(myparent.user, command, grandparent);
        var keys = Object.keys(obj.PERMISSIONS);
        return Promise.all(keys.map(function (k) { return rights ? obj.canUse(myparent.user, k, ctx) : Promise.resolve(false); })).then(function (r) {
            var allowed = {}; keys.forEach(function (k, i) { allowed[k] = r[i]; });
            try { myparent.ws.send(JSON.stringify({ action: 'plugin', plugin: 'hwhealth', method: 'onAccess', nodeid: command.nodeid, allowed: allowed })); } catch (e) { }
        });
    };

    // Gate in front of the handler (the original handler is obj._serveraction below).
    obj.serveraction = function (command, myparent, grandparent) {
        if (command == null || command.plugin !== 'hwhealth') return;
        // Agent traffic has no user: results travel agent -> server -> the session that asked.
        if (myparent == null || myparent.user == null) return obj._serveraction(command, myparent, grandparent);
        if (command.pluginaction == 'checkAccess') return obj.sendAccess(myparent, command, grandparent);
        var ctx = { nodeid: command.nodeid, meshid: command.meshid };
        var perm = obj.ACTION_PERMISSION[command.pluginaction];
        // Fail closed: a browser session may only send known, gated actions (this also stops a user
        // from forging 'healthData' / 'healthError' messages to another session).
        if (perm == null) {
            obj.logDecision(false, myparent.user, String(command.pluginaction), ctx, 'unknown action from a browser session');
            return Promise.resolve();
        }
        if (!obj.hasNodeRights(myparent.user, command, grandparent)) {
            obj.logDecision(false, myparent.user, perm, ctx, 'no MeshCentral rights on the device (or rights check unavailable)');
            return obj.sendAccess(myparent, command, grandparent);
        }
        return obj.canUse(myparent.user, perm, ctx).then(function (ok) {
            if (ok) { try { obj._serveraction(command, myparent, grandparent); } catch (e) { console.log('HW Health: serveraction error: ', e); } return; }
            return obj.sendAccess(myparent, command, grandparent);          // refused: the tab learns it has no access
        });
    };

    // ==========================================
    // Part 1: Client-Side Code (Injected into browser)
    // ==========================================

    // True only when the server said yes for THIS device.
    obj.elCan = function (key) {
        var a = pluginHandler.hwhealth.access;
        return (a != null && typeof currentNode != 'undefined' && currentNode != null && a.nodeid == currentNode._id && a.allowed[key] === true);
    };

    // One request per device and 5 seconds.
    obj.requestAccess = function () {
        var ph = pluginHandler.hwhealth;
        if (typeof currentNode == 'undefined' || currentNode == null) return;
        var now = Date.now(), asked = ph._accessAsked;
        if (asked != null && asked.nodeid == currentNode._id && (now - asked.t) < 5000) return;
        ph._accessAsked = { nodeid: currentNode._id, t: now };
        var ws = (typeof meshserver != 'undefined' && meshserver != null) ? meshserver : ((typeof server != 'undefined' && server != null) ? server : null);
        if (ws == null) return;
        ws.send({ action: 'plugin', plugin: 'hwhealth', pluginaction: 'checkAccess', nodeid: currentNode._id, meshid: currentNode.meshid });
    };

    obj.recheckAccess = function () {
        var ph = pluginHandler.hwhealth;
        ph._accessAsked = null; ph.access = null; ph.accessGate();
        return false;
    };

    // True when the tab may be drawn; otherwise draws a notice.
    obj.accessGate = function () {
        var ph = pluginHandler.hwhealth;
        if (!Q('pluginHwHealth')) return false;
        var a = ph.access, known = (a != null && typeof currentNode != 'undefined' && currentNode != null && a.nodeid == currentNode._id);
        var any = known && Object.keys(a.allowed).some(function (k) { return a.allowed[k] === true; });
        if (any) { if (Q('hwhealthNotice')) QH('pluginHwHealth', ''); return true; }
        var key = known ? 'denied' : 'checking';
        if (!Q('hwhealthNotice') || Q('hwhealthNotice').getAttribute('data-k') != key) {
            QH('pluginHwHealth', '<div id=hwhealthNotice data-k=' + key + ' style="padding:18px 14px;opacity:.85">' +
                (known ? 'You do not have permission to use this plugin for this device. Ask a MeshCentral administrator to grant it in the permissions dialog. <a href=# onclick="return pluginHandler.hwhealth.recheckAccess()">Check again</a>'
                       : 'Checking permissions&hellip;') + '</div>');
        }
        if (!known) ph.requestAccess();
        return false;
    };

    // The server's answer. Rebuilds the tab only when the answer changed.
    obj.onAccess = function (server, message) {
        var ph = pluginHandler.hwhealth, prev = ph.access;
        ph.access = { nodeid: message.nodeid, allowed: message.allowed || {} };
        if (typeof currentNode == 'undefined' || currentNode == null || currentNode._id != message.nodeid) return;
        var same = prev != null && prev.nodeid == ph.access.nodeid && JSON.stringify(prev.allowed) == JSON.stringify(ph.access.allowed);
        if (same && (Q('hwhealthShell') || Q('hwhealthNotice'))) return;           // unchanged: leave the tab alone
        // A permission is gone: forget the running scan and the kept result, remove the tab content
        if (ph.access.allowed.runScan !== true) { window.hwhealthPending = null; window.hwhealthCache = null; }
        if (Q('hwhealthShell')) QH('pluginHwHealth', '');
        ph.buildTab();
    };

    // Draws the tab (only if access is allowed). Called on every refresh and when the answer changes.
    obj.buildTab = function () {
        var ph = pluginHandler.hwhealth;
        if (!ph.accessGate()) return;
        if (!ph.elCan('runScan')) return;

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
            + '<div id="hwhealthShell" style="padding:12px;">'
            + '  <div style="font-size:18px;font-weight:bold;margin-bottom:10px;">Hardware Health</div>'
            + '  <div id="hwhealthStatus" style="margin-bottom:10px; opacity:0.7;">' + statusText + '</div>'
            + '  <div style="margin-bottom:15px;">'
            + '    <button id="hwhealthRefreshBtn" class="btn btn-primary">Refresh Hardware Data</button>'
            + '  </div>'
            + '  <div id="hwhealthSummary" style="margin-bottom:12px; font-size: 14px; line-height: 1.6; background: rgba(128,128,128,0.1); padding: 15px; border-radius: 5px; border: 1px solid rgba(128,128,128,0.2); max-height: 310px; overflow-y: auto; overflow-x: hidden;"></div>'
            + '</div>';

        QH('pluginHwHealth', html);

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

                var ph2 = pluginHandler.hwhealth;
                if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
                    ph2.loadHealthError(null, { message: 'No device selected.' });
                    return;
                }

                // Never start anything without a permission for this device
                if (!ph2.elCan('runScan')) return;

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
                            nodeid: currentNode._id,
                            meshid: currentNode.meshid
                        });
                    } else if (typeof server !== 'undefined' && server != null) {
                        server.send({ 
                            action: 'plugin', 
                            plugin: 'hwhealth', 
                            pluginaction: 'getHealth', 
                            nodeid: currentNode._id,
                            meshid: currentNode.meshid
                        });
                    } else {
                        throw new Error("WebSocket object not found.");
                    }
                } catch (err) {
                    window.hwhealthPending = null;
                    refreshButton.disabled = false;
                    ph2.loadHealthError(null, { message: 'WebSocket Error: ' + (err && err.message ? err.message : String(err)) });
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
            ph.renderHealthData(c.data);
            QH('hwhealthStatus', 'Hardware data loaded (kept from last scan).');
        }
    };

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || currentNode == null) return;
        if (!currentNode.osdesc || currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;

        pluginHandler.registerPluginTab({ tabTitle: 'HW Health', tabId: 'pluginHwHealth' });

        var ph = pluginHandler.hwhealth;

        // Re-check the permission regularly while the tab exists, so a grant or a revoke works without a page reload.
        if (!window.hwhealthAccessTimer) {
            window.hwhealthAccessTimer = setInterval(function () {
                var p = pluginHandler.hwhealth;
                if (!p || typeof currentNode === 'undefined' || currentNode == null || !Q('pluginHwHealth')) return;
                p.requestAccess();
            }, 10000);
        }

        ph.requestAccess();
        ph.buildTab();
    };

    obj.loadHealthData = function (serverObj, msg) {
        var ph = pluginHandler.hwhealth;
        var statusEl = document.getElementById('hwhealthStatus');
        var summaryEl = document.getElementById('hwhealthSummary');

        // Scan finished: clear pending state and re-enable the button
        window.hwhealthPending = null;
        var rb = document.getElementById('hwhealthRefreshBtn');
        if (rb) rb.disabled = false;

        // The permission may have been revoked while the scan was running: discard the result
        var a = ph.access;
        if (!(msg && a != null && a.nodeid === msg.nodeid && a.allowed.runScan === true)) return;

        if (!msg.data) {
            if (statusEl) statusEl.innerText = 'Failed to load hardware data.';
            if (summaryEl) summaryEl.innerHTML = '<span style="color:#d9534f; font-weight:bold;">No data returned from Agent.</span>';
            return;
        }

        // Cache the result for this device so it survives panel rebuilds
        window.hwhealthCache = { nodeid: msg.nodeid, data: msg.data };

        // Only draw it if the user is still looking at that device
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === msg.nodeid) {
            if (statusEl) statusEl.innerText = 'Hardware data loaded successfully.';
            ph.renderHealthData(msg.data);
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

    // The original handler. It is only reached through the permission gate (obj.serveraction above)
    // for browser sessions, and directly for agent traffic.
    obj._serveraction = function(command, myparent, grandparent) {
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