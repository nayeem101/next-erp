import { z } from "zod";

/**
 * Category contracts shared by server actions and client forms.
 *
 * Browser-safe by design; the DB layer and services import these types.
 */

/** Required single-line text: trimmed, non-empty, bounded. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Optional text: trimmed; empty collapses to undefined for null columns. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    );

/**
 * Stable URL slug derived from a display name.
 *
 * Deterministic: identical inputs always produce identical slugs, so
 * duplicate detection can compare slugs directly and retries after a
 * uniqueness conflict re-generate the same candidate.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const categoryFieldsSchema = {
  name: requiredText(100),
  description: optionalText(1000),
};

export const createCategorySchema = z
  .object({ ...categoryFieldsSchema })
  .strict();

export const updateCategorySchema = z
  .object({
    categoryId: z.uuid(),
    ...categoryFieldsSchema,
  })
  .strict();

export const setCategoryActiveSchema = z
  .object({
    categoryId: z.uuid(),
    isActive: z.boolean(),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type SetCategoryActiveInput = z.infer<typeof setCategoryActiveSchema>;

export interface CreateCategoryResult {
  categoryId: string;
  slug: string;
}

export interface UpdateCategoryResult {
  categoryId: string;
}

export interface SetCategoryActiveResult {
  categoryId: string;
  isActive: boolean;
}

/** Sorting allowlist for the categories grid. */
export const CATEGORY_SORT_OPTIONS = [
  "name",
  "name_desc",
  "newest",
  "most_products",
] as const;

export const listCategoriesQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
  status: z.enum(["all", "active", "archived"]).default("active"),
  sort: z.enum(CATEGORY_SORT_OPTIONS).default("name"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

/** Serialized row for the categories grid (client-safe). */
export interface CategoryListRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  activeProductCount: number;
  createdAt: string;
}

export interface CategoryListPage {
  rows: CategoryListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
