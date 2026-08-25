import { describe, expect, test, vi } from "vitest";

import {
  invalidatePath,
  invalidateTags,
  refreshStale,
} from "@/lib/cache/invalidate";
import { CACHE_LIFETIMES, CACHE_TAGS, entityTag } from "@/lib/cache/tags";

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mocks.cacheLife,
  cacheTag: mocks.cacheTag,
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
  updateTag: mocks.updateTag,
}));

/** Flattens the vocabulary, descending into grouped namespaces. */
function flattenTags(values: readonly unknown[]): string[] {
  return values.flatMap((value) =>
    typeof value === "string"
      ? [value]
      : flattenTags(Object.values(value as Record<string, unknown>)),
  );
}

describe("cache tag vocabulary", () => {
  test("uses lowercase kebab-case tags", () => {
    for (const tag of flattenTags(Object.values(CACHE_TAGS))) {
      // Namespaced family tags use a `group:` prefix.
      expect(tag).toMatch(/^[a-z0-9]+(:[a-z0-9]+)*(-[a-z0-9]+)*$/);
    }
  });

  test("tags are unique", () => {
    const values = flattenTags(Object.values(CACHE_TAGS));

    expect(new Set(values).size).toBe(values.length);
  });

  test("entity tags compose base and id deterministically", () => {
    const id = "7c1e2682-1a1f-4d3e-9a4b-2f5b6c7d8e9f";

    expect(entityTag(CACHE_TAGS.users, id)).toBe(`users:${id}`);
  });
});

describe("CACHE_LIFETIMES", () => {
  test("profiles carry monotonic stale <= revalidate <= expire bounds", () => {
    for (const profile of Object.values(CACHE_LIFETIMES)) {
      expect(profile.stale).toBeLessThanOrEqual(profile.revalidate);
      expect(profile.revalidate).toBeLessThanOrEqual(profile.expire);
    }
  });

  test("volatile profile stays short-lived (excluded from prerenders)", () => {
    expect(CACHE_LIFETIMES.volatile.expire).toBeLessThan(300);
  });
});

describe("invalidateTags", () => {
  test("expires each tag immediately via updateTag", () => {
    invalidateTags(CACHE_TAGS.users, entityTag(CACHE_TAGS.users, "abc"));

    expect(mocks.updateTag).toHaveBeenCalledTimes(2);
    expect(mocks.updateTag).toHaveBeenNthCalledWith(1, "users");
    expect(mocks.updateTag).toHaveBeenNthCalledWith(2, "users:abc");
  });

  test("never touches the stale-while-revalidate path", () => {
    invalidateTags(CACHE_TAGS.products);

    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});

describe("refreshStale", () => {
  test("passes the required profile argument to revalidateTag", () => {
    refreshStale(CACHE_TAGS.invoices);

    expect(mocks.revalidateTag).toHaveBeenCalledWith("invoices", "max");

    refreshStale(CACHE_TAGS.orders, "hours");

    expect(mocks.revalidateTag).toHaveBeenCalledWith("orders", "hours");
  });
});

describe("invalidatePath", () => {
  test("delegates to revalidatePath", () => {
    invalidatePath("/admin/users");

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/users");
  });
});
