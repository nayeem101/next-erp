import { createProxyClient } from "@/lib/supabase/proxy";

import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const { supabase, getResponse } = createProxyClient(request);

  await supabase.auth.getClaims();

  return getResponse();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
