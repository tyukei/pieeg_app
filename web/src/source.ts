// Unified frame source: either the in-browser simulator or a live server WS.
// Both push the same Frame shape to a callback so chart.ts is source-agnostic.

import { bandPowersMean, bandPowersPerCh, type Bands } from "./fft";
import { NCH, SRATE, SimulatedPiEEG16 } from "./simulator";

export interface Frame {
  ts: number;
  srate: number;
  channels: number;
  raw: number[][]; // [N samples][ch]
  displayHz: number;
  bands: Bands;
  bandsPerCh: Record<string, number[]>;
  source: "simulator" | "server";
  winSec?: number;
  hopSec?: number;
}

export type FrameHandler = (f: Frame) => void;
export type StatusHandler = (connected: boolean, detail: string) => void;

export interface Source {
  start(): void;
  stop(): void;
  // Adjust the sliding analysis window (s) and slide/hop (s) at runtime.
  setConfig(winSec: number, hopSec: number): void;
}

const RAW_SECONDS = 6.0; // matches server buffer; ≥ max window + display headroom
const DISPLAY_HZ = 50;
export const DEFAULT_WIN_SEC = 1.0;
export const DEFAULT_HOP_SEC = 0.25;

// ---- Simulator (standalone / GitHub Pages) --------------------------------

export class SimulatorSource implements Source {
  private dev: SimulatedPiEEG16;
  private buf: number[][] = [];
  private timer: number | null = null;
  private winSec = DEFAULT_WIN_SEC;
  private hopSec = DEFAULT_HOP_SEC;

  constructor(
    private onFrame: FrameHandler,
    private onStatus: StatusHandler,
    seed = 1,
  ) {
    this.dev = new SimulatedPiEEG16(SRATE, seed);
  }

  setConfig(winSec: number, hopSec: number): void {
    this.winSec = winSec;
    this.hopSec = hopSec;
    if (this.timer !== null) {
      // restart the timer so the new hop cadence takes effect
      window.clearInterval(this.timer);
      this.timer = null;
      this.startTimer();
    }
  }

  start(): void {
    this.onStatus(true, "シミュレータ（ブラウザ内生成）");
    this.startTimer();
  }

  private startTimer(): void {
    const hopMs = Math.max(20, Math.round(this.hopSec * 1000));
    const maxLen = Math.round(SRATE * RAW_SECONDS);
    const step = Math.max(1, Math.round(SRATE / DISPLAY_HZ));
    this.timer = window.setInterval(() => {
      const perTick = Math.max(1, Math.round(SRATE * this.hopSec));
      const winN = Math.round(SRATE * this.winSec);
      for (const s of this.dev.readChunk(perTick)) this.buf.push(s);
      if (this.buf.length > maxLen) this.buf.splice(0, this.buf.length - maxLen);
      const analysis = this.buf.slice(-winN);
      if (analysis.length < 2) return;
      const raw: number[][] = [];
      for (let i = 0; i < this.buf.length; i += step) raw.push(this.buf[i]);
      this.onFrame({
        ts: Date.now() / 1000,
        srate: SRATE,
        channels: NCH,
        raw,
        displayHz: DISPLAY_HZ,
        bands: bandPowersMean(analysis, SRATE),
        bandsPerCh: bandPowersPerCh(analysis, SRATE),
        source: "simulator",
        winSec: this.winSec,
        hopSec: this.hopSec,
      });
    }, hopMs);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

// ---- Server (live PiEEG via WebSocket) ------------------------------------

export class ServerSource implements Source {
  private ws: WebSocket | null = null;
  private closed = false;
  private winSec = DEFAULT_WIN_SEC;
  private hopSec = DEFAULT_HOP_SEC;

  constructor(
    private url: string,
    private onFrame: FrameHandler,
    private onStatus: StatusHandler,
  ) {}

  setConfig(winSec: number, hopSec: number): void {
    this.winSec = winSec;
    this.hopSec = hopSec;
    // Send config to the server; it adjusts the shared sliding window.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ win_sec: winSec, hop_sec: hopSec }));
    }
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  private connect(): void {
    // Browsers block insecure ws:// from an https:// page (mixed content).
    if (location.protocol === "https:" && this.url.startsWith("ws://")) {
      this.onStatus(false, "HTTPSページからは wss:// が必要です（ws:// はブロックされます）");
      return;
    }
    this.onStatus(false, `接続中… ${this.url}`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.onStatus(false, `URLが不正です: ${this.url}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus(true, `接続済み ${this.url}`);
      // Push the UI's current window/hop so the server matches on (re)connect.
      ws.send(JSON.stringify({ win_sec: this.winSec, hop_sec: this.hopSec }));
    };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        this.onFrame({
          ts: d.ts,
          srate: d.srate,
          channels: d.channels,
          raw: d.raw,
          displayHz: d.display_hz ?? d.srate,
          bands: d.bands,
          bandsPerCh: d.bands_per_ch,
          source: "server",
          winSec: d.win_sec,
          hopSec: d.hop_sec,
        });
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.onStatus(false, "切断されました");
      if (!this.closed) window.setTimeout(() => this.connect(), 2000); // auto-retry
    };
    ws.onerror = () => this.onStatus(false, `接続エラー ${this.url}`);
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
