import { z } from "zod";

/**
 * Customer contracts shared by server actions and client forms.
 *
 * Emails are lowercased before persistence (unique index is lower()).
 * Country codes are two-letter uppercase ISO 3166-1 alpha-2.
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

export const customerEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, "Email must be at most 320 characters")
  .pipe(z.email("Enter a valid email address"));

export const customerFieldsSchema = {
  name: requiredText(160),
  email: customerEmailSchema,
  phone: optionalText(40),
  companyName: optionalText(160),
  addressLine1: requiredText(160),
  addressLine2: optionalText(160),
  city: requiredText(100),
  region: optionalText(100),
  postalCode: requiredText(24),
  countryCode: z
    .string()
    .trim()
    .length(2, "Use a two-letter country code")
    .transform((value) => value.toUpperCase()),
  notes: optionalText(2000),
};

export const createCustomerSchema = z.object(customerFieldsSchema).strict();

export const updateCustomerSchema = z
  .object({
    customerId: z.uuid(),
    ...customerFieldsSchema,
  })
  .strict();

export const setCustomerActiveSchema = z
  .object({
    customerId: z.uuid(),
    isActive: z.boolean(),
  })
  .strict();

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateCustomerArgs = z.input<typeof createCustomerSchema>;
export type UpdateCustomerArgs = z.input<typeof updateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type SetCustomerActiveArgs = z.input<typeof setCustomerActiveSchema>;
export type SetCustomerActiveInput = z.input<typeof setCustomerActiveSchema>;

// ---------------------------------------------------------------------------
// List query contracts
// ---------------------------------------------------------------------------

export const CUSTOMER_SORT_OPTIONS = [
  "name",
  "name_desc",
  "email",
  "email_desc",
  "newest",
] as const;

export const customerStatusFilter = z.enum(["all", "active", "archived"]);

export const listCustomersQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
  status: customerStatusFilter.default("all"),
  sort: z.enum(CUSTOMER_SORT_OPTIONS).default("name"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type ListCustomersQueryInput = z.input<typeof listCustomersQuerySchema>;
export type ListCustomersQueryOutput = z.output<
  typeof listCustomersQuerySchema
>;

// ---------------------------------------------------------------------------
// Customer order history contracts
// ---------------------------------------------------------------------------

export const CUSTOMER_ORDER_SORT_OPTIONS = [
  "newest",
  "oldest",
  "total_asc",
  "total_desc",
] as const;

export const customerOrderStatusFilter = z.enum([
  "all",
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
]);

export const listCustomerOrdersQuerySchema = z.object({
  status: customerOrderStatusFilter.default("all"),
  sort: z.enum(CUSTOMER_ORDER_SORT_OPTIONS).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(4).max(100).default(10),
});

export type ListCustomerOrdersQuery = z.infer<
  typeof listCustomerOrdersQuerySchema
>;
export type ListCustomerOrdersQueryInput = z.input<
  typeof listCustomerOrdersQuerySchema
>;

export interface CustomerOrderRow {
  id: string;
  orderNumber: string;
  status: "draft" | "confirmed" | "fulfilled" | "cancelled";
  version: number;
  totalCents: number;
  currencyCode: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface CustomerOrderPage {
  rows: CustomerOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomerListRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  city: string;
  region: string | null;
  countryCode: string;
  isActive: boolean;
  orderCount: number;
  confirmedSalesCents: number;
  createdAt: string;
}

export interface CustomerListPage {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomerDetailRow extends CustomerListRow {
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  notes: string | null;
  openDraftCount: number;
  lastOrderAt: string | null;
}

export interface CreateCustomerResult {
  customerId: string;
}

export interface UpdateCustomerResult {
  customerId: string;
}

export interface SetCustomerActiveResult {
  customerId: string;
  isActive: boolean;
}
