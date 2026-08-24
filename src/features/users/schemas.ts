import { z } from "zod";

import { ROLE_KEYS, type RoleKey } from "@/lib/auth/roles";

/**
 * Shared contracts for the Admin user-administration feature.
 *
 * Browser-safe: imported by both client grid components and the server
 * action, so no database or server-only code may leak in here.
 */

export const userListQuerySchema = z.object({
  /** Case-insensitive partial match against email and display name. */
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) =>
      value !== undefined && value.length > 0 ? value : undefined,
    ),
  role: z.enum(ROLE_KEYS).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** Serialized list row; dates are ISO strings for client components. */
export interface UserListRow {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  lastSignedInAt: string | null;
  createdAt: string;
  roles: RoleKey[];
}

export interface UserListPage {
  rows: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
