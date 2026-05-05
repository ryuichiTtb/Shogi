#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const BASE_URL = process.env.CARD_SHOGI_LAYOUT_BASE_URL ?? "http://localhost:3000";
const SCENARIOS = ["initial", "progress1", "progress4", "many-hands", "captured", "trap", "drawer", "end"];
const VIEWPORTS = [
  { name: "mobile-320x568", width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
  { name: "mobile-360x640", width: 360, height: 640, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-360x740", width: 360, height: 740, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-375x812", width: 375, height: 812, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-390x844", width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-393x852", width: 393, height: 852, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-414x896", width: 414, height: 896, deviceScaleFactor: 3, mobile: true },
  { name: "mobile-430x932", width: 430, height: 932, deviceScaleFactor: 3, mobile: true },
  { name: "desktop-1280x800", width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
  { name: "desktop-1366x768", width: 1366, height: 768, deviceScaleFactor: 1, mobile: false },
  { name: "desktop-1440x900", width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  { name: "desktop-1920x1080", width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
];

if (typeof WebSocket === "undefined") {
  console.error("This audit requires a Node.js runtime with global WebSocket support.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 10_000, init = undefined) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res.json();
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.diagnostics = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        this.diagnostics.push(`browser exception: ${details?.exception?.description ?? details?.text ?? "unknown"}`);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? "")
          .filter(Boolean)
          .join(" ");
        this.diagnostics.push(`browser console error: ${text || "unknown"}`);
      }
      if (message.method && this.events.has(message.method)) {
        for (const resolve of this.events.get(message.method)) resolve(message.params);
        this.events.delete(message.method);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  waitFor(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const wrapped = (params) => {
        clearTimeout(timeout);
        resolve(params);
      };
      const listeners = this.events.get(method) ?? [];
      listeners.push(wrapped);
      this.events.set(method, listeners);
    });
  }

  close() {
    this.ws.close();
  }

  clearDiagnostics() {
    this.diagnostics = [];
  }

  getDiagnostics() {
    return [...this.diagnostics];
  }
}

async function createPage(port) {
  const target = await waitForJson(`http://127.0.0.1:${port}/json/new?about:blank`, 10_000, { method: "PUT" });
  const page = new CdpPage(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return page;
}

async function runAudit(page, viewport, scenario) {
  page.clearDiagnostics();
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });
  const url = `${BASE_URL}/dev/card-shogi-layout?scenario=${scenario}`;
  const load = page.waitFor("Page.loadEventFired");
  await page.send("Page.navigate", { url });
  await load;
  await waitForLayoutReady(page);
  const { result } = await page.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(${auditInPage.toString()})(${JSON.stringify({ scenario })})`,
  });
  const value = result.value;
  const diagnostics = page.getDiagnostics();
  if (diagnostics.length > 0) {
    value.ok = false;
    value.failures.push(...diagnostics);
  }
  return value;
}

async function waitForLayoutReady(page, timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { result } = await page.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `Boolean(document.querySelector("[data-card-shogi-root][data-card-shogi-layout-mode]"))`,
    });
    if (result.value) {
      await sleep(100);
      return;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for card-shogi layout measurement");
}

function auditInPage({ scenario }) {
  const tolerance = 1.25;
  const failures = [];
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return el.isConnected && r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  };
  const all = (selector) => Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const first = (selector) => all(selector)[0] ?? null;
  const withinViewport = (name, el) => {
    const r = rectOf(el);
    if (r.left < -tolerance || r.right > window.innerWidth + tolerance) {
      failures.push(`${name} horizontally outside viewport: ${JSON.stringify(r)}`);
    }
    if (r.top < -tolerance || r.bottom > window.innerHeight + tolerance) {
      failures.push(`${name} vertically outside viewport: ${JSON.stringify(r)}`);
    }
  };
  const intersects = (a, b) =>
    a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance;

  const root = first("[data-card-shogi-root]");
  const board = first("[data-card-shogi-board]");
  const bottom = first("[data-card-shogi-bottom-controls]");
  const opponent = first("[data-card-shogi-opponent-area]");
  const playArea = first("[data-card-shogi-play-area]");
  if (!root) failures.push("missing root");
  if (!board) failures.push("missing board");
  if (!playArea) failures.push("missing play area");

  if (document.documentElement.scrollWidth > window.innerWidth + tolerance) {
    failures.push(`document horizontal scroll: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  }
  for (const [name, selector] of [
    ["root", "[data-card-shogi-root]"],
    ["play area", "[data-card-shogi-play-area]"],
    ["board", "[data-card-shogi-board]"],
    ["board grid", "[data-shogi-board-grid]"],
    ["bottom controls", "[data-card-shogi-bottom-controls]"],
    ["opponent area", "[data-card-shogi-opponent-area]"],
    ["deck", "[data-card-shogi-deck]"],
    ["trap", "[data-card-shogi-trap]"],
  ]) {
    for (const el of all(selector)) withinViewport(name, el);
  }

  if (board && bottom && intersects(rectOf(board), rectOf(bottom))) {
    failures.push("board overlaps bottom controls");
  }
  if (board && opponent && intersects(rectOf(board), rectOf(opponent))) {
    failures.push("board overlaps opponent area");
  }

  if (scenario === "progress4") {
    for (const svg of all("svg[role='progressbar']")) {
      const button = svg.closest("button");
      if (!button) continue;
      const sr = rectOf(svg);
      const br = rectOf(button);
      const delta = Math.max(
        Math.abs(sr.left - br.left),
        Math.abs(sr.top - br.top),
        Math.abs(sr.right - br.right),
        Math.abs(sr.bottom - br.bottom),
      );
      if (delta > tolerance) {
        failures.push(`progress ring differs from deck button by ${delta.toFixed(2)}px`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      scenario,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      squareSize: root?.getAttribute("data-card-shogi-square-size") ?? null,
      layoutMode: root?.getAttribute("data-card-shogi-layout-mode") ?? null,
      scrollWidth: document.documentElement.scrollWidth,
    },
  };
}

async function main() {
  const port = 9400 + Math.floor(Math.random() * 1000);
  const userDataDir = await mkdtemp(join(tmpdir(), "card-shogi-layout-audit-"));
  const chrome = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const page = await createPage(port);
    const failures = [];
    for (const viewport of VIEWPORTS) {
      for (const scenario of SCENARIOS) {
        const result = await runAudit(page, viewport, scenario);
        if (!result.ok) {
          failures.push({ viewport: viewport.name, scenario, failures: result.failures, metrics: result.metrics });
        }
        console.log(`${result.ok ? "PASS" : "FAIL"} ${viewport.name} ${scenario} square=${result.metrics.squareSize ?? "?"}`);
      }
    }
    page.close();
    if (failures.length > 0) {
      console.error(JSON.stringify(failures, null, 2));
      process.exitCode = 1;
    }
  } finally {
    chrome.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
