# AIO Windows Print Bridge

This is a **Windows-only local printer bridge** for AIO Intake. It stays on the same Wi-Fi/LAN as the Android device, shows a QR pairing code, reads installed Windows printers, lists paper sizes supplied by the installed printer driver where available, and silently passes a selected 4×6 voucher job to the Windows print spooler.

## Install once on the Windows print computer

1. Install **Node.js 20 LTS** from <https://nodejs.org/>. Restart the computer after installation if Windows asks.
2. Download this project source and copy the folder `windows-print-bridge` to `C:\AIO-Print-Bridge`.
3. Open **PowerShell** in `C:\AIO-Print-Bridge` and run:

   ```powershell
   npm install
   npm start
   ```

4. When Windows Defender Firewall asks, allow the application on **Private networks only**. Do not allow public-network access.
5. Ensure the Windows printer driver is installed and the printer works from a normal Windows test page first.

## Build a click-to-install Windows Setup file

To distribute the bridge to other Windows computers without requiring Node.js on each one, create a signed-style **Setup EXE** from a build computer. Run these commands once in the source folder:

```powershell
npm install
npm run dist:win
```

The installer is written to the `release` folder as `AIO-Windows-Print-Bridge-Setup-1.0.1.exe`. Copy that one EXE to each print computer and run it. The assisted installer offers a per-user installation directory, makes Desktop and Start menu shortcuts, starts the Bridge after installation, and configures the installed Windows app to start automatically whenever that user signs in. Node.js is **not** needed on computers that use the Setup EXE.

After setup, the Bridge stays available in the **Windows system tray**. Closing its window only hides it; the QR pairing service and LAN print receiver continue to run. Click the tray icon to show or hide the window. Right-click it to choose **Show AIO Print Bridge**, **Hide Window**, or **Exit AIO Print Bridge**. Use **Exit** when the print computer should stop accepting Android print jobs.

For business-wide distribution, sign the generated EXE with an organization code-signing certificate before sharing it. This lets Windows identify the publisher and avoids distributing an unverified executable.

## Pair from AIO Intake

1. Connect the Android phone and Windows computer to the same Wi-Fi/LAN.
2. In AIO Intake, open a parcel → **Voucher Preview** → **Computer Print**.
3. Tap **Scan computer QR**, scan the QR code displayed in Windows Print Bridge, then choose a printer and supported paper size.
4. Tap **Send to computer**. The phone sends the rendered 4×6 voucher only to the paired Windows PC, and that PC places it into the selected Windows printer queue.

## Operations and safety

The bridge listens while the application is running in the window **or in the system tray** on port `4318`. The QR contains a random token; use **Generate new QR code** whenever staff or devices change. Pairing is restricted to private LAN addresses, but keep the print computer on a trusted office network and do not expose port 4318 to the internet.

## Verify without a printer

Run `npm test` to check QR pairing and print-job validation. For a physical test, select **Microsoft Print to PDF** from the paired AIO Intake phone, choose a paper size, then check the PDF dialog on Windows. A physical 4×6 printer must have its own Windows driver and matching media installed.
