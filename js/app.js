import { CONFIG } from "./config.js";
import { getSession, login, logout } from "./auth.js";
import { AudioMixer } from "./mixer.js";
import { SourcePlayer } from "./source.js";
import { PublishSession } from "./streaming.js";
import { isStreamLive } from "./streamLock.js";
import { NetworkMonitor } from "./network.js";

// ----------------------------------------------------------------- state

let session = null;
let mixer = null;
let sourcePlayer = null;
let publishSession = null;
let remoteStreamRef = null;
let isPublishing = false;
let networkMonitor = null;
let sourceReady = false;

// Web Audio analysers for the three meters (remote / mic / mixed output)
let analyserRemote, analyserMic, analyserOutput;
let meterRafId = null;

// ------------------------------------------------------------- DOM refs

const loginScreen = document.getElementById("loginScreen");
const consoleScreen = document.getElementById("consoleScreen");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginSubmit = document.getElementById("loginSubmit");
const welcomeText = document.getElementById("welcomeText");
const logoutBtn = document.getElementById("logoutBtn");

const playStatusPill = document.getElementById("playStatusPill");
const connectionPill = document.getElementById("connectionPill");
const reloadSourceBtn = document.getElementById("reloadSourceBtn");
const languageSelect = document.getElementById("languageSelect");
const streamIdReadout = document.getElementById("streamIdReadout");
const micToggle = document.getElementById("micToggle");
const micToggleLabel = document.getElementById("micToggleLabel");
const enableAudioBtn = document.getElementById("enableAudioBtn");
const publishError = document.getElementById("publishError");
const remoteVideo = document.getElementById("remoteVideo");
const autoplayOverlay = document.getElementById("autoplayOverlay");

const canvasRemote = document.getElementById("meterRemote");
const canvasMic = document.getElementById("meterMic");
const canvasOutput = document.getElementById("meterOutput");

let outputRecorder = null;
let outputRecordedChunks = [];

const recordOutputBtn = document.getElementById("recordOutputBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const downloadOutputBtn = document.getElementById("downloadOutputBtn");

// ------------------------------------------------------------------ init

function populateLanguages() {
  languageSelect.innerHTML = "";
  for (const lang of CONFIG.LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = lang.label;
    languageSelect.appendChild(opt);
  }
  updateStreamIdReadout();
}

function updateStreamIdReadout() {
  const code = languageSelect.value;
  streamIdReadout.textContent = code ? `${CONFIG.STREAM_PREFIX}-${code}` : "—";
}

function showConsole() {
  loginScreen.classList.add("hidden");
  consoleScreen.classList.remove("hidden");
  welcomeText.textContent = session.displayName ? `Signed in as ${session.displayName}` : "";
  populateLanguages();
  startSource();
}

function showLogin() {
  consoleScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginError.textContent = "";
}

// ---------------------------------------------------------------- login

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  loginSubmit.disabled = true;
  loginSubmit.textContent = "Signing in…";

  // Create/resume the AudioContext right inside this click's call stack —
  // the most reliable place to satisfy browsers' autoplay-gesture rules,
  // since by the time the stream actually connects (onStreamReady) this
  // gesture may no longer count in stricter browsers like Safari.
  if (!mixer) mixer = new AudioMixer();
  mixer.resume().catch(() => {});

  try {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    session = await login(username, password);
    showConsole();
  } catch (err) {
    loginError.textContent = err.message || "Something went wrong. Try again.";
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Sign in";
  }
});

logoutBtn.addEventListener("click", () => {
  teardownEverything();
  logout();
  session = null;
  showLogin();
});

// ------------------------------------------------------------ source

/**
 * The "Start interpreting" button is only enabled once there's a source
 * stream we can actually mix with — i.e. setupRemoteAnalyser confirmed
 * the mixer connected a real audio track. This is the same condition
 * that used to crash the mixer when it wasn't checked (see setRemoteStream).
 */
function setSourceReady(ready) {
  sourceReady = ready;
  if (isPublishing) return; // don't fight the "Stop interpreting" state
  micToggle.disabled = !ready;
  micToggleLabel.textContent = ready ? "Start interpreting" : "Waiting for source stream…";
}

function createSourcePlayer() {
  return new SourcePlayer({
    videoElement: remoteVideo,
    onStreamReady: (stream) => {
      remoteStreamRef = stream;
      playStatusPill.textContent = "live";
      playStatusPill.dataset.state = "live";
      autoplayOverlay.classList.add("hidden");
      setupRemoteAnalyser(stream);
      refreshAudioEnableBanner();
    },
    onAutoplayBlocked: () => {
      autoplayOverlay.classList.remove("hidden");
    },
    onError: (err) => {
      console.error(err);
      playStatusPill.textContent = "error";
      playStatusPill.dataset.state = "error";
      publishError.textContent = err.message || "Couldn't load the source stream.";
      setSourceReady(false);
    }
  });
}

function startSource() {
  playStatusPill.textContent = "connecting…";
  playStatusPill.dataset.state = "connecting";
  autoplayOverlay.classList.add("hidden");
  setSourceReady(false);

  sourcePlayer = createSourcePlayer();

  publishSession = new PublishSession({
    onPublishStateChange: (state, streamId) => {
      if (state === "live") {
        micToggleLabel.textContent = "Stop interpreting";
        micToggle.setAttribute("aria-pressed", "true");
        publishError.textContent = "";
      }
      if (state === "stopped") {
        micToggleLabel.textContent = "Start interpreting";
        micToggle.setAttribute("aria-pressed", "false");
      }
      if (state === "error") {
        micToggleLabel.textContent = "Start interpreting";
        micToggle.setAttribute("aria-pressed", "false");
        publishError.textContent = `Couldn't publish to ${streamId}.`;
      }
    },
    onError: (err) => console.error(err)
  });

  sourcePlayer.start();

  networkMonitor = new NetworkMonitor({ onUpdate: updateConnectionPill });
  networkMonitor.start();
}

/**
 * Reloads just the source stream connection — e.g. it froze or dropped
 * without any error — without touching login, publish state config, or
 * reloading the page. If currently interpreting, that has to stop first:
 * the published video track came from the old source connection, and
 * there's no clean way to hot-swap it mid-publish with this adaptor.
 */
function reloadSource() {
  if (isPublishing) {
    stopInterpreting();
    publishError.textContent = "Interpreting stopped because the source was reloaded — start again once it reconnects.";
  }

  if (sourcePlayer) sourcePlayer.stop();
  remoteStreamRef = null;
  setSourceReady(false);

  playStatusPill.textContent = "connecting…";
  playStatusPill.dataset.state = "connecting";
  autoplayOverlay.classList.add("hidden");

  sourcePlayer = createSourcePlayer();
  sourcePlayer.start();
}

reloadSourceBtn.addEventListener("click", reloadSource);

function updateConnectionPill({ rttMs, quality, effectiveType, downlinkMbps }) {
  connectionPill.dataset.state = quality;

  if (quality === "offline") {
    connectionPill.textContent = "offline";
    return;
  }

  const parts = [];
  if (rttMs != null) parts.push(`${rttMs}ms`);
  if (downlinkMbps != null) parts.push(`${downlinkMbps}Mbps`);
  else if (effectiveType) parts.push(effectiveType);

  connectionPill.textContent = parts.length ? parts.join(" · ") : quality;
}

autoplayOverlay.addEventListener("click", () => {
  if (mixer) mixer.resume().catch(() => {});
  sourcePlayer.resumePlayback();
});

enableAudioBtn.addEventListener("click", async () => {
  if (!mixer) mixer = new AudioMixer();
  await mixer.resume().catch(() => {});
  refreshAudioEnableBanner();
});

/** Shows a manual "Enable audio" fallback if the AudioContext is still
 *  suspended after the automatic resume attempts — this is the last
 *  resort for browsers that didn't honor the earlier gesture-tied calls. */
function refreshAudioEnableBanner() {
  if (mixer && !mixer.isRunning) {
    enableAudioBtn.classList.remove("hidden");
  } else {
    enableAudioBtn.classList.add("hidden");
  }
}

// -------------------------------------------------------- mic / publish

micToggle.addEventListener("click", async () => {
  publishError.textContent = "";

  if (isPublishing) {
    stopInterpreting();
    return;
  }

  if (!mixer) mixer = new AudioMixer();
  mixer.resume().catch(() => {}); // tied directly to this click, before any awaits below

  const langCode = languageSelect.value;
  const streamId = `${CONFIG.STREAM_PREFIX}-${langCode}`;
    
    if (!remoteStreamRef) {
      publishError.textContent = "Source stream not ready yet. Try again in a moment.";
      return;
    }

  micToggle.disabled = true;
  micToggleLabel.textContent = "Checking availability…";

  try {
    const alreadyLive = await isStreamLive(streamId);
    if (alreadyLive) {
      publishError.textContent =
        `Someone is already interpreting into ${streamId}. Pick another language or try again later.`;
      micToggleLabel.textContent = "Start interpreting";
      return;
    }

    if (!mixer) mixer = new AudioMixer();
    if (remoteStreamRef) mixer.setRemoteStream(remoteStreamRef);

    micToggleLabel.textContent = "Requesting mic…";
    await mixer.setMicEnabled(true);
    setupMicAndOutputAnalysers();

    const remoteVideoTrack = remoteStreamRef ? remoteStreamRef.getVideoTracks()[0] : null;
    const outputStream = mixer.getOutputStream(remoteVideoTrack);

    publishSession.start(outputStream, langCode, session.streamToken);
    isPublishing = true;
    languageSelect.disabled = true;
    refreshAudioEnableBanner();
  } catch (err) {
    console.error(err);
    publishError.textContent = err.message || "Couldn't access the microphone.";
    micToggleLabel.textContent = "Start interpreting";
  } finally {
    micToggle.disabled = false;
  }
});

function stopInterpreting() {
  publishSession.stop();
  if (mixer) mixer.setMicEnabled(false);
  isPublishing = false;
  languageSelect.disabled = false;
  micToggleLabel.textContent = "Start interpreting";
  micToggle.setAttribute("aria-pressed", "false");
}

languageSelect.addEventListener("change", () => {
  updateStreamIdReadout();
  // If already interpreting, re-publish under the new language's stream ID.
  if (isPublishing) {
    stopInterpreting();
  }
});

// -------------------------------------------------------------- meters
//
// Three small canvases show live input levels: the original broadcast,
// the interpreter's mic, and the resulting mixed output. This doubles as
// a sanity check that mixing is actually happening.

function setupRemoteAnalyser(stream) {
  if (!mixer) mixer = new AudioMixer();
  const connected = mixer.setRemoteStream(stream);
  if (connected) {
    analyserRemote = tapAnalyser(mixer.audioCtx, mixer.remoteSourceNode);
    ensureMeterLoop();
  }
  // If not connected yet (no audio track on the stream), source.js will
  // call onStreamReady again once one arrives, retrying this function.
  setSourceReady(connected);
}

function setupMicAndOutputAnalysers() {
    console.log("Around here");
  analyserMic = tapAnalyser(mixer.audioCtx, mixer.micGain);
  analyserOutput = tapAnalyser(mixer.audioCtx, mixer.masterGain);
  ensureMeterLoop();
}

function tapAnalyser(audioCtx, sourceNode) {
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  sourceNode.connect(analyser);
    console.log("Just here");
  analyser.connect(audioCtx.destination); // Chain it properly
  return analyser;
}

function ensureMeterLoop() {
  if (meterRafId) return;
  const dataArray = new Uint8Array(128);

  function draw(canvas, analyser, color) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const level = Math.min(1, avg / 90); // normalize roughly to 0–1

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width * level, canvas.height);
  }

  function loop() {
    draw(canvasRemote, analyserRemote, "#3fc7b8");
    draw(canvasMic, analyserMic, "#f2a93b");
    draw(canvasOutput, analyserOutput, "#eceff4");
    meterRafId = requestAnimationFrame(loop);
  }
  loop();
}

function stopMeterLoop() {
  if (meterRafId) {
    cancelAnimationFrame(meterRafId);
    meterRafId = null;
  }
}

recordOutputBtn.addEventListener("click", () => {
  if (!mixer || !mixer.destinationNode) {
    alert("Mixer not ready yet");
    return;
  }

  outputRecordedChunks = [];
  const outputStream = mixer.destinationNode.stream;

  try {
    outputRecorder = new MediaRecorder(outputStream, {
      mimeType: "audio/webm;codecs=opus"
    });

    outputRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        outputRecordedChunks.push(event.data);
      }
    };

    outputRecorder.onstop = () => {
      console.log("Recording stopped, chunks:", outputRecordedChunks.length);
      downloadOutputBtn.disabled = false;
    };

    outputRecorder.start();
    recordOutputBtn.disabled = true;
    stopRecordBtn.disabled = false;
    console.log("Recording started");
  } catch (err) {
    console.error("Failed to start recording:", err);
    alert(`Recording failed: ${err.message}`);
  }
});

// Stop recording
stopRecordBtn.addEventListener("click", () => {
  if (outputRecorder && outputRecorder.state !== "inactive") {
    outputRecorder.stop();
    stopRecordBtn.disabled = true;
    recordOutputBtn.disabled = false;
  }
});

// Download the recorded file
downloadOutputBtn.addEventListener("click", () => {
  if (outputRecordedChunks.length === 0) {
    alert("No recording to download");
    return;
  }

  const blob = new Blob(outputRecordedChunks, { type: "audio/webm" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `output-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`Downloaded ${blob.size} bytes`);
});

// -------------------------------------------------------------- teardown

function teardownEverything() {
  stopMeterLoop();
    
    if (outputRecorder && outputRecorder.state !== "inactive") {
        outputRecorder.stop();
        outputRecordedChunks = [];
      }
  if (isPublishing) stopInterpreting();
  if (sourcePlayer) sourcePlayer.stop();
  if (publishSession) publishSession.stop();
  if (mixer) mixer.teardown();
  if (networkMonitor) networkMonitor.stop();
  mixer = null;
  sourcePlayer = null;
  publishSession = null;
  networkMonitor = null;
  remoteStreamRef = null;
  setSourceReady(false);
}

window.addEventListener("beforeunload", teardownEverything);

// -------------------------------------------------------------- bootstrap

session = getSession();
if (session) {
  showConsole();
} else {
  showLogin();
}

const IS_LOCAL_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);

if ("serviceWorker" in navigator) {
  if (IS_LOCAL_DEV) {
    // Never register on localhost, and proactively clear out any SW/cache
    // left over from earlier testing — this is precisely the class of bug
    // where stale cached JS/HTML silently masks real code changes.
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    });
  }
}
