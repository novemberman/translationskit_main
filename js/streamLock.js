import { CONFIG } from "./config.js";

/**
 * Ant Media's REST API reports a broadcast's status as one of:
 * "created", "broadcasting", "finished". We treat "broadcasting" as
 * "someone is already interpreting this language — don't let a second
 * person publish over them."
 *
 * This is a best-effort client-side check, not a hard guarantee — two
 * users could still race each other between check and publish. For a
 * strict guarantee, enforce this same rule server-side (e.g. in an AMS
 * webhook / REST proxy you control) rather than relying on the client.
 */
export async function isStreamLive(streamId) {
  const res = await fetch(`${CONFIG.AMS_REST_URL}/broadcasts/${streamId}`, {
    headers: buildAuthHeaders()
  });

  if (res.status === 404) {
    return false; // broadcast doesn't exist yet — free to use
  }
  if (res.status === 403 || res.status === 401) {
    console.warn(
      `Stream lock check got ${res.status} from AMS. If you've enabled REST API ` +
      "security in Ant Media, set CONFIG.AMS_REST_AUTH in config.js. Allowing publish."
    );
    return false;
  }
  if (!res.ok) {
    // Fail open with a warning rather than blocking the user entirely —
    // adjust to fail closed if you'd rather be conservative.
    console.warn(`Stream lock check failed (${res.status}); allowing publish.`);
    return false;
  }

  const data = await res.json();
  return data.status === "broadcasting";
}

function buildAuthHeaders() {
  const { username, password } = CONFIG.AMS_REST_AUTH || {};
  if (!username || !password) return {};
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}` };
}
