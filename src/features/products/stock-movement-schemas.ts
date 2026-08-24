import { z } from "zod";

/**
 * Stock movement list contracts shared by the product detail page and the
 * cross-product audit trail page.
 *
 * Movements are append-only, so there are no write contracts here — only
 * filtered reads.
 */

export const MOVEMENT_SORT_OPTIONS = [
  "newest",
  "oldest",
  "delta_asc",
  "delta_desc",
] as const;

export const listStockMovementsQuerySchema = z.object({
  productId: z.uuid().optional(),
  type: z.enum(["opening", "adjustment", "sale", "sale_reversal"]).optional(),
  actorId: z.uuid().optional(),
  /** Inclusive lower bound, YYYY-MM-DD (local midnight). */
  from: z.iso.date().optional(),
  /** Inclusive upper bound, YYYY-MM-DD (through end of day). */
  to: z.iso.date().optional(),
  /** Exact case-insensitive match against the originating order number. */
  orderNumber: z
    .string()
    .trim()
    .max(24)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
  sort: z.enum(MOVEMENT_SORT_OPTIONS).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type ListStockMovementsQuery = z.infer<
  typeof listStockMovementsQuerySchema
>;
export type ListStockMovementsQueryInput = z.input<
  typeof listStockMovementsQuerySchema
>;

/** Serialized grid row; timestamps arrive as ISO strings. */
export interface StockMovementRow {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  type: "opening" | "adjustment" | "sale" | "sale_reversal";
  quantityDelta: number;
  resultingStock: number;
  reason: string;
  orderId: string | null;
  orderNumber: string | null;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export interface StockMovementPage {
  rows: StockMovementRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
