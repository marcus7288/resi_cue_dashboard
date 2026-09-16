/**
 * Endpoint validation for the Resi proxy.
 *
 * The browser supplies the endpoint path, so without validation this function
 * would be an open relay that attaches a real API token to any destination an
 * attacker names. Everything here exists to make that impossible: the path must
 * be a plain, relative, single-host path that is then appended to a base URL
 * fixed in server configuration.
 */

/** HTTP methods the proxy will forward. */
export const ALLOWED_METHODS = new Set(["POST", "PUT"]);

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * @param {unknown} endpoint
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function validateEndpoint(endpoint) {
  if (typeof endpoint !== "string") return { ok: false, reason: "endpoint must be a string" };

  const path = endpoint.trim();
  if (path === "") return { ok: false, reason: "endpoint is empty" };
  if (path.length > 512) return { ok: false, reason: "endpoint is too long" };

  // Must be a relative path rooted at the API base.
  if (!path.startsWith("/")) return { ok: false, reason: "endpoint must start with /" };

  // "//host" is protocol-relative and would redirect the request to another host.
  if (path.startsWith("//")) return { ok: false, reason: "protocol-relative paths are not allowed" };

  // Backslashes are normalised to slashes by some URL parsers.
  if (path.includes("\\")) return { ok: false, reason: "backslashes are not allowed" };

  // An embedded scheme or credential separator means someone is trying to
  // retarget the request entirely.
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    return { ok: false, reason: "absolute URLs are not allowed" };
  }
  if (path.includes("@")) return { ok: false, reason: "userinfo is not allowed" };

  // Traversal, raw or percent-encoded, could climb out of the API prefix.
  if (path.includes("..") || /%2e%2e/i.test(path)) {
    return { ok: false, reason: "path traversal is not allowed" };
  }

  // Control characters, including CR/LF header-injection attempts.
  if (CONTROL_CHARS.test(path)) {
    return { ok: false, reason: "control characters are not allowed" };
  }

  return { ok: true, path };
}

/**
 * @param {unknown} method
 * @returns {"POST" | "PUT" | null}
 */
export function normaliseMethod(method) {
  if (typeof method !== "string") return "POST";
  const upper = method.toUpperCase();
  return ALLOWED_METHODS.has(upper) ? /** @type {"POST"|"PUT"} */ (upper) : null;
}

/**
 * Join a configured base URL with a validated path, keeping any base path prefix.
 * @param {string} base
 * @param {string} path
 */
export function joinUrl(base, path) {
  return base.replace(/\/+$/, "") + path;
}
