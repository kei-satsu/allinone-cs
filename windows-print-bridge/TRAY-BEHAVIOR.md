# System Tray Behavior

The Windows Print Bridge keeps its local LAN service active when the main window is closed. Closing the window cancels the native close event and hides the window instead. The tray icon provides **Show AIO Print Bridge**, **Hide Window**, and **Exit AIO Print Bridge** actions. Clicking the tray icon toggles the window's visibility.

The app only exits through the explicit tray Exit action or the operating system shutdown flow. A true exit sets an internal quit flag first, so the close handler can release the window and let Electron terminate normally.

The installer launches the bridge after installation. When Windows starts the packaged app automatically, the bridge begins hidden in the system tray while its QR pairing and local print service remain available.

## References

- Electron Tray API: <https://www.electronjs.org/docs/latest/api/tray>
- Electron BrowserWindow close lifecycle: <https://www.electronjs.org/docs/latest/api/browser-window>
