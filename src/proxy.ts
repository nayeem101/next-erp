import { NextResponse, type NextRequest } from "next/server";

import { sanitizeRedirectPath } from "@/lib/auth/safe-redirect";
import { CORRELATION_ID_HEADER } from "@/lib/errors/logging";
import { createProxyClient } from "@/lib/supabase/proxy";

/** Path prefixes that require an authenticated session at the edge. */
const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/inventory",
  "/customers",
  "/sales",
  "/accounting",
  "/admin",
] as const;

const LOGIN_PATH = "/login";
const AUTHENTICATED_HOME = "/dashboard";

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Copies refreshed auth cookies onto an outgoing redirect so token refreshes
 * are never lost to navigation.
 */
function redirectTo(url: URL, cookieSource: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);

  for (const cookie of cookieSource.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const correlationId =
    request.headers.get(CORRELATION_ID_HEADER) ?? crypto.randomUUID();

  const { supabase, getResponse } = createProxyClient(request);

  const { data } = await supabase.auth.getClaims();

  const isAuthenticated = data?.claims != null;
  const { pathname, search } = request.nextUrl;

  if (isProtectedPath(pathname) && !isAuthenticated) {
    const target = sanitizeRedirectPath(`${pathname}${search}`, "");
    const loginUrl = new URL(LOGIN_PATH, request.url);

    if (target.length > 0 && target !== LOGIN_PATH) {
      loginUrl.searchParams.set("next", target);
    }

    return redirectTo(loginUrl, getResponse());
  }

  if (pathname === LOGIN_PATH && isAuthenticated) {
    return redirectTo(new URL(AUTHENTICATED_HOME, request.url), getResponse());
  }

  // Auth-aware root redirect handled at the edge so no prerendered page is
  // required for "/".
  if (pathname === "/") {
    const target = isAuthenticated ? AUTHENTICATED_HOME : LOGIN_PATH;

    return redirectTo(new URL(target, request.url), getResponse());
  }

  const response = getResponse();
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
