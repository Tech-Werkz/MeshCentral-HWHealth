"use strict";

module.exports.hwhealth = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    // Functions exposed to the frontend browser
    obj.exports = [
        'onDeviceRefreshEnd',
        'loadHealthData',
        'loadHealthError'
    ];

    obj.server_startup = function () {
        console.log('[HW Health] Plugin loaded on server.');
    };

    // ==========================================
    // Part 1: Client-Side Code
    // ==========================================

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || currentNode == null) return;

        if (
            !currentNode.osdesc ||
            currentNode.osdesc.toLowerCase().indexOf('windows') === -1
        ) {
            return;
        }

        pluginHandler.registerPluginTab({
            tabTitle: 'HW Health',
            tabId: 'pluginHwHealth'
        });

        var html = ''
            + '<div style="padding:12px;">'
            + '  <div style="font-size:18px;font-weight:bold;margin-bottom:10px;">Hardware Health</div>'
            + '  <div id="hwhealthStatus" style="margin-bottom:10px; opacity:0.7;">Ready.</div>'
            + '  <div style="margin-bottom:15px;">'
            + '    <button id="hwhealthRefreshBtn" class="btn btn-primary">Refresh Hardware Data</button>'
            + '  </div>'
            + '  <div id="hwhealthSummary" style="margin-bottom:12px; font-size:14px; line-height:1.6; background:rgba(128,128,128,0.1); padding:15px; border-radius:5px; border:1px solid rgba(128,128,128,0.2); max-height:310px; overflow-y:auto; overflow-x:hidden;"></div>'
            + '</div>';

        QA('pluginHwHealth', html);

        var btn = document.getElementById('hwhealthRefreshBtn');

        if (btn) {
            btn.onclick = function () {

                if (
                    typeof currentNode === 'undefined' ||
                    !currentNode ||
                    !currentNode._id
                ) {
                    if (
                        pluginHandler.hwhealth &&
                        pluginHandler.hwhealth.loadHealthError
                    ) {
                        pluginHandler.hwhealth.loadHealthError(
                            null,
                            { message: 'No device selected.' }
                        );
                    }

                    return;
                }

                QH('hwhealthSummary', '');

                QH(
                    'hwhealthStatus',
                    'Collecting hardware data from endpoint...'
                );

                try {

                    /*
                     * IMPORTANT:
                     *
                     * MeshCentral 1.2.6 provides routeToNode for
                     * plugin commands.
                     *
                     * This lets MeshCentral:
                     *   - validate the node
                     *   - check user permissions
                     *   - assign the current session ID
                     *   - route the command to the connected agent
                     *
                     * Do NOT directly access wsagents from the browser
                     * plugin anymore.
                     */

                    if (
                        typeof meshserver !== 'undefined' &&
                        meshserver != null
                    ) {

                        meshserver.send({
                            action: 'plugin',
                            plugin: 'hwhealth',
                            pluginaction: 'getHealth',
                            nodeid: currentNode._id,

                            // MeshCentral 1.2.6 routing mechanism
                            routeToNode: true
                        });

                    } else {

                        throw new Error(
                            'MeshCentral WebSocket object not found.'
                        );
                    }

                } catch (err) {

                    if (
                        pluginHandler.hwhealth &&
                        pluginHandler.hwhealth.loadHealthError
                    ) {

                        pluginHandler.hwhealth.loadHealthError(
                            null,
                            {
                                message:
                                    'Unable to request hardware data: ' +
                                    err.message
                            }
                        );
                    }
                }
            };
        }
    };

    // ==========================================
    // Hardware Data Response
    // ==========================================

    obj.loadHealthData = function (serverObj, msg) {

        function esc(s) {
            if (s == null) return '';

            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        var statusEl =
            document.getElementById('hwhealthStatus');

        var summaryEl =
            document.getElementById('hwhealthSummary');

        if (statusEl) {
            statusEl.innerText =
                'Hardware data loaded successfully.';
        }

        if (!msg || !msg.data) {

            if (summaryEl) {
                summaryEl.innerHTML =
                    '<span style="color:#d9534f;font-weight:bold;">' +
                    'No data returned from Agent.' +
                    '</span>';
            }

            return;
        }

        var d = msg.data;

        var rebootWarning =
            (d.pendingReboot === 'Yes')
                ? '<span style="color:#d9534f;font-weight:bold;">Yes (Reboot Required)</span>'
                : 'No';

        var summaryHtml = '';

        summaryHtml +=
            '<div><b>Computer Name:</b> ' +
            esc(d.computerName) +
            '</div>';

        summaryHtml +=
            '<div><b>Manufacturer / Model:</b> ' +
            esc(d.manufacturer) +
            ' / ' +
            esc(d.model) +
            '</div>';

        summaryHtml +=
            '<div><b>Serial Number:</b> ' +
            esc(d.serialNumber) +
            '</div>';

        summaryHtml +=
            '<div><b>BIOS Version:</b> ' +
            esc(d.biosVersion) +
            '</div>';

        summaryHtml +=
            '<div><hr style="margin:10px 0;border:0;border-top:1px solid rgba(128,128,128,0.3);"></div>';

        summaryHtml +=
            '<div><b>CPU:</b> ' +
            esc(d.cpuName) +
            ' (Load: ' +
            esc(d.cpuLoad) +
            ', Temp: ' +
            esc(d.cpuTemp) +
            ')</div>';

        summaryHtml +=
            '<div><b>RAM:</b> ' +
            esc(d.memorySummary) +
            '</div>';

        summaryHtml +=
            '<div><b>Battery:</b> ' +
            esc(d.batterySummary) +
            '</div>';

        summaryHtml +=
            '<div><hr style="margin:10px 0;border:0;border-top:1px solid rgba(128,128,128,0.3);"></div>';

        summaryHtml +=
            '<div><b>Drive Health Status:</b></div>';

        summaryHtml +=
            '<pre style="margin:6px 0 0 0;white-space:pre-wrap;font-family:monospace;">' +
            esc(d.diskHealth) +
            '</pre>';

        summaryHtml +=
            '<div><b>HDSentinel Report:</b></div>';

        summaryHtml +=
            '<pre style="margin:6px 0 0 0;white-space:pre-wrap;font-family:monospace;">' +
            esc(d.hdsentinel) +
            '</pre>';

        summaryHtml +=
            '<div><b>BitLocker (C:):</b> ' +
            esc(d.bitlockerStatus) +
            '</div>';

        summaryHtml +=
            '<div><b>Pending Reboot:</b> ' +
            rebootWarning +
            '</div>';

        summaryHtml +=
            '<div style="margin-top:15px;opacity:0.6;font-size:12px;text-align:right;">' +
            '<i>Collected At: ' +
            esc(d.collectedAt) +
            '</i></div>';

        if (summaryEl) {
            summaryEl.innerHTML = summaryHtml;
        }
    };

    // ==========================================
    // Error Response
    // ==========================================

    obj.loadHealthError = function (serverObj, msg) {

        var statusEl =
            document.getElementById('hwhealthStatus');

        var summaryEl =
            document.getElementById('hwhealthSummary');

        if (statusEl) {
            statusEl.innerText =
                'Failed to load hardware data.';
        }

        if (summaryEl) {

            var errorText =
                (msg && msg.message)
                    ? msg.message
                    : 'Unknown error occurred.';

            summaryEl.innerHTML =
                '<span style="color:#d9534f;">' +
                '<b>Error:</b> ' +
                String(errorText)
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;') +
                '</span>';
        }
    };

    // ==========================================
    // Part 2: Server-Side Code
    // ==========================================

    obj.serveraction = function (command, myparent, grandparent) {

        if (
            !command ||
            command.plugin !== 'hwhealth'
        ) {
            return;
        }

        /*
         * MeshCentral 1.2.6:
         *
         * When routeToNode=true is used from the Web UI,
         * MeshCentral itself sends getHealth directly
         * to the agent.
         *
         * Therefore getHealth should NOT attempt to
         * manually access wsagents.
         */

        switch (command.pluginaction) {

            case 'getHealth':

                /*
                 * Compatibility fallback.
                 *
                 * This remains here for older clients or
                 * manually generated plugin commands.
                 */

                if (
                    command.routeToNode !== true &&
                    command.nodeid
                ) {

                    try {

                        var agent =
                            obj.meshServer.webserver.wsagents[
                                command.nodeid
                            ];

                        if (agent) {

                            var sessionid =
                                command.sessionid;

                            agent.send(JSON.stringify({
                                action: 'plugin',
                                plugin: 'hwhealth',
                                pluginaction: 'getHealth',
                                sessionid: sessionid,
                                nodeid: command.nodeid
                            }));

                        } else {

                            sendPluginError(
                                command,
                                'Agent is offline or disconnected.'
                            );
                        }

                    } catch (e) {

                        console.log(
                            '[HW Health] Agent routing error: ' +
                            e
                        );

                        sendPluginError(
                            command,
                            'Unable to contact agent: ' +
                            e.message
                        );
                    }
                }

                break;

            case 'healthData':
            case 'healthError':

                routeHealthResponse(command);

                break;
        }
    };

    // ==========================================
    // Response Routing
    // ==========================================

    function routeHealthResponse(command) {

        var targetSessionid =
            command.sessionid;

        if (!targetSessionid) {

            console.log(
                '[HW Health] Missing session ID in agent response.'
            );

            return;
        }

        var response = {
            action: 'plugin',
            plugin: 'hwhealth',
            method:
                command.pluginaction === 'healthData'
                    ? 'loadHealthData'
                    : 'loadHealthError',

            data: command.data,
            message: command.message,
            nodeid: command.nodeid
        };

        try {

            var sessions =
                obj.meshServer.webserver.wssessions2;

            if (
                sessions &&
                sessions[targetSessionid]
            ) {

                sessions[targetSessionid].send(
                    JSON.stringify(response)
                );

                return;
            }

        } catch (e) {

            console.log(
                '[HW Health] Session routing error: ' +
                e
            );
        }

        console.log(
            '[HW Health] Target WebSocket session not found: ' +
            targetSessionid
        );
    }

    function sendPluginError(command, message) {

        var sessionid =
            command.sessionid;

        if (!sessionid) return;

        var response = {
            action: 'plugin',
            plugin: 'hwhealth',
            method: 'loadHealthError',
            message: message,
            nodeid: command.nodeid
        };

        try {

            var sessions =
                obj.meshServer.webserver.wssessions2;

            if (
                sessions &&
                sessions[sessionid]
            ) {

                sessions[sessionid].send(
                    JSON.stringify(response)
                );
            }

        } catch (e) {

            console.log(
                '[HW Health] Error sending error response: ' +
                e
            );
        }
    }

    return obj;
};