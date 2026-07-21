import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const requiredTrimmedString = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max));

const optionalTrimmedString = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max).optional());

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.url()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: requiredTrimmedString(2048),
});

export const companyEnvSchema = z.object({
  COMPANY_NAME: requiredTrimmedString(160),
  COMPANY_EMAIL: z.preprocess(emptyToUndefined, z.email().max(320)),
  COMPANY_ADDRESS_LINE_1: requiredTrimmedString(160),
  COMPANY_ADDRESS_LINE_2: optionalTrimmedString(160),
  COMPANY_CITY: requiredTrimmedString(100),
  COMPANY_REGION: optionalTrimmedString(100),
  COMPANY_POSTAL_CODE: requiredTrimmedString(24),
  COMPANY_COUNTRY_CODE: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .length(2)
      .regex(/^[A-Za-z]{2}$/, "Must be an ISO 3166-1 alpha-2 country code.")
      .transform((value) => value.toUpperCase()),
  ),
});

export const serverEnvSchema = publicEnvSchema
  .extend({
    DATABASE_URL: z.preprocess(emptyToUndefined, z.url()),
    SUPABASE_SECRET_KEY: requiredTrimmedString(2048),
  })
  .extend(companyEnvSchema.shape);

export type PublicEnv = z.output<typeof publicEnvSchema>;
export type ServerEnv = z.output<typeof serverEnvSchema>;
export interface SellerIdentity {
  name: string;
  email: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  countryCode: string;
  addressLine2?: string;
  region?: string;
}

export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

export function toSellerIdentity(
  env: z.output<typeof companyEnvSchema>,
): SellerIdentity {
  const identity: SellerIdentity = {
    name: env.COMPANY_NAME,
    email: env.COMPANY_EMAIL,
    addressLine1: env.COMPANY_ADDRESS_LINE_1,
    city: env.COMPANY_CITY,
    postalCode: env.COMPANY_POSTAL_CODE,
    countryCode: env.COMPANY_COUNTRY_CODE,
  };

  if (env.COMPANY_ADDRESS_LINE_2 !== undefined) {
    identity.addressLine2 = env.COMPANY_ADDRESS_LINE_2;
  }

  if (env.COMPANY_REGION !== undefined) {
    identity.region = env.COMPANY_REGION;
  }

  return identity;
}
