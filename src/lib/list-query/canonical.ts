/**
 * Canonical list-query serialization.
 *
 * Grid controls (pagination links, filter chips, reset) build hrefs from a
 * merged view of current values and overrides. Canonicalization keeps URLs
 * stable: keys sort alphabetically, empties and default-equal values drop,
 * and the result round-trips through `parseListQuery`.
 */

export type CanonicalValue = string | number | boolean | undefined | null;

export type CanonicalValues = Record<string, CanonicalValue>;

export type CanonicalDefaults = Record<
  string,
  Exclude<CanonicalValue, undefined | null>
>;

function isDefault(
  key: string,
  value: string,
  defaults: CanonicalDefaults,
): boolean {
  const fallback = defaults[key];

  return fallback !== undefined && String(fallback) === value;
}

export function canonicalSearchParams(
  values: CanonicalValues,
  defaults: CanonicalDefaults = {},
): URLSearchParams {
  const params = new URLSearchParams();

  for (const key of Object.keys(values).sort()) {
    const raw = values[key];

    if (raw === undefined || raw === null || raw === "") {
      continue;
    }

    const serialized = String(raw);

    if (isDefault(key, serialized, defaults)) {
      continue;
    }

    params.set(key, serialized);
  }

  return params;
}

/**
 * Merges `patch` over `current` (explicit `undefined` in the patch deletes a
 * key) and returns an href for grid links. Returns the bare path when no
 * parameters survive canonicalization.
 */
export function listQueryHref(
  basePath: string,
  current: CanonicalValues,
  patch: CanonicalValues = {},
  defaults: CanonicalDefaults = {},
): string {
  const merged: CanonicalValues = {};

  for (const [key, value] of Object.entries(current)) {
    merged[key] = value;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      merged[key] = undefined;
    } else {
      merged[key] = value;
    }
  }

  const params = canonicalSearchParams(merged, defaults);
  const queryString = params.toString();

  if (queryString === "") {
    // Drop a trailing "?" only; keep paths as provided.
    return basePath.endsWith("?") ? basePath.slice(0, -1) : basePath;
  }

  return `${basePath}?${queryString}`;
}
