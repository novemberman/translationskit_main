import { CONFIG } from "./config.js";

const STORAGE_KEY = "interp_pwa_session";

/**
 * Reads the persisted session (if any) from localStorage.
 * Returns null if no session or it's malformed.
 */
export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/**
 * Calls your auth backend. Expects a JSON response shaped like:
 *   { token: "app-jwt", streamToken: "ams-jwt", displayName: "Jane" }
 *
 * Replace this implementation if your backend's contract differs —
 * everything downstream only relies on session.token and session.streamToken.
 *
 * If CONFIG.MOCK_AUTH.enabled is true, this skips the network call
 * entirely and checks against the hardcoded list in config.js instead.
 * Only for local testing — see the warning next to MOCK_AUTH.
 */
export async function login(username, password) {
  if (CONFIG.MOCK_AUTH?.enabled) {
    return loginMock(username, password);
  }

  const res = await fetch(CONFIG.AUTH_LOGIN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    const message = res.status === 401
      ? "Incorrect username or password."
      : `Login failed (server responded ${res.status}).`;
    throw new Error(message);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error("Login response was missing a token.");
  }

  const session = {
    token: data.token,
    streamToken: data.streamToken || "",
    displayName: data.displayName || username
  };
  saveSession(session);
  return session;
}

async function loginMock(username, password) {
  // Tiny artificial delay so the "Signing in…" state is visible, same
  // as it would be against a real network call.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const match = CONFIG.MOCK_AUTH.users.find(
    (u) => u.username === username && u.password === password
  );

  if (!match) {
    throw new Error("Incorrect username or password.");
  }

  const session = {
    token: `mock-token-${match.username}`,
    streamToken: "",
    displayName: match.displayName || match.username
  };
  saveSession(session);
  return session;
}

export function logout() {
  clearSession();
}
