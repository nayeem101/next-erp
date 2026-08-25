import { z } from "zod";

/** Invoice list query contract. Hostile URLs degrade to defaults upstream. */
export const listInvoicesQuerySchema = z.object({
  status: z.enum(["issued", "void", "all"]).default("all"),
  customerId: z.uuid().optional(),
  /** Inclusive lower bound on issued_at, ISO date (YYYY-MM-DD). */
  dateFrom: z.iso.date().optional(),
  /** Inclusive upper bound on issued_at, ISO date (YYYY-MM-DD). */
  dateTo: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
export type ListInvoicesQueryInput = z.input<typeof listInvoicesQuerySchema>;

export interface InvoiceLineView {
  id: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}
