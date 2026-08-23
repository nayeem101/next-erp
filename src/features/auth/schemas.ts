import { z } from "zod";

/**
 * Shared sign-in contract. Safe for browser and server: pure Zod only.
 * Email normalizes to trimmed lowercase; `next` is validated again at the
 * action layer through the same-origin redirect sanitizer.
 */

const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email().max(320));

export const signInSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(128),
    next: z.string().optional(),
  })
  .strict();

export type SignInInput = z.input<typeof signInSchema>;
export type SignInData = z.output<typeof signInSchema>;
