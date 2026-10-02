// App wiring: pick a source (in-browser simulator or a live server), render each
// frame to waveform + bands + mind-state + topography + 3D electrode views.

import { Brain3D } from "./brain3d";
import { drawBands, drawMindTimeline, drawWaveform } from "./chart";
import { mindState, trailingMean } from "./mind";
import { type Frame, ServerSource, SimulatorSource, type Source } from "./source";
import { drawTopography } from "./topography";
import { Trajectory3D } from "./trajectory3d";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const waveCanvas = $<HTMLCanvasElement>("wave");
const bandsCanvas = $<HTMLCanvasElement>("bands");
const topoCanvas = $<HTMLCanvasElement>("topo");
const brainCanvas = $<HTMLCanvasElement>("brain3d");
const mindTimelineCanvas = $<HTMLCanvasElement>("mind-timeline");
const statusEl = $("status");
const statusDot = $("status-dot");
const modeSel = $<HTMLSelectElement>("mode");
const urlInput = $<HTMLInputElement>("server-url");
const applyBtn = $<HTMLButtonElement>("apply");
const bandTable = $("band-values");
const meta = $("meta");
const topoBandSel = $<HTMLSelectElement>("topo-band");
const brainBandLabel = $("brain3d-band-label");
const trajCanvas = $<HTMLCanvasElement>("traj3d");
const winSel = $<HTMLSelectElement>("win-sec");
const hopSel = $<HTMLSelectElement>("hop-sec");

const mindLabel = $("mind-label");
const mindHint = $("mind-hint");
const mindCard = $("mind-card");
const focusFill = $("focus-fill");
const relaxFill = $("relax-fill");
const focusNum = $("focus-num");
const relaxNum = $("relax-num");
const mindMeta = $("mind-meta");

const HINTS: Record<string, string> = {
  focused: "β > α: 認知活動が高い",
  relaxed: "α > β: α優位でリラックス",
  neutral: "α と β が拮抗",
};

let current: Source | null = null;
const brain = new Brain3D(brainCanvas);
brain.start();
const traj = new Trajectory3D(trajCanvas);
traj.start();

// Rolling focus/relax history (client-side) for the timeline.
const MIND_HISTORY = 240; // ~24s at 10Hz
const mindHistory: { focus: number; relax: number }[] = [];

function setStatus(connected: boolean, detail: string): void {
  statusEl.textContent = detail;
  statusDot.className = connected ? "dot on" : "dot off";
}

function updateMind(f: Frame): void {
  const ms = mindState(f.bands);
  mindHistory.push({ focus: ms.focus, relax: ms.relax });
  if (mindHistory.length > MIND_HISTORY) mindHistory.shift();

  const focusSmooth = trailingMean(mindHistory.map((s) => s.focus), 3);
  const relaxSmooth = trailingMean(mindHistory.map((s) => s.relax), 3);

  mindLabel.textContent = ms.label;
  mindHint.textContent = HINTS[ms.status];
  mindCard.className = `card mind mind-${ms.status}`;
  focusFill.style.width = `${Math.max(0, Math.min(100, (focusSmooth / 2) * 100))}%`;
  relaxFill.style.width = `${Math.max(0, Math.min(100, relaxSmooth * 100))}%`;
  focusNum.textContent = focusSmooth.toFixed(2);
  relaxNum.textContent = relaxSmooth.toFixed(2);
  mindMeta.textContent = `16ch平均 · ${mindHistory.length} samples`;
  traj.push({ focus: focusSmooth, relax: relaxSmooth });
}

let lastFrame: Frame | null = null;

// Render everything derived from a frame (no state mutation) — reused on resize
// / enlarge so canvases repaint at their new size without waiting for new data.
function renderFrame(f: Frame): void {
  drawWaveform(waveCanvas, f.raw);
  drawBands(bandsCanvas, f.bands);
  bandTable.innerHTML = Object.entries(f.bands)
    .map(
      ([k, v]) =>
        `<div class="bv"><span class="bk">${k}</span><span class="bd">${v.toExponential(2)}</span> <span class="unit">μV²</span></div>`,
    )
    .join("");
  meta.textContent = `${f.source} · ${f.channels}ch · ${f.srate}Hz · ${f.raw.length} pts`;

  const band = topoBandSel.value;
  const perCh = f.bandsPerCh?.[band] ?? [];
  drawTopography(topoCanvas, perCh);
  brain.setData(perCh);
  brainBandLabel.textContent = band;
  drawMindTimeline(mindTimelineCanvas, mindHistory);
}

function onFrame(f: Frame): void {
  lastFrame = f;
  updateMind(f);
  renderFrame(f);
}

// Repaint static canvases after a layout change (brain3d/traj3d self-animate).
function redraw(): void {
  requestAnimationFrame(() => {
    if (lastFrame) renderFrame(lastFrame);
  });
}

function applyConfig(): void {
  const winSec = parseFloat(winSel.value);
  const hopSec = parseFloat(hopSel.value);
  current?.setConfig(winSec, hopSec);
}

function switchSource(): void {
  current?.stop();
  const serverMode = modeSel.value === "server";
  urlInput.disabled = !serverMode;
  current = serverMode
    ? new ServerSource(urlInput.value.trim(), onFrame, setStatus)
    : new SimulatorSource(onFrame, setStatus);
  current.start();
  applyConfig(); // sync the newly-created source to the UI's window/hop
}

// Default server URL depends on how the page is served:
// - HTTPS (GitHub Pages) → must use wss:// (browsers block ws:// from https).
//   Points at the Pi's tailscale-serve TLS endpoint. Change to your own host.
// - http/localhost (local dev) → the local server on ws://localhost:8000/ws.
const DEFAULT_WSS = "wss://pieeg.tail29b1d2.ts.net/ws";
const DEFAULT_WS_LOCAL = "ws://localhost:8000/ws";
urlInput.value = location.protocol === "https:" ? DEFAULT_WSS : DEFAULT_WS_LOCAL;

// URL params: ?mode=server&url=wss://host/ws  (override the default above)
const params = new URLSearchParams(location.search);
if (params.get("url")) urlInput.value = params.get("url")!;
if (params.get("mode") === "server") modeSel.value = "server";

applyBtn.addEventListener("click", switchSource);
modeSel.addEventListener("change", switchSource);
winSel.addEventListener("change", applyConfig);
hopSel.addEventListener("change", applyConfig);

// ── Click-to-enlarge: move a card into a fullscreen modal, restore on close ──
const modal = document.createElement("div");
modal.className = "modal hidden";
const closeBtn = document.createElement("button");
closeBtn.className = "modal-close";
closeBtn.type = "button";
closeBtn.textContent = "×";
closeBtn.title = "閉じる (Esc)";
modal.appendChild(closeBtn);
document.body.appendChild(modal);

const placeholder = document.createComment("card-placeholder");
let openCard: HTMLElement | null = null;

function enlarge(card: HTMLElement): void {
  if (openCard) return;
  openCard = card;
  card.replaceWith(placeholder);
  card.classList.add("enlarged");
  modal.appendChild(card);
  modal.classList.remove("hidden");
  redraw();
}

function closeModal(): void {
  if (!openCard) return;
  openCard.classList.remove("enlarged");
  placeholder.replaceWith(openCard);
  openCard = null;
  modal.classList.add("hidden");
  redraw();
}

closeBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

for (const card of Array.from(document.querySelectorAll<HTMLElement>("main .card"))) {
  card.addEventListener("click", (e) => {
    if (card.classList.contains("enlarged")) return; // clicks inside the modal card
    // Don't hijack clicks on the card's own controls.
    if ((e.target as HTMLElement).closest("select, input, button, option, a")) return;
    enlarge(card);
  });
}

// Keep canvases crisp when the window is resized.
window.addEventListener("resize", redraw);

switchSource();
