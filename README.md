# MeshCentral Hardware Health Plugin (HW Health)

A powerful, real-time diagnostic plugin for MeshCentral that provides advanced hardware telemetry and system health data directly from the MeshAgent. 

Unlike the built-in static inventory of MeshCentral, **HW Health** pulls live data synchronously from the endpoint. This gives IT Administrators and Technicians an instant snapshot of the machine's actual health status without taking remote control or disturbing the user.

## Features

The plugin injects a dedicated **HW Health** tab into the device panel. With a single click, it executes a background PowerShell script on the remote agent to retrieve:

* **Real-time CPU Telemetry:** CPU Name, Current Load (%), and Live Temperature.
* **Memory Diagnostics:** Exact Used vs. Total RAM (GB).
* **Storage Health:**
      S.M.A.R.T Health Status of the primary drive (Healthy / Warning / Unhealthy).
      Show Health percentage via 3rd party HardDisk Sentinel
* **Advanced Battery Info:** Real-time charging status, estimated charge remaining, and battery health on laptops.
* **Security & Compliance:** Live status of BitLocker encryption on the `C:` drive (Encrypted vs. Suspended/Off).
* **System State:** Instant detection of **Pending Reboots** (crucial for troubleshooting stuck Windows Updates or installations).
* **System Identifiers:** Manufacturer, Model, Serial Number, and BIOS Version.
* **Dark Mode Support:** The UI is fully responsive and automatically adapts to MeshCentral's native Light and Dark themes.

## Requirements

* **MeshCentral Server:** Version 1.1.54 or higher is recommended.
* **Endpoints:** * Windows OS only (Windows 10 / Windows 11 / Windows Server 2016+).
  * PowerShell 5.1 or newer must be available on the endpoint.

## Installation

Pre-requisite: First, make sure you have plugins enabled for your MeshCentral installation:
```
"plugins": {
     "enabled": true
},
```
Restart your MeshCentral server after making this change.

1. Log in to your MeshCentral server as an Administrator.
2. Navigate to **My Server** -> **Plugins**.
3. Click the **Download Plugin** button.
4. Paste the raw URL of the `config.json` file from this repository:

    [https://raw.githubusercontent.com/Tech-Werkz/MeshCentral-HWHealth/refs/heads/main/config.json](https://raw.githubusercontent.com/Tech-Werkz/MeshCentral-HWHealth/refs/heads/main/config.json)

5. Click **OK** to install.
6. Make sure the plugin is enabled (Green checkmark under the "Status" column).
7. **Important Server Restart:** You must restart the MeshCentral service to load the new UI components. Connect via SSH or terminal to your server and run:

    systemctl restart meshcentral

## Usage

1. Open the MeshCentral web interface.
2. Navigate to any online Windows device.
3. Click on the newly added **HW Health** tab.
4. Click **Refresh Hardware Data**.
5. The request is sent to the MeshAgent, and the live results will populate within 3-15 seconds.

## Access Control (v1.1.0 and newer)

**Default: nobody has access.** The plugin registers one permission with MeshCentral's own plugin permission system, and its default is `denied`. After installing or updating to v1.1.0, **no user can see or use the HW Health tab until an administrator grants the permission**. Existing users must be granted access.

| Permission | What it allows |
|---|---|
| `HW Health: view the tab and run hardware scans` (`runScan`) | Open the HW Health tab on a device and run a live hardware scan on it. |

How to grant it: open MeshCentral's permissions dialog for the plugin and set the permission to *Allowed* at the level you want. The most specific level wins: **device, then device group, then global, then the default (denied)**. "Inherited" passes the decision to the next level. A user also needs normal MeshCentral rights on the device; the plugin permission alone is not enough.

What is enforced:

* **On the server:** every scan request from a browser is checked (plugin permission and MeshCentral rights on the device) before it is sent to the agent. Any error, missing API or unexpected answer means *denied*. If the permission API does not exist in your MeshCentral version, only full administrators are allowed. Browser sessions can only send the scan request; they can no longer forge scan results.
* **In the tab:** the tab shows a notice when access is missing and starts nothing until the server has answered. Permissions are re-checked on every device page refresh and every 10 seconds while the tab is loaded (at most once per 5 seconds per device), so a grant or a revoke takes effect without reloading the page. If access is revoked, the tab is replaced by the notice and any scan result still on its way is discarded.
* **In the log:** every decision is logged (user, `siteadmin` value, permission, device, what the API returned, which call shape was used), at most once per minute for refusals and once per five minutes for grants per user, permission and device. The startup line `HW Health: plugin permissions registered; ...` shows which permission API was found.

What is **not** enforced (limits):

* Anything that does not pass through the plugin's server code cannot be checked by it. A user who already has MeshCentral console rights on a device can run the agent-side plugin command directly from the MeshCentral console, bypassing the tab. Control this through MeshCentral's own device rights.
* A scan that is already running on the agent when access is revoked still finishes on the endpoint; the result is dropped by the tab, but this part is enforced in the browser only.
* Whether full site administrators are always allowed by MeshCentral itself is not assumed. Read the `siteadmin=` value in the log lines to see what happens on your server.
* On MeshCentral v1.3.1 with MySQL, saved permissions may fail to load because of a MeshCentral bug (issue #8307, `getPluginPermissions is not a function`). That cannot be fixed in a plugin.
* After updating, restart the MeshCentral service and hard-refresh the browser (`Ctrl+F5`). A cached old tab has no permission checks.

## Troubleshooting

* **The HW Health tab is missing:** Ensure you restarted the MeshCentral service (`systemctl restart meshcentral`) after installation. Also, try performing a hard refresh (`Ctrl+F5`) in your browser to clear the cache.
* **Data is not loading or "Unknown Error":** The MeshAgent caches plugin files. If you recently updated the plugin on the server, the remote machine might still be running an older version of the script. 


## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

Customized by HenryTech. | Developed by Barak Shakel. Built upon the fantastic plugin architecture provided by the MeshCentral core team.