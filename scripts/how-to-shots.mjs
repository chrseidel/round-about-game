// Retakes the two "How to play" screenshots (public/how-to/*.webp) after the
// game's look changes. Development only: plays one short game in the sandbox.
// Needs Google Chrome, `cwebp` (brew install webp), the sandbox deployed and
// `npm run dev` running. Usage: node scripts/how-to-shots.mjs
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = mkdtempSync(join(tmpdir(), "how-to-"));
const BASE = "http://127.0.0.1:5173";
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "shots-"))}`,
    "--no-first-run",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function json(path, method = "GET") {
  for (let i = 0; i < 50; i++) {
    try {
      return await (
        await fetch(`http://127.0.0.1:${PORT}${path}`, { method })
      ).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("Chrome did not start");
}

/** One browser tab with a tiny CDP client. */
async function tab() {
  const target = await json("/json/new?about:blank", "PUT");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (m) =>
        m.error ? reject(new Error(m.error.message)) : resolve(m.result),
      );
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return {
    async go(url) {
      await send("Page.navigate", { url });
      await sleep(2500);
    },
    async run(expression) {
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(
          r.exceptionDetails.exception?.description ?? "evaluation failed",
        );
      return r.result.value;
    },
    async shoot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(out, file), Buffer.from(data, "base64"));
    },
  };
}

try {
  await json("/json/version");
  const tia = await tab();
  const gus = await tab();
  await tia.go(BASE + "/");
  await tia.run(`localStorage.setItem("round-about:language", "en"); true`);
  await tia.go(BASE + "/");
  const path = await tia.run(`(async () => {
    document.querySelector('#nickname').value = 'Tia';
    document.querySelector('button[value=host]').click();
    await new Promise(r => setTimeout(r, 3000));
    return location.pathname;
  })()`);
  await gus.go(BASE + path);
  await gus.run(`(async () => {
    document.querySelector('#nickname').value = 'Gus';
    document.querySelector('button[value=join]').click();
    await new Promise(r => setTimeout(r, 6000));
  })()`);
  await tia.run(`(async () => {
    document.querySelector('#claimTipster').click();
    await new Promise(r => setTimeout(r, 2500));
    document.querySelector('#startGame').click();
    await new Promise(r => setTimeout(r, 6000));
    document.querySelector('#drawButton').click();
    await new Promise(r => setTimeout(r, 2000));
    const input = document.querySelector('#clueInput');
    input.value = 'Harbor';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 3500));
  })()`);
  await tia.shoot("tipster.png");
  await tia.run(`document.querySelector('#sayButton').click(); true`);
  await sleep(3500);
  await gus.run(`(async () => {
    const style = document.createElement('style');
    style.textContent = '.exit.selected .chevrons { animation: none !important; }';
    document.head.append(style);
    document.querySelectorAll('.exit')[1].click();
    await new Promise(r => setTimeout(r, 2500));
  })()`);
  await gus.shoot("guesser.png");
  // Crop to the board and panel, then compress into the public folder.
  for (const name of ["tipster", "guesser"])
    execFileSync("cwebp", [
      "-quiet",
      "-q",
      "82",
      "-crop",
      "150",
      "85",
      "1115",
      "615",
      join(out, `${name}.png`),
      "-o",
      `public/how-to/${name}.webp`,
    ]);
  console.log("Updated public/how-to/tipster.webp and guesser.webp");
} finally {
  chrome.kill();
}
