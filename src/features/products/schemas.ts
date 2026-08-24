import { z } from "zod";

import { MAX_MONEY_CENTS, parseMoneyToCents } from "@/lib/money";

/**
 * Product contracts shared by server actions and client forms.
 *
 * Money crosses the boundary as decimal STRINGS (exact bigint conversion
 * server-side) and quantities as coerced integers — never floats.
 */

const requiredText = (max: number) => z.string().trim().min(1).max(max);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    );

/** Decimal amount string with <=2 places, convertible to positive cents. */
const moneySchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/, "Enter a valid amount");

function toCents(value: string): bigint | null {
  const cents = parseMoneyToCents(value);

  if (cents === null) {
    return null;
  }

  // Guard against absurd magnitudes the regex alone permits.
  return cents > MAX_MONEY_CENTS ? null : cents;
}

export const positiveMoneySchema = moneySchema.refine(
  (value) => {
    const cents = toCents(value);

    return cents !== null && cents > 0n;
  },
  { message: "Amount must be greater than zero" },
);

export const nonnegativeQuantitySchema = z.coerce
  .number({ message: "Enter a whole number" })
  .int("Enter a whole number")
  .min(0, "Cannot be negative")
  .max(1_000_000);

// ---------------------------------------------------------------------------
// Product schemas (API_SPEC)
// ---------------------------------------------------------------------------

export const productFieldsSchema = {
  categoryId: z.uuid(),
  /** Uppercase-normalized before persistence; unique index is upper(). */
  sku: requiredText(64).transform((value) => value.toUpperCase()),
  name: requiredText(160),
  description: optionalText(2000),
  unitPrice: positiveMoneySchema,
  reorderLevel: nonnegativeQuantitySchema,
};

export const createProductSchema = z
  .object({
    ...productFieldsSchema,
    openingStock: nonnegativeQuantitySchema,
  })
  .strict();

export const updateProductSchema = z
  .object({
    productId: z.uuid(),
    ...productFieldsSchema,
  })
  .strict();

export const setProductActiveSchema = z
  .object({
    productId: z.uuid(),
    isActive: z.boolean(),
  })
  .strict();

export const adjustStockSchema = z
  .object({
    productId: z.uuid(),
    quantityDelta: z.coerce.number().int().min(-1_000_000).max(1_000_000),
    reason: requiredText(500),
  })
  .strict()
  .refine((value) => value.quantityDelta !== 0, {
    path: ["quantityDelta"],
    message: "Adjustment cannot be zero",
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateProductArgs = z.input<typeof createProductSchema>;
export type UpdateProductArgs = z.input<typeof updateProductSchema>;
export type SetProductActiveArgs = z.input<typeof setProductActiveSchema>;
export type AdjustStockArgs = z.input<typeof adjustStockSchema>;

// ---------------------------------------------------------------------------
// List query contracts
// ---------------------------------------------------------------------------

export const PRODUCT_SORT_OPTIONS = [
  "name",
  "name_desc",
  "sku",
  "newest",
  "price_asc",
  "price_desc",
  "stock_asc",
] as const;

export const productStockFilter = z.enum([
  "all",
  "active",
  "archived",
  "low_stock",
]);

export const listProductsQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
  categoryId: z.uuid().optional(),
  stockStatus: productStockFilter.default("active"),
  sort: z.enum(PRODUCT_SORT_OPTIONS).default("name"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type ListProductsQueryInput = z.input<typeof listProductsQuerySchema>;

/** Serialized grid row; money stays in integer cents. */
export interface ProductListRow {
  id: string;
  categoryId: string;
  categoryName: string;
  sku: string;
  name: string;
  description: string | null;
  unitPriceCents: number;
  stockOnHand: number;
  reorderLevel: number;
  isActive: boolean;
  createdAt: string;
}

export interface ProductListPage {
  rows: ProductListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateProductResult {
  productId: string;
}
