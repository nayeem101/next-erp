/**
 * Exact money parsing and serialization.
 *
 * Amounts are integer cents (`bigint`) everywhere on the server. User input
 * arrives as a constrained decimal string with at most two fraction digits;
 * anything that would require rounding is rejected, never coerced. Across
 * RSC/client boundaries cents serialize as plain decimal strings.
 */

const MONEY_PATTERN = /^(0|[1-9]\d{0,10})(\.\d{1,2})?$/;

/** Maximum representable amount: 99,999,999,999.99 → 9_999_999_999_999 cents. */
export const MAX_MONEY_CENTS = 9_999_999_999_999n;

/**
 * Parses a decimal string into exact cents, or returns null when the input
 * does not match the accepted shape (including any value needing rounding).
 */
export function parseMoneyToCents(value: string): bigint | null {
  const match = MONEY_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const whole = match[1] ?? "0";
  const fraction = match[2]?.slice(1) ?? "";
  const paddedFraction = `${fraction}00`.slice(0, 2);

  const cents = BigInt(whole) * 100n + BigInt(paddedFraction);

  return cents > MAX_MONEY_CENTS ? null : cents;
}

/**
 * Serializes cents into the canonical decimal string used across the
 * RSC/client boundary (e.g. 1234n → "12.34").
 */
export function formatCentsAsMoneyString(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");

  const sign = negative ? "-" : "";
  const wholeText = whole.toString();

  return `${sign}${wholeText}.${fraction}`;
}

/** Parses serialized money strings coming from the database or cache. */
export function moneyStringToCents(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function centsToMoneyString(cents: bigint): string {
  return cents.toString();
}
