# MeshCentral Hardware Health Plugin (HW Health)

A powerful, real-time diagnostic plugin for MeshCentral that provides advanced hardware telemetry and system health data directly from the MeshAgent. 

Unlike the built-in static inventory of MeshCentral, **HW Health** pulls live data synchronously from the endpoint. This gives IT Administrators and Technicians an instant snapshot of the machine's actual health status without taking remote control or disturbing the user.

## Features

The plugin injects a dedicated **HW Health** tab into the device panel. With a single click, it executes a background PowerShell script on the remote agent to retrieve:

* **Real-time CPU Telemetry:** CPU Name, Current Load (%), and Live Temperature.
* **Memory Diagnostics:** Exact Used vs. Total RAM (GB).
* **Storage Health:** S.M.A.R.T Health Status of the primary drive (Healthy / Warning / Unhealthy).
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

    [https://raw.githubusercontent.com/BarakShakel/MeshCentral-HWHealth/main/config.json](https://raw.githubusercontent.com/BarakShakel/MeshCentral-HWHealth/main/config.json)

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

## Troubleshooting

* **The HW Health tab is missing:** Ensure you restarted the MeshCentral service (`systemctl restart meshcentral`) after installation. Also, try performing a hard refresh (`Ctrl+F5`) in your browser to clear the cache.
* **Data is not loading or "Unknown Error":** The MeshAgent caches plugin files. If you recently updated the plugin on the server, the remote machine might still be running an older version of the script. 


## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

Developed by Barak Shakel. Built upon the fantastic plugin architecture provided by the MeshCentral core team.
