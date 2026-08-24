/**
 * Typed URL list-query parsing.
 *
 * Grid pages read `URLSearchParams` (or Next.js search-param objects) and
 * need three behaviors: last-value-wins flattening, schema-driven coercion
 * with defaults, and graceful recovery — an invalid or hostile query must
 * degrade to defaults instead of erroring the page.
 */

import type { z } from "zod";

export type RawSearchParams =
  URLSearchParams | Record<string, string | string[] | undefined>;

/** Flattens repeated/array values with deterministic last-value-wins. */
function flatten(raw: RawSearchParams): Record<string, string> {
  const flat: Record<string, string> = {};

  if (raw instanceof URLSearchParams) {
    raw.forEach((value, key) => {
      flat[key] = value;
    });

    return flat;
  }

  for (const [key, value] of Object.entries(raw)) {
    const last = Array.isArray(value) ? value[value.length - 1] : value;

    if (typeof last === "string") {
      flat[key] = last;
    }
  }

  return flat;
}

export interface ParsedListQuery<T> {
  query: T;
  /**
   * True when the raw parameters failed validation and were reduced to the
   * recognized subset before re-parsing (defaults filled the gaps). Callers
   * can use this to rewrite a sanitized URL.
   */
  recovered: boolean;
}

/**
 * Parses raw search parameters against an object schema whose optional
 * fields carry defaults (page/pageSize coercion, enums, trimmed search).
 *
 * Unknown or invalid keys are dropped individually so one bad value cannot
 * poison the whole query; what remains is re-parsed and the schema supplies
 * defaults for everything missing.
 */
export function parseListQuery<TSchema extends z.ZodObject>(
  raw: RawSearchParams,
  schema: TSchema,
): ParsedListQuery<z.output<TSchema>> {
  const flat = flatten(raw);
  const shape = schema.shape;

  // Unknown keys are noise from other features sharing the URL; ignore them
  // without counting the result as recovered.
  const recognized: Record<string, string> = {};

  for (const key of Object.keys(shape)) {
    const value = flat[key];

    if (value !== undefined) {
      recognized[key] = value;
    }
  }

  const direct = schema.safeParse(recognized);

  if (direct.success) {
    return { query: direct.data, recovered: false };
  }

  const reduced: Record<string, string> = {};

  for (const key of Object.keys(flat)) {
    const value = flat[key];
    const keySchema = shape[key] as z.ZodType | undefined;

    if (!keySchema || value === undefined) {
      continue;
    }

    const single = keySchema.safeParse(value);

    if (single.success) {
      reduced[key] = value;
    }
  }

  const recoveredParse = schema.safeParse(reduced);

  if (recoveredParse.success) {
    return { query: recoveredParse.data, recovered: true };
  }

  // A schema with per-key defaults always parses the empty object.
  const fallback = schema.safeParse({});

  if (fallback.success) {
    return { query: fallback.data, recovered: true };
  }

  throw new Error("list-query schema must parse its own defaults");
}
