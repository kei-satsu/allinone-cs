const { execFile } = require("child_process");

function standardPapers() {
  return [
    { id: "4x6", name: "4 × 6 in", widthMicrons: 101600, heightMicrons: 152400 },
    { id: "a5", name: "A5", widthMicrons: 148000, heightMicrons: 210000 },
    { id: "a4", name: "A4", widthMicrons: 210000, heightMicrons: 297000 },
  ];
}

function powershellPaperSizes(printerName) {
  const safePrinter = JSON.stringify(printerName);
  const script = `Add-Type -AssemblyName System.Drawing; $s=New-Object System.Drawing.Printing.PrinterSettings; $s.PrinterName=${safePrinter}; @($s.PaperSizes | ForEach-Object { [PSCustomObject]@{ id=[string]$_.RawKind; name=$_.PaperName; widthMicrons=[int]($_.Width*254); heightMicrons=[int]($_.Height*254) } }) | ConvertTo-Json -Compress`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true, timeout: 7000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve([]);
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve((Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item?.name && item?.widthMicrons > 0 && item?.heightMicrons > 0));
      } catch {
        resolve([]);
      }
    });
  });
}

async function discoverPrinters(webContents) {
  const printers = await webContents.getPrintersAsync();
  return Promise.all(printers.map(async (printer) => {
    const supportedPapers = await powershellPaperSizes(printer.name);
    return {
      id: printer.name,
      name: printer.displayName || printer.name,
      isDefault: Boolean(printer.isDefault),
      status: printer.status || 0,
      papers: supportedPapers.length ? supportedPapers : standardPapers(),
    };
  }));
}

module.exports = { discoverPrinters, standardPapers };
