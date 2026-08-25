import { getAuditEventDetail } from "@/features/audit/queries";
import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

import type { NextRequest } from "next/server";

/**
 * Admin-only sanitized audit detail payload for the details sheet.
 */

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getActionContext(MODULE_ROLE_REQUIREMENTS.administration);

  if (!auth.ok) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const detail = await getAuditEventDetail(id);

  if (!detail) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(detail, {
    headers: { "Cache-Control": "no-store" },
  });
}
