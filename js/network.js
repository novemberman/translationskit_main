/**
 * NetworkMonitor reports a rough, continuously-updated read on the
 * user's connection quality — useful context for an interpreter deciding
 * whether choppy audio is their network or something else.
 *
 * Two signals, combined:
 *  - Network Information API (`navigator.connection`) — effectiveType
 *    ("4g", "3g"...) and downlink estimate in Mbps. Chromium only;
 *    absent on Safari/Firefox.
 *  - An active round-trip probe: fetch a tiny same-origin file on an
 *    interval and time it. Works everywhere, and reflects the actual
 *    path to this server rather than the OS-level radio estimate.
 */
export class NetworkMonitor {
  constructor({ onUpdate, probeUrl = "manifest.json", intervalMs = 6000 } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this.probeUrl = probeUrl;
    this.intervalMs = intervalMs;
    this.timerId = null;
    this._connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    this._onConnectionChange = () => this._emit();
    this._onOnlineChange = () => this._probeOnce();
  }

  start() {
    this._probeOnce();
    this.timerId = setInterval(() => this._probeOnce(), this.intervalMs);
    if (this._connection) {
      this._connection.addEventListener("change", this._onConnectionChange);
    }
    window.addEventListener("online", this._onOnlineChange);
    window.addEventListener("offline", this._onOnlineChange);
  }

  stop() {
    if (this.timerId) clearInterval(this.timerId);
    this.timerId = null;
    if (this._connection) {
      this._connection.removeEventListener("change", this._onConnectionChange);
    }
    window.removeEventListener("online", this._onOnlineChange);
    window.removeEventListener("offline", this._onOnlineChange);
  }

  async _probeOnce() {
    if (!navigator.onLine) {
      this._emit({ rttMs: null, quality: "offline" });
      return;
    }

    const url = `${this.probeUrl}?probe=${Date.now()}`;
    const start = performance.now();
    try {
      await fetch(url, { method: "HEAD", cache: "no-store" });
      const rttMs = Math.round(performance.now() - start);
      this._emit({ rttMs, quality: this._qualityFromRtt(rttMs) });
    } catch {
      this._emit({ rttMs: null, quality: "offline" });
    }
  }

  _qualityFromRtt(rttMs) {
    if (rttMs < 150) return "good";
    if (rttMs < 400) return "fair";
    return "poor";
  }

  _emit(active) {
    const info = active || {};
    this.onUpdate({
      rttMs: info.rttMs ?? null,
      quality: info.quality || "unknown",
      effectiveType: this._connection?.effectiveType || null,
      downlinkMbps: this._connection?.downlink ?? null
    });
  }
}
