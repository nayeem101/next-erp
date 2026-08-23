/**
 * Security headers applied to every response through `next.config.ts`.
 *
 * The CSP allows the public Supabase project endpoints for Auth/Realtime
 * traffic and keeps everything else same-origin. Development additionally
 * permits `unsafe-eval` for React Refresh.
 */

export interface SecurityHeaderInput {
  supabaseUrl?: string | undefined;
  isDevelopment: boolean;
}

export interface HeaderValue {
  key: string;
  value: string;
}

function supabaseConnectSources(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) {
    return [];
  }

  try {
    const url = new URL(supabaseUrl);

    if (url.protocol !== "https:") {
      return [];
    }

    const origin = url.origin;

    return [origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(input: SecurityHeaderInput): string {
  const connectSources = [
    "'self'",
    ...supabaseConnectSources(input.supabaseUrl),
  ];
  const scriptSources = input.isDevelopment
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : ["'self'", "'unsafe-inline'"];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function buildSecurityHeaders(
  input: SecurityHeaderInput,
): HeaderValue[] {
  return [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(input),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
  ];
}
