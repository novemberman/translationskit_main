# Interlingo Console

A PWA for live interpretation/dubbing: users log in, watch a livestream,
speak over it, and their mic is mixed client-side with the original audio
and republished to Ant Media Server under a language-specific stream name.

No build step — plain ES modules served as static files.

## Files

```
index.html            Login screen + console UI
css/style.css          Styling
manifest.json          PWA manifest
service-worker.js      Offline app-shell caching
js/config.js            Publish AMS + SOURCE config, languages, ICE servers — edit this first
js/auth.js              Login/session (calls your backend, stores token)
js/source.js             Plays the ORIGINAL stream from anywhere (webrtc/hls/dash/mp4)
js/streaming.js          Publishes the mixed stream to your AMS server
js/mixer.js              Web Audio graph: mic + remote audio -> one output stream
js/network.js            Connection-quality monitor (latency probe + Network Info API)
js/streamLock.js         REST check to stop two people publishing one language
js/app.js                Wires everything to the DOM + live level meters
```

## 1. Configure

Edit `js/config.js`. There are two separate servers to think about:

- **Publish target** (`AMS_WEBSOCKET_URL`, `AMS_REST_URL`) — your own Ant
  Media Server, where interpreted output gets published.
- **Source** (`SOURCE`) — wherever the original broadcast actually lives.
  This can be a *different* Ant Media server, or not Ant Media at all:

  | `SOURCE.type` | Use when the original stream is served as… | Fields needed |
  |---|---|---|
  | `"webrtc"` | Another Ant Media (or compatible) WebRTC server | `websocketUrl`, `streamId`, `streamToken?` |
  | `"hls"` | An `.m3u8` playlist, any HTTP(S) origin | `url` |
  | `"dash"` | An `.mpd` manifest | `url` |
  | `"mp4"` | Any direct media URL a `<video>` can play | `url` |

  For `hls`/`dash`/`mp4`, playback goes through the `<video>` element and
  the audio+video is captured back out with `captureStream()` for mixing.
  **The source server must send `Access-Control-Allow-Origin` for this
  app's origin** — without it, the browser hands back a muted audio
  track (a browser privacy protection, not a bug) and mixing produces
  silence. If you don't control the source server, proxy it through one
  you do and add the header there.

Also set:
- `AUTH_LOGIN_ENDPOINT` — your auth backend
- `LANGUAGES` — add/remove languages; each becomes `interpretation-{code}`

## 2. Auth backend contract

`js/auth.js` POSTs `{ username, password }` to `AUTH_LOGIN_ENDPOINT` and
expects:

```json
{ "token": "app-jwt", "streamToken": "ams-jwt-or-empty", "displayName": "Jane" }
```

`streamToken` is only needed if you've turned on Ant Media's JWT stream
security — pass `""` if you haven't.

### Testing without a backend yet

`js/config.js` has a `MOCK_AUTH` block, **enabled by default**. While
it's on, login checks against the hardcoded list right in the browser
instead of calling `AUTH_LOGIN_ENDPOINT` — no server needed to click
through the app. Default credentials:

```
username: interpreter   password: changeme
username: admin         password: changeme
```

Add/remove users directly in `MOCK_AUTH.users`. **This has no real
security** — the credentials are visible in the page source — so set
`MOCK_AUTH.enabled` to `false` (or delete the block) once you've wired
up a real `AUTH_LOGIN_ENDPOINT`, and definitely before this goes
anywhere someone other than you can reach it.

## 3. Serve it

Any static file server works, but it must be **HTTPS** (or localhost) —
`getUserMedia` and service workers both require a secure context:

```bash
npx serve .
# or
python3 -m http.server 8000   # http://localhost is exempt from the HTTPS rule
```

## 4. CORS on Ant Media

The stream-lock check (`js/streamLock.js`) calls AMS's REST API directly
from the browser — make sure CORS is enabled for your app's origin in
Ant Media's settings, or proxy that endpoint through your own backend.

If that check logs a `401`/`403` in the console: Ant Media's REST API
has its own optional security separate from your app's login. If you've
enabled it on the AMS side, set `CONFIG.AMS_REST_AUTH.username`/`password`
in `config.js` (Basic Auth). Leave both blank if REST access is open
(Ant Media's default for most self-hosted setups) — sending a bogus
Authorization header when AMS doesn't expect one can itself trigger a
403, so don't fill these in unless AMS is actually configured to require
them. Either way this check fails open: a rejected/broken lock check
just logs a warning and lets publishing proceed, it never blocks you.

## How the pieces fit together

1. **Login** (`auth.js`) — stores a session in `localStorage`.
2. **Source playback** (`source.js`) — connects to whatever `SOURCE.type`
   you configured (a WebRTC server, HLS, DASH, or plain MP4), plays it
   into `#remoteVideo`, and hands a `MediaStream` back to `app.js` via
   `onStreamReady`. For non-WebRTC sources this comes from
   `captureStream()` on the video element, so it needs a user gesture if
   autoplay-with-audio is blocked — handled by the "tap to start
   playback" overlay.
3. **Mixing** (`mixer.js`) — on "Start interpreting", requests the mic
   (with echo cancellation on) and combines it with the source stream's
   audio track through a `MediaStreamAudioDestinationNode`, plus the
   original video track passed through untouched. Mixing only starts
   once the source stream actually has a live audio track — see next.
4. **Lock check** (`streamLock.js`) — before publishing, checks whether
   the selected language's stream is already `"broadcasting"` on your
   publish AMS so two interpreters can't collide. Best-effort from the
   client; for a hard guarantee, enforce the same rule server-side. Uses
   `AMS_REST_AUTH` for its own auth if you've set it — this is
   intentionally separate from the app's user login (`session.token`),
   which AMS has no way to understand.
5. **Publish** (`streaming.js`) — publishes the mixed stream to your own
   AMS under `interpretation-{languageCode}`, independent of where the
   source came from.
6. **Meters** (`app.js`) — three `AnalyserNode`s tap the source, mic, and
   mixed-output audio so you can visually confirm mixing is live.
7. **Connection quality** (`network.js`) — pings a same-origin file every
   few seconds and, where the browser supports it, reads
   `navigator.connection` for effective type/downlink. Shown as the pill
   next to the source status.
8. **Reload source** (`app.js` `reloadSource()`) — if the source stream
   stalls or drops, the ⟳ button tears down just the `SourcePlayer` and
   reconnects it, without touching login or reloading the page. If
   you're actively interpreting when you hit reload, publishing stops
   first — the mixed track that was already being sent came from the
   old connection, so there's no clean way to hot-swap it mid-publish.
   Start interpreting again once the source reconnects.
9. **"Start interpreting" gating** (`app.js` `setSourceReady()`) — the
   button stays disabled ("Waiting for source stream…") until the
   mixer actually has a live remote audio track connected. It doesn't
   just track "is the video playing" — a stream can be live with video
   but no audio yet (see the WebRTC track-timing note above), and
   mixing needs the audio specifically. The button re-enables the
   moment `setupRemoteAnalyser` confirms a connection, and disables
   again on reload, source error, or logout.

## Known gaps to close before production

- **Mock auth is on by default**: `MOCK_AUTH.enabled` in `config.js` is
  `true` out of the box. Turn it off once a real backend is wired up —
  see above.
- **TURN server**: only STUN is configured (`config.js`). Add a TURN
  server — a meaningful fraction of real networks need it to establish
  a WebRTC connection at all.
- **Stream-lock race**: the check-then-publish flow has a small race
  window; move the enforcement into a server you control if two
  interpreters colliding is a real risk.
- **Reconnection**: neither adaptor currently auto-reconnects on network
  drop — add retry logic in the `callbackError` handlers for production
  use.
- **Icons**: `icons/icon-192.png` and `icon-512.png` are placeholders —
  swap in real artwork.
