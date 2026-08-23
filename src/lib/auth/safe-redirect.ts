/**
 * Restricts redirect targets to same-origin relative paths.
 *
 * Used wherever user-influenced `next` parameters drive navigation. Absolute
 * URLs, scheme-relative hosts, backslashes (treated as slashes by browsers),
 * control characters, and oversized values all fall back to a safe default.
 */

const MAX_REDIRECT_LENGTH = 2048;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function sanitizeRedirectPath(
  raw: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (typeof raw !== "string") {
    return fallback;
  }

  const candidate = raw.trim();

  if (
    candidate.length === 0 ||
    candidate.length > MAX_REDIRECT_LENGTH ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.startsWith("/\\") ||
    candidate.includes("\\") ||
    CONTROL_CHARACTERS.test(candidate)
  ) {
    return fallback;
  }

  return candidate;
}

/** True when the target is safe to navigate to after authentication. */
export function isSameOriginRelativePath(
  raw: string | null | undefined,
): boolean {
  if (typeof raw !== "string") {
    return false;
  }

  return sanitizeRedirectPath(raw, "") === raw.trim() && raw.trim().length > 0;
}
