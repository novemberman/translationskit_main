import { CONFIG } from "./config.js";

/**
 * SourcePlayer plays the ORIGINAL broadcast into a <video> element and
 * hands back a MediaStream for mixing — regardless of where that source
 * actually lives. This is deliberately decoupled from the AMS server you
 * publish interpreted output to (AMS_WEBSOCKET_URL in config.js); the
 * source can be a totally different provider.
 *
 *   type "webrtc" — another WebRTCAdaptor session; stream comes straight
 *                    from the "newStreamAvailable" callback, no capture
 *                    needed.
 *   type "hls" / "dash" / "mp4" — played through the <video> element,
 *                    then tapped with HTMLMediaElement.captureStream().
 *                    Requires the source to allow CORS (see README) or
 *                    the captured audio track comes back muted.
 */
export class SourcePlayer {
  constructor({ videoElement, onStreamReady, onError, onAutoplayBlocked }) {
    this.videoElement = videoElement;
    this.onStreamReady = onStreamReady || (() => {});
    this.onError = onError || (() => {});
    this.onAutoplayBlocked = onAutoplayBlocked || (() => {});
    this.playAdaptor = null;
    this.hls = null;
    this.dash = null;
  }

  async start() {
    const src = CONFIG.SOURCE;
    try {
      switch (src.type) {
        case "webrtc":
          this._startWebRTC(src);
          break;
        case "hls":
          await this._startHls(src);
          break;
        case "dash":
          await this._startDash(src);
          break;
        case "mp4":
          await this._startNative(src);
          break;
        default:
          throw new Error(`Unknown SOURCE.type "${src.type}" in config.js`);
      }
    } catch (err) {
      this.onError(err);
    }
  }

  // -------------------------------------------------------------- webrtc

  _startWebRTC(src) {
    import("https://cdn.skypack.dev/@antmedia/webrtc_adaptor")
      .then(({ WebRTCAdaptor }) => {
        this.playAdaptor = new WebRTCAdaptor({
          websocket_url: src.websocketUrl,
          remoteVideoId: this.videoElement.id,
          mediaConstraints: { video: false, audio: false },
          sdp_constraints: { OfferToReceiveAudio: true, OfferToReceiveVideo: true },
          peerconnection_config: { iceServers: CONFIG.ICE_SERVERS },
          callback: (info, obj) => {
            if (info === "initialized") {
              this.playAdaptor.play(src.streamId, src.streamToken || "");
            }
            if (info === "newStreamAvailable") {
              this._notifyStreamReady(obj.stream);
            }
            if (info === "play_finished") {
              this.onError(new Error("Source stream playback ended."));
            }
          },
          callbackError: (error, message) => {
            this.onError(new Error(`Source WebRTC error: ${error} ${message || ""}`.trim()));
          }
        });
      })
      .catch((err) => this.onError(err));
  }

  // ----------------------------------------------------------------- hls

  async _startHls(src) {
    this.videoElement.crossOrigin = "anonymous";

    if (this.videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari plays HLS natively — no library needed.
      this.videoElement.src = src.url;
    } else {
      const { default: Hls } = await import("https://cdn.skypack.dev/hls.js");
      if (!Hls.isSupported()) {
        throw new Error("HLS isn't supported in this browser.");
      }
      this.hls = new Hls();
      this.hls.loadSource(src.url);
      this.hls.attachMedia(this.videoElement);
    }

    await this._playAndCapture();
  }

  // ---------------------------------------------------------------- dash

  async _startDash(src) {
    this.videoElement.crossOrigin = "anonymous";
    const dashjs = await import("https://cdn.skypack.dev/dashjs");
    this.dash = dashjs.MediaPlayer().create();
    this.dash.initialize(this.videoElement, src.url, true);
    await this._playAndCapture();
  }

  // ----------------------------------------------------------------- mp4

  async _startNative(src) {
    this.videoElement.crossOrigin = "anonymous";
    this.videoElement.src = src.url;
    await this._playAndCapture();
  }

  // -------------------------------------------------------- shared logic

  async _playAndCapture() {
    try {
      await this.videoElement.play();
    } catch (err) {
      // Autoplay-with-audio is commonly blocked until a user gesture.
      // Surface it so the UI can show a "tap to start" control; the
      // caller retries `resumePlayback()` from a click handler.
      this.onAutoplayBlocked();
    }
    this._captureFromVideo();
  }

  resumePlayback() {
    this.videoElement.play().then(() => this._captureFromVideo()).catch((err) => this.onError(err));
  }

  _captureFromVideo() {
    const capture = this.videoElement.captureStream || this.videoElement.mozCaptureStream;
    if (!capture) {
      this.onError(new Error("This browser doesn't support captureStream() on <video>."));
      return;
    }

    const stream = capture.call(this.videoElement);
    const audioTrack = stream.getAudioTracks()[0];

    if (audioTrack && audioTrack.muted) {
      this.onError(new Error(
        "The source stream's audio came back muted. This almost always means the " +
        "source server isn't sending Access-Control-Allow-Origin for this app's origin."
      ));
      return;
    }

    this.onStreamReady(stream);
    this._watchForLateAudio(stream);
  }

  /**
   * Wraps onStreamReady with a watcher: if the stream had no audio track
   * yet (common right after a WebRTC connection — video and audio tracks
   * can arrive in separate events), listen for one to appear and re-fire
   * onStreamReady once it does, so the mixer can pick it up automatically.
   */
  _notifyStreamReady(stream) {
    this.onStreamReady(stream);
    this._watchForLateAudio(stream);
  }

  _watchForLateAudio(stream) {
    if (stream.getAudioTracks().length > 0) return;
    if (typeof stream.addEventListener !== "function") return; // older Safari

    const handler = () => {
      if (stream.getAudioTracks().length > 0) {
        stream.removeEventListener("addtrack", handler);
        this.onStreamReady(stream);
      }
    };
    stream.addEventListener("addtrack", handler);
  }

  stop() {
    if (this.playAdaptor) {
      try { this.playAdaptor.stop(CONFIG.SOURCE.streamId); } catch { /* already stopped */ }
      this.playAdaptor = null;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.dash) {
      this.dash.reset();
      this.dash = null;
    }
    this.videoElement.pause();
    this.videoElement.removeAttribute("src");
    this.videoElement.load();
  }
}
