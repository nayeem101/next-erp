import { z } from "zod";

/**
 * Order contracts shared by server actions and client forms.
 *
 * Clients never send prices, totals, status, order numbers, or actor ids:
 * the server snapshots product master data and computes exact bigint math.
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

export const ORDER_LINE_MIN = 1;
export const ORDER_LINE_MAX = 100;
export const ORDER_QUANTITY_MAX = 1_000_000;

export const orderLineInputSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.coerce
      .number({ message: "Enter a whole number" })
      .int("Enter a whole number")
      .positive("Quantity must be at least one")
      .max(ORDER_QUANTITY_MAX, "Quantity is too large"),
  })
  .strict();

const orderDraftFields = {
  customerId: z.uuid(),
  lines: z
    .array(orderLineInputSchema)
    .min(ORDER_LINE_MIN, "Add at least one line item")
    .max(ORDER_LINE_MAX, "An order can hold at most 100 lines"),
  notes: optionalText(2000),
};

export const createDraftOrderSchema = z
  .object(orderDraftFields)
  .strict()
  .superRefine((value, ctx) => {
    markDuplicateProducts(value.lines, ctx);
  });

export const updateDraftOrderSchema = z
  .object({
    orderId: z.uuid(),
    version: z.coerce
      .number({ message: "Enter a whole number" })
      .int("Enter a whole number")
      .positive("Version must be a positive integer"),
    ...orderDraftFields,
  })
  .strict()
  .superRefine((value, ctx) => {
    markDuplicateProducts(value.lines, ctx);
  });

export const transitionOrderSchema = z
  .object({
    orderId: z.uuid(),
    version: z.coerce
      .number({ message: "Enter a whole number" })
      .int("Enter a whole number")
      .positive("Version must be a positive integer"),
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    orderId: z.uuid(),
    version: z.coerce
      .number({ message: "Enter a whole number" })
      .int("Enter a whole number")
      .positive("Version must be a positive integer"),
    reason: requiredText(500),
  })
  .strict();

/** Adds one issue on `lines` when a product appears more than once. */
function markDuplicateProducts(
  lines: { productId: string }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line.productId)) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each product may appear on only one line.",
      });

      return;
    }

    seen.add(line.productId);
  }
}

export type CreateDraftOrderInput = z.infer<typeof createDraftOrderSchema>;
export type CreateDraftOrderArgs = z.input<typeof createDraftOrderSchema>;
export type UpdateDraftOrderArgs = z.input<typeof updateDraftOrderSchema>;
export type UpdateDraftOrderInput = z.infer<typeof updateDraftOrderSchema>;
export type TransitionOrderArgs = z.input<typeof transitionOrderSchema>;
export type TransitionOrderInput = z.input<typeof transitionOrderSchema>;
export type CancelOrderArgs = z.input<typeof cancelOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// ---------------------------------------------------------------------------
// List query contracts
// ---------------------------------------------------------------------------

export const ORDER_STATUS_FILTER_OPTIONS = [
  "all",
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
] as const;

export const ORDER_SORT_OPTIONS = [
  "newest",
  "oldest",
  "total_desc",
  "total_asc",
] as const;

export const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUS_FILTER_OPTIONS).default("all"),
  customerId: z.uuid().optional(),
  createdBy: z.uuid().optional(),
  /** Inclusive lower bound on created_at, ISO date (YYYY-MM-DD). */
  dateFrom: z.iso.date().optional(),
  /** Inclusive upper bound on created_at, ISO date (YYYY-MM-DD). */
  dateTo: z.iso.date().optional(),
  sort: z.enum(ORDER_SORT_OPTIONS).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type ListOrdersQueryInput = z.input<typeof listOrdersQuerySchema>;

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** One line of an immutable snapshot. Cents are numbers at the boundary. */
export interface OrderLineView {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface OrderListRow {
  id: string;
  orderNumber: string;
  status: "draft" | "confirmed" | "fulfilled" | "cancelled";
  version: number;
  customerName: string;
  customerCompanyName: string | null;
  creatorName: string | null;
  /** Null when the viewer lacks the financial projection (Inventory). */
  totalCents: number | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface OrderListPage {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OrderDetailView {
  id: string;
  orderNumber: string;
  status: "draft" | "confirmed" | "fulfilled" | "cancelled";
  version: number;
  customerId: string;
  customerName: string;
  customerCompanyName: string | null;
  customerEmail: string;
  /** Null when the viewer lacks the financial projection (Inventory). */
  totalCents: number | null;
  currencyCode: string;
  notes: string | null;
  cancellationReason: string | null;
  lines: OrderLineView[];
  creatorName: string | null;
  confirmedByName: string | null;
  fulfilledByName: string | null;
  cancelledByName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface CreateDraftOrderResult {
  orderId: string;
  orderNumber: string;
  version: number;
  totalCents: number;
}

export interface UpdateDraftOrderResult {
  orderId: string;
  version: number;
  totalCents: number;
}

export interface TransitionOrderResult {
  orderId: string;
  version: number;
  status: "confirmed" | "fulfilled" | "cancelled";
}

export interface CancelOrderResult {
  orderId: string;
  version: number;
  status: "cancelled";
  reversed: boolean;
}
