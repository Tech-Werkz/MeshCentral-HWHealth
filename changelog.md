v1.0.9 - Fixed scans ending on "Ready" with no output (pending state survives panel rebuilds, 90s timeout, button stays disabled), null-safe PowerShell values, HDSentinel output silenced, overlapping scans blocked, HDSentinel no longer waited on (fixes slow scans/timeouts), time-limited WMI queries, script now runs from a temp .ps1 file (fixes corrupted long command line error)

v1.0.8 - HDSentinel Health lines are now color-coded (90%+ green, 70-89% orange, below 70% red)

v1.0.7 - Added battery health from the powercfg battery report (wear %, status, design vs. full-charge capacity)

v1.0.6 - Keep the last hardware result visible when the device panel refreshes; cleared when switching device or starting a new scan

Working again with Gemini
v1.0.17