# Scanner

## Termux / Linux
דורש `adb`. אם `fastboot` או `lsusb` קיימים הם נקראים read-only.

```bash
LAB_SERVER_URL=https://device-lab.example LAB_ADMIN_KEY=... node scanner/scanner.js
```

## Windows
PowerShell יכול לאסוף גם USB/driver evidence.

שני הסורקים אינם מבצעים flash, wipe, reboot, unlock או שינוי policy.
