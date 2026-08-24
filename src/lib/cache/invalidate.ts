import "server-only";

import { revalidateTag, revalidatePath, updateTag } from "next/cache";

/**
 * Invalidation helpers centralizing Next.js 16 cache semantics.
 *
 * - `updateTag`: read-your-own-writes; call after a successful mutation in a
 *   Server Action so the acting user sees fresh data immediately.
 * - `refreshStale`: stale-while-revalidate via `revalidateTag` with the
 *   REQUIRED profile argument (the single-argument form is deprecated).
 * - `invalidatePath`: coarse escape hatch when tags are unknown.
 */

/** Immediately expires tagged caches for read-your-own-writes flows. */
export function invalidateTags(...tags: readonly string[]): void {
  for (const tag of tags) {
    updateTag(tag);
  }
}

/** Serves stale content while regenerating in the background. */
export function refreshStale(tag: string, profile = "max"): void {
  revalidateTag(tag, profile);
}

/** Invalidates every cached scope associated with a route path. */
export function invalidatePath(path: string): void {
  revalidatePath(path);
}
