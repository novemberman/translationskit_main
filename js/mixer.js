/**
 * AudioMixer combines the original broadcast's audio with the local
 * interpreter's mic into a single MediaStream, ready to publish.
 *
 * Usage:
 *   const mixer = new AudioMixer();
 *   await mixer.setRemoteStream(remoteStream);   // from the play adaptor
 *   await mixer.setMicEnabled(true);             // requests getUserMedia
 *   const outputStream = mixer.getOutputStream(remoteVideoTrack);
 */
export class AudioMixer {
  constructor() {
    this.audioCtx = null;
    this.remoteSourceNode = null;
    this.micSourceNode = null;
    this.micStream = null;
    this.destinationNode = null;

    // Independent gain control per source so you can duck/balance levels
    // (e.g. lower original audio while the interpreter is speaking).
    this.remoteGain = null;
    this.micGain = null;
      this.masterGain = null;
  }

  _ensureContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();  // ADD THIS
        this.masterGain.gain.value = 1.0;
      this.destinationNode = this.audioCtx.createMediaStreamDestination();
    }
    // Best-effort — this often silently fails to actually unsuspend if
    // it's not called synchronously from within a click handler. Use
    // resume() below (called from app.js's click handlers) for the
    // version that reliably works.
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /**
   * Explicitly resumes the AudioContext. Call this synchronously as the
   * first line of a click/tap handler — some browsers (Safari in
   * particular) only honor resume() when it's directly inside the
   * gesture's call stack, not after any `await`. Returns the resulting
   * state ("running" if successful).
   */
  async resume() {
    this._ensureContext();
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
    return this.audioCtx.state;
  }

  get isRunning() {
    return this.audioCtx?.state === "running";
  }

  /**
   * Feed in the incoming broadcast's MediaStream (audio will be tapped).
   * If the stream doesn't have an audio track yet — common with WebRTC,
   * where video and audio tracks can arrive in separate callback events —
   * this is a no-op rather than a crash. Call it again once the audio
   * track shows up (source.js does this automatically).
   *
   * Returns true if a remote audio source is now connected.
   */
  setRemoteStream(remoteStream) {
    this._ensureContext();

    const audioTracks = remoteStream.getAudioTracks();
    if (audioTracks.length === 0) {
      return false;
    }

    if (this.remoteSourceNode) {
      this.remoteSourceNode.disconnect();
      this.remoteSourceNode = null;
    }

    const audioOnly = new MediaStream(audioTracks);
    this.remoteSourceNode = this.audioCtx.createMediaStreamSource(audioOnly);
    this.remoteGain = this.audioCtx.createGain();
    this.remoteGain.gain.value = 1.0;
    this.remoteSourceNode.connect(this.remoteGain).connect(this.masterGain);
    return true;
  }

  /**
   * Requests mic access and routes it into the mix. echoCancellation is
   * critical here: the user is hearing the original stream through
   * speakers while talking, so without AEC their own output leaks back
   * into what they publish. If you can require headphones, do — it's
   * more reliable than AEC alone.
   */
  async setMicEnabled(enabled) {
    this._ensureContext();

    if (!enabled) {
      if (this.micStream) {
        this.micStream.getTracks().forEach((t) => t.stop());
        this.micStream = null;
      }
      if (this.micSourceNode) {
        this.micSourceNode.disconnect();
        this.micSourceNode = null;
      }
      return;
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    this.micSourceNode = this.audioCtx.createMediaStreamSource(this.micStream);
    this.micGain = this.audioCtx.createGain();
    this.micGain.gain.value = 1.0;
    this.micSourceNode.connect(this.micGain).connect(this.masterGain);
  }
    
    getMasterGain() {
        return this.masterGain;
      }

  /** 0.0–1.0+ multiplier for the original stream's volume in the mix. */
  setRemoteLevel(value) {
    if (this.remoteGain) this.remoteGain.gain.value = value;
  }

  /** 0.0–1.0+ multiplier for the interpreter's mic level in the mix. */
  setMicLevel(value) {
    if (this.micGain) this.micGain.gain.value = value;
  }

  /**
   * Returns the combined MediaStream ready to publish: mixed audio track
   * plus the original video track passed through untouched.
   */
  getOutputStream(remoteVideoTrack) {
    const tracks = [...this.destinationNode.stream.getAudioTracks()];
    if (remoteVideoTrack) tracks.push(remoteVideoTrack);
    return new MediaStream(tracks);
  }

  teardown() {
    this.setMicEnabled(false);
    if (this.remoteSourceNode) this.remoteSourceNode.disconnect();
    if (this.audioCtx) this.audioCtx.close();
    this.audioCtx = null;
  }
}
