const http = require("http");
const { validatePrintJob } = require("../common/bridge-core.cjs");

function isPrivateNetworkAddress(address = "") {
  const ip = address.replace(/^::ffff:/, "");
  return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("192.168.") || ip.startsWith("10.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-aio-print-token", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_100_000) reject(new Error("Request is too large."));
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Request JSON is invalid.")); }
    });
  });
}

function startBridgeServer({ port, getState, listPrinters, enqueuePrint }) {
  const server = http.createServer(async (request, response) => {
    if (!isPrivateNetworkAddress(request.socket.remoteAddress)) return json(response, 403, { error: "LAN access only." });
    if (request.method === "OPTIONS") return json(response, 204, {});
    const url = new URL(request.url || "/", "http://bridge.local");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, deviceName: getState().deviceName });
    const token = request.headers["x-aio-print-token"];
    if (token !== getState().token) return json(response, 401, { error: "Pair this phone by scanning the current Bridge QR code." });
    try {
      if (request.method === "POST" && url.pathname === "/pair") return json(response, 200, { ok: true, deviceName: getState().deviceName, printers: await listPrinters() });
      if (request.method === "GET" && url.pathname === "/printers") return json(response, 200, { printers: await listPrinters() });
      if (request.method === "POST" && url.pathname === "/print") {
        const job = validatePrintJob(await readBody(request));
        const result = await enqueuePrint(job);
        return json(response, 202, { ok: true, jobId: job.id, ...result });
      }
      return json(response, 404, { error: "Bridge route not found." });
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "Print Bridge request failed." });
    }
  });
  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server)));
}

module.exports = { startBridgeServer, isPrivateNetworkAddress };
