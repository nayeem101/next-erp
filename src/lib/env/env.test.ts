import { afterEach, describe, expect, test } from "vitest";

import { getPublicEnv, resetPublicEnvCacheForTests } from "@/lib/env/public";
import {
  companyEnvSchema,
  publicEnvSchema,
  serverEnvSchema,
  toSellerIdentity,
} from "@/lib/env/schemas";
import {
  getSellerIdentity,
  getServerEnv,
  resetServerEnvCacheForTests,
} from "@/lib/env/server";

const validPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
} as const;

const validCompanyEnv = {
  COMPANY_NAME: "NextERP Demo Company",
  COMPANY_EMAIL: "billing@example.com",
  COMPANY_ADDRESS_LINE_1: "100 Market Street",
  COMPANY_ADDRESS_LINE_2: "Suite 4",
  COMPANY_CITY: "San Francisco",
  COMPANY_REGION: "CA",
  COMPANY_POSTAL_CODE: "94105",
  COMPANY_COUNTRY_CODE: "us",
} as const;

const validServerEnv = {
  ...validPublicEnv,
  DATABASE_URL: "postgresql://postgres:password@127.0.0.1:5432/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_key",
  ...validCompanyEnv,
} as const;

afterEach(() => {
  resetPublicEnvCacheForTests();
  resetServerEnvCacheForTests();

  for (const key of Object.keys(validServerEnv)) {
    Reflect.deleteProperty(process.env, key);
  }
});

describe("publicEnvSchema", () => {
  test("accepts valid public Supabase values", () => {
    expect(publicEnvSchema.parse(validPublicEnv)).toEqual(validPublicEnv);
  });

  test("rejects a missing publishable key", () => {
    const result = publicEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: validPublicEnv.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("companyEnvSchema", () => {
  test("normalizes country codes and omits blank optional fields", () => {
    const parsed = companyEnvSchema.parse({
      ...validCompanyEnv,
      COMPANY_ADDRESS_LINE_2: "  ",
      COMPANY_REGION: "",
    });

    expect(parsed.COMPANY_COUNTRY_CODE).toBe("US");
    expect(parsed.COMPANY_ADDRESS_LINE_2).toBeUndefined();
    expect(parsed.COMPANY_REGION).toBeUndefined();
  });

  test("rejects an invalid seller email", () => {
    const result = companyEnvSchema.safeParse({
      ...validCompanyEnv,
      COMPANY_EMAIL: "not-an-email",
    });

    expect(result.success).toBe(false);
  });
});

describe("serverEnvSchema", () => {
  test("requires database and secret credentials with seller identity", () => {
    expect(serverEnvSchema.parse(validServerEnv)).toMatchObject({
      DATABASE_URL: validServerEnv.DATABASE_URL,
      SUPABASE_SECRET_KEY: validServerEnv.SUPABASE_SECRET_KEY,
      COMPANY_NAME: validServerEnv.COMPANY_NAME,
      COMPANY_COUNTRY_CODE: "US",
    });
  });

  test("maps seller identity for invoice snapshots", () => {
    expect(toSellerIdentity(companyEnvSchema.parse(validCompanyEnv))).toEqual({
      name: "NextERP Demo Company",
      email: "billing@example.com",
      addressLine1: "100 Market Street",
      addressLine2: "Suite 4",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      countryCode: "US",
    });
  });
});

describe("environment accessors", () => {
  test("caches validated public environment values", () => {
    Object.assign(process.env, validPublicEnv);

    const first = getPublicEnv();
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "changed";
    const second = getPublicEnv();

    expect(first).toBe(second);
    expect(second.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      "sb_publishable_test_key",
    );
  });

  test("exposes seller identity from the validated server environment", () => {
    Object.assign(process.env, validServerEnv);

    expect(getServerEnv().COMPANY_EMAIL).toBe("billing@example.com");
    expect(getSellerIdentity()).toEqual(
      toSellerIdentity(companyEnvSchema.parse(validCompanyEnv)),
    );
  });

  test("throws a readable error when server environment is incomplete", () => {
    Object.assign(process.env, validPublicEnv);

    expect(() => getServerEnv()).toThrow(
      /Invalid server environment configuration/,
    );
  });
});
