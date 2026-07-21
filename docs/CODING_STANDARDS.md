# NextERP Coding Standards

## Baseline

- TypeScript strict mode is mandatory.
- Use Next.js 16.x with React 19.2+ and App Router only.
- Use React Server Components by default.
- Use `pnpm`; commit `pnpm-lock.yaml`.
- Pin the active Node.js LTS line in `.nvmrc` and `package.json#engines`.
- Run Prettier, ESLint, TypeScript, Vitest, and Playwright through package scripts rather than editor-only configuration.
- Generated shadcn/ui primitives may retain upstream style; application code follows this document.

## Cursor project guidance

- `.cursor/rules/*.mdc` contains compact, durable Agent instructions; `/docs` remains the detailed source of truth.
- `tech-stack.mdc` is always applied. Next.js and TypeScript rules use file globs and stay under 50 lines each.
- Keep `.cursorignore` at repository root for secrets and generated/large artifacts.
- Do not create duplicate `AGENTS.md` guidance or treat `.cursor/plans/` as configuration. Save reviewed plans under `docs/plans/` only when needed.
- Add MCP, hooks, skills, or commands only for an approved concrete workflow and never embed credentials.

## TypeScript rules

- Keep `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride` enabled.
- Do not use `any`. Use `unknown`, validate/narrow it, and document the rare third-party boundary exception with an ESLint suppression on one line.
- Prefer discriminated unions for workflow and result states.
- Use `satisfies` when validating object shape without widening literals.
- Avoid TypeScript enums. Runtime enums come from Zod or Drizzle `pgEnum`; types are inferred.
- Do not use non-null assertions unless an invariant was established immediately above and cannot be expressed through control flow.
- Exported functions and components should have explicit parameter and return types when inference does not make the contract obvious.
- Browser-facing props must be serializable. Convert `bigint` amounts to decimal strings and dates to ISO strings at the RSC boundary.
- IDs are plain UUID strings for MVP; do not add nominal/branded types unless accidental ID mixing becomes a demonstrated problem.

## Naming

| Item | Convention | Example |
| --- | --- | --- |
| React components | PascalCase | `ProductForm` |
| Component files | kebab-case | `product-form.tsx` |
| Functions/variables | camelCase | `confirmOrder` |
| Constants | camelCase; SCREAMING_SNAKE_CASE only for true process constants | `defaultPageSize`, `MAX_ORDER_LINES` |
| Types/interfaces | PascalCase; no `I` prefix | `OrderSummary` |
| Zod schemas | camelCase ending `Schema` | `createProductSchema` |
| Server Actions | verb-first camelCase | `adjustStock` |
| Server queries | `get`, `list`, or domain verb | `listProducts` |
| Database tables/columns | snake_case plural tables | `order_line_items` |
| Drizzle table objects | camelCase plural | `orderLineItems` |
| Route segments | kebab-case nouns | `/stock-movements` |
| Test files | source name + `.test`/`.integration.test` | `confirm-order.integration.test.ts` |
| Audit actions | lower-case dotted past-tense event | `order.confirmed` |
| Cache tags | lower-case colon-scoped | `product:<uuid>` |

Use domain language consistently: “customer,” not “client”; “order line,” not alternating “item”; “stock on hand,” not “inventory count”; “archive,” not “delete,” for master data.

## File organization

Feature code belongs under `src/features/<feature>/`:

```text
features/orders/
├─ actions.ts            # "use server" adapters only
├─ schemas.ts            # browser-safe Zod schemas
├─ types.ts              # serialized/UI types and domain unions
├─ queries.ts            # server-only reads
├─ service.ts            # server-only business workflows
├─ repository.ts         # optional when SQL complexity warrants it
├─ mappers.ts            # DB → serialized view models
├─ permissions.ts        # feature policy helpers when needed
├─ components/
└─ __tests__/
```

Rules:

- Add `import "server-only"` to database, query, service, repository, environment, and privileged auth modules.
- Do not import `actions.ts`, database code, or server-only modules into Client Components.
- `schemas.ts` must remain browser-safe: Zod and pure helpers only, no database/environment imports.
- Route files compose features and enforce route access; they do not contain reusable business logic.
- Use route-local `_components` only for components that have no value outside that route.
- Generic shared components contain no domain rules.
- Avoid barrel files that obscure server/client boundaries or create cycles. Import from concrete module paths.
- One exported React component per component file unless tiny private subcomponents are inseparable.

## React and Next.js boundaries

### Server Components

- Fetch directly through server-only query functions; do not call the application's own HTTP endpoints.
- Authenticate before invoking cached or sensitive queries.
- Await and parse Next.js 16 asynchronous `params` and `searchParams` at the page boundary.
- Keep page components focused on authorization, data loading, and composition.
- Use Suspense where independent server reads can stream.
- Cache only explicitly safe shared functions/components with `"use cache"`, `cacheLife()`, and `cacheTag()`; never use the removed/deprecated `unstable_*` cache APIs.

### Client Components

- Add `"use client"` only for hooks, event handlers, browser APIs, React Hook Form, Zustand, TanStack Table interaction, or Recharts rendering.
- Keep the boundary as low in the tree as practical.
- Receive minimal serialized props; do not send entire database records when a view model is sufficient.
- Do not copy server data into Zustand. The order wizard store contains only unsaved workflow state.
- Do not use effects to derive values that can be computed during render.
- Prefer URL search parameters for shareable filters, sorting, and pagination.
- Prefer `useActionState`/form pending primitives and local state over adding TanStack Query. TanStack Query requires a documented non-server-renderable use case.

### Components

- Prefer composition over option-heavy “god components.”
- Keep domain status mappings exhaustive with `never` checks.
- Use stable database IDs as keys; never use array index for editable lines.
- Never suppress hydration warnings to hide an unexplained mismatch.
- Use shadcn/ui primitives before introducing another component library.

## Shared Zod schemas

Each form has one canonical input schema in `features/<feature>/schemas.ts`.

```ts
// schemas.ts — safe in browser and server
export const createProductSchema = z.object({
  categoryId: z.string().uuid(),
  sku: z.string().trim().min(1).max(64),
  unitPrice: positiveMoneySchema,
  // ...
}).strict();

export type CreateProductInput = z.input<typeof createProductSchema>;
export type CreateProductData = z.output<typeof createProductSchema>;
```

- React Hook Form uses `zodResolver(createProductSchema)` for immediate feedback.
- The Server Action calls `createProductSchema.safeParse(input)` again. Client validation is never trusted.
- Use `z.input` for raw form values and `z.output` after normalization/transforms.
- Cross-field rules use `superRefine` in the same schema.
- Database-derived rules such as uniqueness, current stock, active state, and lifecycle are service checks, not Zod checks.
- Do not duplicate form validation in components or actions.
- Zod error flattening maps fields to the shared `fieldErrors` result.
- Money accepts a constrained decimal string and converts to cents through a tested pure helper. Do not use `parseFloat`.

## Server Action pattern

Actions are thin, return typed results, and revalidate only after commit:

```ts
"use server";

export async function createProduct(
  input: CreateProductInput,
): Promise<ActionResult<{ productId: string }>> {
  const context = await getActionContext();
  if (!context.ok) return context.error;

  const allowed = requireAnyRole(context.data.user, ["admin", "inventory"]);
  if (!allowed.ok) return allowed;

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  try {
    const result = await productService.create(parsed.data, context.data);
    updateTag("products");
    revalidatePath("/inventory/products");
    return { ok: true, data: result };
  } catch (error: unknown) {
    return mapActionError(error, context.data.correlationId);
  }
}
```

Standards:

- Authorization precedes data disclosure and mutation.
- Never accept actor IDs, role keys, totals, prices, or status from the browser when the server can derive them.
- Each action maps named domain errors to the API error vocabulary.
- Catching an error must add context or convert it; do not silently swallow.
- `redirect()` is performed outside broad `try/catch` blocks, or the client navigates from a successful result.
- Revalidation occurs after the service resolves, never inside a transaction. Server Actions use `updateTag()` for immediate read-your-writes semantics; non-interactive invalidation may use `revalidateTag(tag, "max")`.
- Actions are idempotent where practical. Lifecycle actions use status + version checks to make duplicate submissions safe failures.

## Domain services and transactions

- Services own business invariants and transaction scope.
- A workflow that writes more than one related row uses one Drizzle transaction.
- Acquire locks in deterministic order.
- Prefer conditional SQL updates and database constraints over check-then-write races.
- Audit insertion belongs in the same transaction as the audited mutation.
- Invoice and ledger writes are not independently callable; only order workflows invoke them.
- Pass a transaction object explicitly to repositories used inside a workflow.
- Do not perform network calls inside database transactions. Stretch email delivery uses an outbox/event approach after MVP, not a Resend call before commit.
- Convert known PostgreSQL constraint codes to stable domain errors; do not leak constraint names to UI copy.

## Database access

- Select explicit columns. Avoid returning password/auth tokens or using broad `select *`-equivalent shapes at UI boundaries.
- Parameterize all values. Dynamic sort columns must come from an allowlisted map.
- Escape `%`, `_`, and `\` in user-provided `ILIKE` search strings.
- Every list query has bounded pagination.
- Migrations are forward-only once shared/deployed; fix a released migration with a new migration.
- Generated migration SQL is reviewed for locks, data loss, constraints, and indexes.
- Production schema changes run with migration credentials, never the runtime application role.

## Error handling

### Expected errors

Return `ActionResult` for validation, authentication, authorization, not-found, stale state, uniqueness, insufficient stock, and last-Admin conditions.

- Field-specific failures include `fieldErrors`.
- State conflicts explain what changed and how to recover.
- `NOT_FOUND` may intentionally cover forbidden entity access to avoid leaking existence.
- User-facing messages are actionable and do not expose internals.

### Unexpected errors

- Generate/propagate one UUID correlation ID per action/request.
- Log a structured record with operation, correlation ID, actor ID when known, normalized error, and safe entity IDs.
- Return `INTERNAL_ERROR` plus generic copy and correlation ID.
- Route errors are handled by the nearest `error.tsx`; widget errors by local boundaries.
- Never log passwords, cookies, JWTs, Supabase keys, full form payloads, or customer notes.

## Forms

- Every input has a visible label and associated error/help text.
- Disable only controls that must not change during submission; prevent duplicate submission.
- Preserve user input after expected failure.
- Focus the first invalid field after validation.
- Use native input semantics (`email`, `tel`, `autocomplete`) where applicable.
- Confirmation dialogs describe side effects for confirm, cancel, fulfill, archive, role change, and disable.
- Success copy states the resulting business object, not merely “Success.”

## Tables and URL state

- Every business data grid uses the shared TanStack Table wrapper.
- The server owns pagination, filtering, and sorting; the client controls UI and writes canonical URL parameters.
- All URL parameters are Zod-validated and all sortable columns are allowlisted.
- Default page size is 20; options are 10, 20, 50, and 100.
- A filter/sort change resets page to 1.
- Column visibility may remain local UI state because it is presentational; filters/sort/page remain in the URL.
- Empty unfiltered and empty filtered states use different copy.
- Row actions are keyboard-accessible and role-aware.

## Styling and accessibility

- Use Tailwind design tokens and shadcn CSS variables; avoid unexplained one-off colors.
- Use `cn()` for conditional class composition.
- Do not use inline style except for library-required dynamic values such as chart dimensions.
- Maintain WCAG 2.1 AA contrast.
- Support keyboard navigation and visible focus.
- Use semantic HTML first; ARIA supplements semantics rather than replacing them.
- Icon-only buttons require accessible names and tooltips where meaning is not obvious.
- Respect reduced motion.

## Testing expectations

### Must have tests

For every feature:

- Zod schemas: valid input, boundary values, normalization, and invalid/cross-field cases.
- Permission helpers: each role and unauthenticated/inactive states.
- Money and status/lifecycle pure functions.
- Server Action adapters: validation failure, unauthorized role, successful service delegation, safe error mapping, and revalidation behavior where meaningful.
- Domain services that mutate data: success and all business-rule failures against a real isolated test database.
- Interactive components: validation display, pending state, expected action failure, and successful flow.
- URL table state: parse/default/reset behavior and sortable-column allowlist.

Critical integration tests:

- Stock adjustment cannot produce negative stock and always creates a movement/audit row.
- Draft update rejects stale versions.
- Order confirmation creates deductions, movements, invoice, balanced journal, status/version, and audit rows atomically.
- Insufficient stock rolls back every confirmation side effect.
- Competing confirmations for limited stock allow only a valid outcome and never negative stock.
- Confirmed cancellation restores stock, voids invoice, posts a balanced reversal, and appends audit rows.
- Invalid lifecycle transitions fail.
- Last active Admin cannot lose access.
- Append-only tables reject update/delete.

Playwright tests:

- Login/logout and protected-route redirect.
- Sales user creates and confirms an order, then views/downloads its invoice.
- Inventory user fulfills the confirmed order.
- One RBAC denial smoke test verifies a forbidden route and action.

Accessibility tests:

- Automated axe checks on the key pages listed in `UI_SPEC.md`.
- Keyboard smoke test for login, data-table controls, order wizard, and confirmation dialogs.

### Tests not required

- Snapshot tests for static markup.
- Direct tests of unmodified shadcn/ui or third-party library internals.
- One test per trivial visual wrapper.
- Tests that merely repeat TypeScript or Zod guarantees.
- Byte-for-byte PDF snapshots; assert semantic content, response headers, and authorization.
- Generated migration text snapshots. Test the resulting constraints instead.

### Test quality

- Use behavior-based names: `rejects confirmation when any line lacks stock`.
- Prefer user-visible queries in React Testing Library.
- Do not mock Drizzle in domain-service tests; use rollback-isolated or reset-isolated Postgres data.
- Mock at network/process boundaries, not the function under test.
- Use factories with explicit overrides and deterministic time/UUID helpers.
- No test may depend on execution order.
- Set an initial coverage gate of 80% lines/functions and 75% branches for `src/features/**`, excluding generated UI and route composition. Coverage is a floor, not a substitute for invariant tests.

## Tooling gates

Required scripts:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

- Pre-commit through Husky/lint-staged: Prettier and ESLint on staged supported files; no full database/e2e suite.
- CI pull-request gate: format check, lint, typecheck, unit/component tests, integration tests, build, and critical Playwright tests.
- Do not bypass hooks to land failing code.

## Documentation and commits

- Public utilities and non-obvious invariants receive concise TSDoc; obvious code does not.
- Comments explain why, concurrency assumptions, or external constraints—not a restatement of syntax.
- Update affected specs before implementation when behavior changes.
- Keep one focused task per commit using Conventional Commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.
- Do not combine formatting or unrelated cleanup with feature behavior.
- Never commit `.env*`, Supabase keys, test credentials, generated PDFs, Playwright traces, or local database artifacts.

