const { app, BrowserWindow, ipcMain, Menu, Tray } = require("electron");
const os = require("os");
const path = require("path");
const QRCode = require("qrcode");
const { DEFAULT_PORT, buildPairingPayload, createPairToken, shouldEnableWindowsAutoStart, shouldStartInTray } = require("../common/bridge-core.cjs");
const { discoverPrinters } = require("./printers.cjs");
const { startBridgeServer } = require("./http-server.cjs");

let windowRef;
let trayRef;
let token = createPairToken();
let printChain = Promise.resolve();
let isQuitting = false;
const deviceName = `${os.hostname()} Print Bridge`;

if (!app.requestSingleInstanceLock()) app.quit();

function ipv4Address() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) if (entry.family === "IPv4" && !entry.internal) return entry.address;
  }
  return "127.0.0.1";
}

function state() {
  const address = `http://${ipv4Address()}:${DEFAULT_PORT}`;
  return { address, token, deviceName };
}

async function getPairingState() {
  const current = state();
  return { ...current, qrDataUrl: await QRCode.toDataURL(buildPairingPayload(current), { width: 300, margin: 1 }) };
}

function showBridgeWindow() {
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.show();
  windowRef.focus();
}

function hideBridgeWindow() {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.hide();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Show AIO Print Bridge", click: showBridgeWindow },
    { label: "Hide Window", click: hideBridgeWindow },
    { type: "separator" },
    { label: "Exit AIO Print Bridge", click: () => { isQuitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "resources", "aio-print-bridge-tray.png");
  trayRef = new Tray(iconPath);
  trayRef.setToolTip("AIO Windows Print Bridge · Ready");
  trayRef.setContextMenu(buildTrayMenu());
  trayRef.on("click", () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    if (windowRef.isVisible() && !windowRef.isMinimized()) hideBridgeWindow();
    else showBridgeWindow();
  });
}

function printJob(job) {
  printChain = printChain.then(async () => {
    const jobWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      await jobWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(job.html)}`);
      await new Promise((resolve, reject) => jobWindow.webContents.print({ silent: true, deviceName: job.printerId, printBackground: true, margins: { marginType: "none" }, pageSize: { width: job.paper.widthMicrons, height: job.paper.heightMicrons } }, (success, reason) => success ? resolve() : reject(new Error(reason || "Windows print spooler rejected the voucher."))));
      return { status: "queued" };
    } finally {
      if (!jobWindow.isDestroyed()) jobWindow.destroy();
    }
  });
  return printChain;
}

async function createWindow({ startHidden = false } = {}) {
  windowRef = new BrowserWindow({ width: 680, height: 760, minWidth: 590, minHeight: 640, show: !startHidden, title: "AIO Windows Print Bridge", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false } });
  windowRef.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideBridgeWindow();
  });
  await windowRef.loadFile(path.join(__dirname, "renderer.html"));
  await startBridgeServer({ port: DEFAULT_PORT, getState: state, listPrinters: () => discoverPrinters(windowRef.webContents), enqueuePrint: printJob });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.allinoneexpress.printbridge");
  if (shouldEnableWindowsAutoStart({ platform: process.platform, isPackaged: app.isPackaged })) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
  ipcMain.handle("bridge:state", getPairingState);
  ipcMain.handle("bridge:printers", () => discoverPrinters(windowRef.webContents));
  ipcMain.handle("bridge:rotate", async () => { token = createPairToken(); return getPairingState(); });
  createTray();
  await createWindow({ startHidden: shouldStartInTray({ platform: process.platform, isPackaged: app.isPackaged, argv: process.argv }) });
});
app.on("second-instance", showBridgeWindow);
app.on("activate", showBridgeWindow);
app.on("before-quit", () => { isQuitting = true; });
