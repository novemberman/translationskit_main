// ---------------------------------------------------------------------------
// Central configuration. Edit these values for your deployment.
// ---------------------------------------------------------------------------

export const CONFIG = {
  // The Ant Media Server you PUBLISH interpreted output to. This is
  // independent of wherever the source livestream lives — see SOURCE below.
  // Use wss:// (5443) for TLS, ws:// (5080) for plain HTTP.
  AMS_WEBSOCKET_URL: "wss://netshiftstreamkit.online:5443/julyHSLHS/websocket",

  // REST API root on the PUBLISH server, used to check/lock broadcasts
  // before publishing. e.g. https://YOUR_PUBLISH_AMS_DOMAIN:5443/LiveApp/rest/v2
  AMS_REST_URL: "https://netshiftstreamkit.online:5443/julyHSLHS/rest/v2",

  // Optional — only fill this in if you've enabled REST API security in
  // Ant Media Server's own settings (it's open by default on most
  // self-hosted setups). This is a separate credential from your app's
  // own user login — do NOT put a user's session token here, AMS has no
  // idea what that is and will reject it. Leave both blank to send no
  // Authorization header at all.
  AMS_REST_AUTH: {
    username: "",
    password: ""
  },

  // ---------------------------------------------------------------------
  // Where the ORIGINAL broadcast comes from. It does NOT have to be the
  // same server (or even the same protocol) as AMS_WEBSOCKET_URL above.
  // Pick one `type` and fill in only the fields it needs:
  //
  //   "webrtc" — any Ant Media (or compatible) WebRTC server.
  //     { type: "webrtc", websocketUrl, streamId, streamToken? }
  //
  //   "hls"    — an HLS playlist (.m3u8) from any HTTP(S) origin.
  //     { type: "hls", url }
  //
  //   "dash"   — an MPEG-DASH manifest (.mpd).
  //     { type: "dash", url }
  //
  //   "mp4"    — any direct HTTP(S) media URL a <video> tag can play.
  //     { type: "mp4", url }
  //
  // IMPORTANT for hls/dash/mp4: the source server must send
  // `Access-Control-Allow-Origin` for this app's origin. Without CORS,
  // the browser will hand back a muted/tainted audio track and mixing
  // will silently fail — see README.
  // ---------------------------------------------------------------------
    SOURCE: {
      type: "mp4",
      //websocketUrl: "wss://YOUR_SOURCE_AMS_DOMAIN:5443/LiveApp/websocket",
      //streamId: "original-stream",
      //streamToken: ""
    //url: "https://cetranslatorskit.com:8080/video.mp4"
      //url: "https://pvqybrzodz24-hls-live.5centscdn.com/HSOP/955ad3298db330b5ee880c2c9e6f23a0.sdp/playlist.m3u8"  // for hls/dash/mp4
      url: "https://netshiftstreamkit.online:5443/LiveApp/streams/hslhs_main.m3u8"
    },

  // Your own auth backend. Must return { token, streamToken } on success.
  // `token` authenticates the app itself; `streamToken` is the AMS JWT/token
  // used to authorize play()/publish() calls if you have stream security on.
    AUTH_LOGIN_ENDPOINT: "https://cetranslatorskit.com/api/auth/login",

  // -----------------------------------------------------------------
  // TEMPORARY — for local testing before you have a real auth backend.
  // When enabled, login checks against USERS below entirely in the
  // browser instead of calling AUTH_LOGIN_ENDPOINT. There is no real
  // security here — anyone can read these credentials in the page
  // source. Set MOCK_AUTH.enabled to false (or delete this block) once
  // AUTH_LOGIN_ENDPOINT is wired up to a real backend.
  // -----------------------------------------------------------------
  MOCK_AUTH: {
    enabled: true,
    users: [
      { username: "interpreter", password: "changeme", displayName: "Interpreter" },
      { username: "admin", password: "changeme", displayName: "Admin" }
    ]
  },

  // STUN/TURN servers for NAT traversal. Add a TURN server for production —
  // STUN-only will fail for a meaningful fraction of real-world networks.
  ICE_SERVERS: [
    { urls: "stun:stun1.l.google.com:19302" }
    // { urls: "turn:your-turn-server:3478", username: "user", credential: "pass" }
  ],

  // Languages available for interpretation. `code` is used to build the
  // output stream ID as `${STREAM_PREFIX}-${code}`. Add/remove freely.
  STREAM_PREFIX: "interpretation",
  LANGUAGES: [
    { code: "en", label: "English" },
    { code: "es", label: "Spanish" },
    { code: "fr", label: "French" },
    { code: "de", label: "German" },
    { code: "pt", label: "Portuguese" },
    { code: "ar", label: "Arabic" },
    { code: "zh", label: "Mandarin" },
    { code: "ja", label: "Japanese" }
  ]
};

export function streamIdForLanguage(code) {
  return `${CONFIG.STREAM_PREFIX}-${code}`;
}
