import postgres from "postgres";
import { z } from "zod";

import type { NextRequest } from "next/server";

/**
 * Production health smoke (Phase 7).
 *
 * Unauthenticated, cheap, and secret-free. Verifies process liveness,
 * environment integrity, database connectivity (SELECT 1), and — when
 * `?deep=1` is supplied with the correct probe token — that the PDF
 * renderer can produce bytes in this runtime.
 *
 * Returns 503 with per-check statuses on any failure so load balancers
 * and uptime monitors can gate deployments.
 */

const healthEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  DATABASE_URL: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const checks = {
    env: "pass" as "pass" | "fail",
    database: "skip" as "pass" | "fail" | "skip",
    pdf: "skip" as "pass" | "fail" | "skip",
  };

  const parsed = healthEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    checks.env = "fail";
    checks.database = "fail";

    return Response.json({ status: "unhealthy", checks }, { status: 503 });
  }

  let sql: postgres.Sql | undefined;

  try {
    sql = postgres(parsed.data.DATABASE_URL, {
      max: 1,
      connect_timeout: 5,
      idle_timeout: 5,
    });
    await sql`select 1`;

    checks.database = "pass";
  } catch {
    checks.database = "fail";
  } finally {
    await sql?.end({ timeout: 5 });
  }

  const deepToken = process.env.HEALTH_PROBE_TOKEN;
  const wantsDeep = new URL(request.url).searchParams.get("deep") === "1";

  if (wantsDeep && deepToken !== undefined && deepToken !== "") {
    const provided = request.headers.get("x-probe-token");

    if (provided === deepToken) {
      try {
        const { renderToBuffer } = await import("@react-pdf/renderer");
        const { createElement } = await import("react");
        const { Document, Page, Text } = await import("@react-pdf/renderer");

        const buffer = await renderToBuffer(
          createElement(
            Document,
            null,
            createElement(
              Page,
              null,
              createElement(Text, null, "health-probe"),
            ),
          ),
        );

        checks.pdf =
          buffer.subarray(0, 5).toString() === "%PDF-" ? "pass" : "fail";
      } catch {
        checks.pdf = "fail";
      }
    }
  }

  const healthy =
    checks.env === "pass" &&
    checks.database === "pass" &&
    checks.pdf !== "fail";

  return Response.json(
    { status: healthy ? "healthy" : "unhealthy", checks },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
