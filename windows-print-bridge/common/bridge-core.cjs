const crypto = require("crypto");

const DEFAULT_PORT = 4318;

function shouldEnableWindowsAutoStart({ platform, isPackaged }) {
  return platform === "win32" && Boolean(isPackaged);
}

function shouldStartInTray({ platform, isPackaged, argv }) {
  return shouldEnableWindowsAutoStart({ platform, isPackaged }) && Array.isArray(argv) && argv.includes("--hidden");
}

function normalizeBridgeAddress(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Computer Print Bridge address is required.");
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(candidate);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Print Bridge must use an HTTP or HTTPS address.");
  if (!url.hostname) throw new Error("Print Bridge computer address is invalid.");
  return `${url.protocol}//${url.host}`;
}

function createPairToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function buildPairingPayload({ address, token, deviceName }) {
  return JSON.stringify({ type: "aio-print-bridge", version: 1, address: normalizeBridgeAddress(address), token, deviceName });
}

function parsePairingPayload(value) {
  let payload;
  try {
    payload = JSON.parse(String(value || ""));
  } catch {
    throw new Error("This QR code is not an AIO Print Bridge code.");
  }
  if (payload?.type !== "aio-print-bridge" || payload?.version !== 1 || typeof payload?.token !== "string" || payload.token.length < 20) {
    throw new Error("This QR code does not contain a valid AIO Print Bridge connection.");
  }
  return { address: normalizeBridgeAddress(payload.address), token: payload.token, deviceName: String(payload.deviceName || "Windows Print Bridge") };
}

function validatePrintJob(input) {
  if (!input || typeof input !== "object") throw new Error("Print request is missing.");
  if (typeof input.html !== "string" || input.html.length < 80 || input.html.length > 2_000_000) throw new Error("Voucher HTML is invalid or too large.");
  if (typeof input.printerId !== "string" || !input.printerId.trim()) throw new Error("Choose a Windows printer first.");
  if (!input.paper || typeof input.paper !== "object" || !Number.isFinite(input.paper.widthMicrons) || !Number.isFinite(input.paper.heightMicrons)) throw new Error("Choose a supported paper size first.");
  return {
    id: typeof input.id === "string" ? input.id.slice(0, 100) : crypto.randomUUID(),
    html: input.html,
    printerId: input.printerId,
    paper: { id: String(input.paper.id || "custom"), name: String(input.paper.name || "Custom paper"), widthMicrons: Math.round(input.paper.widthMicrons), heightMicrons: Math.round(input.paper.heightMicrons) },
  };
}

module.exports = { DEFAULT_PORT, normalizeBridgeAddress, createPairToken, buildPairingPayload, parsePairingPayload, validatePrintJob, shouldEnableWindowsAutoStart, shouldStartInTray };
