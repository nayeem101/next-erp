import { z } from "zod";

/** Ledger journal list query contract. Admin-only upstream. */
export const listLedgerQuerySchema = z.object({
  journalType: z.enum(["sale", "sale_reversal", "all"]).default("all"),
  /** Inclusive lower bound on entry creation time, ISO date (YYYY-MM-DD). */
  dateFrom: z.iso.date().optional(),
  /** Inclusive upper bound on entry creation time, ISO date (YYYY-MM-DD). */
  dateTo: z.iso.date().optional(),
  account: z.enum(["accounts_receivable", "sales_revenue"]).optional(),
  /** Order reference filter (order number prefix or full number). */
  reference: z.string().trim().max(24).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type ListLedgerQuery = z.infer<typeof listLedgerQuerySchema>;
export type ListLedgerQueryInput = z.input<typeof listLedgerQuerySchema>;

export interface LedgerLeg {
  account: string;
  side: string;
  amountCents: number;
}

export interface LedgerJournalGroup {
  journalId: string;
  journalType: string;
  orderId: string;
  orderNumber: string;
  invoiceNumber: string;
  description: string;
  postedAt: string;
  legs: LedgerLeg[];
  debitTotalCents: number;
  creditTotalCents: number;
}

export interface LedgerListPage {
  journals: LedgerJournalGroup[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
