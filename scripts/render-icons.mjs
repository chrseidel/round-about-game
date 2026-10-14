// Renders public/icon.svg into the PNG icons (apple-touch-icon 180, 192, 512, favicon 32)
// with headless Chrome. Run after changing the icon: node scripts/render-icons.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [svgPath, outDir] = ["public/icon.svg", "public"];
const svg = readFileSync(svgPath, "utf8");
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "icon-"))}`,
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);
let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    target = await (
      await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
        method: "PUT",
      })
    ).json();
  } catch {
    await sleep(200);
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, (m) =>
      m.error ? rej(new Error(m.error.message)) : res(m.result),
    );
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await send("Page.enable");
try {
  for (const [name, size] of [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["favicon-32.png", 32],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: size,
      height: size,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const html = `<html><body style="margin:0;background:#5DBB63">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`;
    await send("Page.navigate", {
      url: "data:text/html;base64," + Buffer.from(html).toString("base64"),
    });
    await sleep(500);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
    });
    writeFileSync(join(outDir, name), Buffer.from(data, "base64"));
    console.log(name, size);
  }
} finally {
  chrome.kill();
  process.exit(0);
}
