const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPairingPayload, parsePairingPayload, validatePrintJob, shouldEnableWindowsAutoStart, shouldStartInTray } = require("../common/bridge-core.cjs");
const packageConfig = require("../package.json");

test("pairing payload retains a LAN bridge address and token", () => {
  const parsed = parsePairingPayload(buildPairingPayload({ address: "192.168.1.4:4318", token: "a".repeat(32), deviceName: "Office PC" }));
  assert.equal(parsed.address, "http://192.168.1.4:4318");
  assert.equal(parsed.deviceName, "Office PC");
});

test("print jobs require voucher markup, a printer, and a selected paper size", () => {
  const job = validatePrintJob({ html: "<html>" + "x".repeat(100) + "</html>", printerId: "Thermal Printer", paper: { id: "4x6", name: "4 × 6 in", widthMicrons: 101600, heightMicrons: 152400 } });
  assert.equal(job.paper.widthMicrons, 101600);
  assert.throws(() => validatePrintJob({ html: "short", printerId: "", paper: {} }));
});

test("auto-start is enabled only for installed Windows builds", () => {
  assert.equal(shouldEnableWindowsAutoStart({ platform: "win32", isPackaged: true }), true);
  assert.equal(shouldEnableWindowsAutoStart({ platform: "win32", isPackaged: false }), false);
  assert.equal(shouldEnableWindowsAutoStart({ platform: "linux", isPackaged: true }), false);
});

test("installed Windows auto-start launches hidden in the system tray", () => {
  assert.equal(shouldStartInTray({ platform: "win32", isPackaged: true, argv: ["bridge.exe", "--hidden"] }), true);
  assert.equal(shouldStartInTray({ platform: "win32", isPackaged: true, argv: ["bridge.exe"] }), false);
  assert.equal(shouldStartInTray({ platform: "linux", isPackaged: true, argv: ["bridge", "--hidden"] }), false);
});

test("distribution config creates a per-user NSIS setup program", () => {
  assert.equal(packageConfig.scripts["dist:win"], "electron-builder --win nsis --x64");
  assert.equal(packageConfig.build.win.target[0], "nsis");
  assert.equal(packageConfig.build.nsis.oneClick, false);
  assert.equal(packageConfig.build.nsis.perMachine, false);
  assert.equal(packageConfig.build.nsis.runAfterFinish, true);
  assert.equal(packageConfig.build.files.includes("resources/**/*"), true);
});
