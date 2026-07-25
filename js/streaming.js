import { WebRTCAdaptor } from "https://cdn.skypack.dev/@antmedia/webrtc_adaptor";
import { CONFIG, streamIdForLanguage } from "./config.js";

/**
 * PublishSession owns the WebRTCAdaptor that publishes the mixed
 * (mic + original) stream to AMS_WEBSOCKET_URL, under a stream ID
 * derived from the selected language.
 *
 * Note this is entirely separate from wherever the source stream comes
 * from (see source.js) — publishing always targets your own AMS.
 */
export class PublishSession {
  constructor({ onPublishStateChange, onError }) {
    this.onPublishStateChange = onPublishStateChange || (() => {});
    this.onError = onError || (() => {});
    this.publishAdaptor = null;
    this.currentPublishStreamId = null;
  }

  /**
   * Publishes `mixedStream` under the stream ID for `languageCode`.
   * Tears down any previous publish session first (e.g. on language switch).
   */
  start(mixedStream, languageCode, streamToken) {
    this.stop();

    const streamId = streamIdForLanguage(languageCode);
    this.currentPublishStreamId = streamId;

    this.publishAdaptor = new WebRTCAdaptor({
      websocket_url: CONFIG.AMS_WEBSOCKET_URL,
      localStream: mixedStream,
      mediaConstraints: { video: false, audio: false },
      peerconnection_config: { iceServers: CONFIG.ICE_SERVERS },
      callback: (info, obj) => {
        if (info === "initialized") {
          this.publishAdaptor.publish(streamId, streamToken || "");
        }
        if (info === "publish_started") {
          this.onPublishStateChange("live", streamId);
        }
        if (info === "publish_finished") {
          this.onPublishStateChange("stopped", streamId);
        }
      },
      callbackError: (error, message) => {
        this.onError(new Error(`Publish error: ${error} ${message || ""}`.trim()));
        this.onPublishStateChange("error", streamId);
      }
    });
  }

  stop() {
    if (this.publishAdaptor && this.currentPublishStreamId) {
      this.publishAdaptor.stop(this.currentPublishStreamId);
      this.publishAdaptor = null;
      this.currentPublishStreamId = null;
    }
  }
}
