// App wiring: pick a source (in-browser simulator or a live server), render
// each frame to the waveform + band charts, show band values + status.

import { drawBands, drawWaveform } from "./chart";
import { type Frame, ServerSource, SimulatorSource, type Source } from "./source";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const waveCanvas = $<HTMLCanvasElement>("wave");
const bandsCanvas = $<HTMLCanvasElement>("bands");
const statusEl = $("status");
const statusDot = $("status-dot");
const modeSel = $<HTMLSelectElement>("mode");
const urlInput = $<HTMLInputElement>("server-url");
const applyBtn = $<HTMLButtonElement>("apply");
const bandTable = $("band-values");
const meta = $("meta");

let current: Source | null = null;

function setStatus(connected: boolean, detail: string): void {
  statusEl.textContent = detail;
  statusDot.className = connected ? "dot on" : "dot off";
}

function onFrame(f: Frame): void {
  drawWaveform(waveCanvas, f.raw);
  drawBands(bandsCanvas, f.bands);
  bandTable.innerHTML = Object.entries(f.bands)
    .map(
      ([k, v]) =>
        `<div class="bv"><span class="bk">${k}</span><span class="bd">${v.toExponential(2)}</span> <span class="unit">μV²</span></div>`,
    )
    .join("");
  meta.textContent = `${f.source} · ${f.channels}ch · ${f.srate}Hz · ${f.raw.length} pts`;
}

function switchSource(): void {
  current?.stop();
  const mode = modeSel.value;
  const serverMode = mode === "server";
  urlInput.disabled = !serverMode;
  if (serverMode) {
    current = new ServerSource(urlInput.value.trim(), onFrame, setStatus);
  } else {
    current = new SimulatorSource(onFrame, setStatus);
  }
  current.start();
}

// URL params let you deep-link a server, e.g. ?mode=server&url=ws://pi.local:8000/ws
const params = new URLSearchParams(location.search);
if (params.get("url")) urlInput.value = params.get("url")!;
if (params.get("mode") === "server") modeSel.value = "server";

applyBtn.addEventListener("click", switchSource);
modeSel.addEventListener("change", switchSource);
window.addEventListener("resize", () => {
  // Canvases re-fit on next frame automatically; nothing to do here.
});

switchSource();
