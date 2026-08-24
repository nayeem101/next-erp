/**
 * Escaped search helpers.
 *
 * User-supplied search terms reach SQL `ILIKE`/`LIKE` patterns where `%`,
 * `_`, and the escape character are metacharacters. Every grid search must
 * route through these helpers so input matches literally.
 */

/** Escapes LIKE metacharacters with a backslash (Postgres default escape). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Builds a case-insensitive "contains" pattern from raw user input. */
export function ilikeContainsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

/** Builds a case-insensitive "starts with" pattern from raw user input. */
export function ilikeStartsWithPattern(value: string): string {
  return `${escapeLikePattern(value)}%`;
}
