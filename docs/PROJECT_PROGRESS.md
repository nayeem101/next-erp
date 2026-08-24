# NextERP Project Progress

## Current status

- Last updated: 2026-08-22
- Current phase: Phase 1 — Foundation, database, authentication, and RBAC
- Status: Stock-adjustment dialog done; next is cross-product Stock Movements page/grid
- Active task: None
- Next eligible task: Implement paginated product queries with category/search/status/low-stock filters, sorting allowlist, and integration tests
- Blocker: None — proceeding task-by-task with a commit per completed task

`docs/TASKS.md` is the authoritative task checklist. This file summarizes execution status and evidence; it does not replace the task plan.

## Phase status

- Phase 0 — Specification: Complete and approved
- Phase 1 — Foundation, database, authentication, and RBAC: In progress
- Phase 2 — Inventory: Not started
- Phase 3 — Customers: Not started
- Phase 4 — Sales order drafts and wizard: Not started
- Phase 5 — Confirmation, invoicing, ledger, and fulfillment: Not started
- Phase 6 — Streamed dashboard: Not started
- Phase 7 — Audit UI, release hardening, and deployment: Not started
- Phase 8 — Optional stretch scope: Locked until MVP completion and explicit approval

## Update protocol

After every completed task from `docs/TASKS.md`:

1. Run the task's required lint, typecheck, and test checks.
2. Mark only that task complete in `docs/TASKS.md`.
3. Update the date, phase status, active task, next eligible task, and blocker above.
4. Add a newest-first entry to the execution log with changed areas and verification evidence.
5. Record a commit hash only when the user explicitly requested and approved creating the commit.
6. Do not mark a phase complete until its phase gate passes.

## Execution log

### 2026-08-24 — Stock adjustment dialog completed

- Added `features/products/components/stock-adjustment-dialog.tsx`: reasoned delta/reason form with client validation mirroring the shared contract (non-zero integer within +/-1M, required trimmed reason). Success closes, resets the draft, and refreshes. Rejected adjustments — including INSUFFICIENT_STOCK — keep the dialog open, preserve the draft, surface the error alert, and keep the live balance visible in the description so a corrected delta can be submitted immediately. Pending state disables resubmission.
- Wired an "Adjust stock" trigger into `ProductStatusActions` on the detail page (Admin/Inventory only).
- Component tests (4): current-balance echo in description, zero-delta/blank-reason blocking without server calls, parsed integer + trimmed reason on success with refresh, insufficient-stock recovery keeping dialog/draft/balance.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, 290 unit + 23 product integration tests.

### 2026-08-24 — Product detail page completed

### 2026-08-24 — Product detail page completed

- Added `app/(dashboard)/inventory/products/[productId]/page.tsx`: server component 404s unknown products, renders summary cards (Money price, stock with destructive low-stock styling at/below reorder, reorder level, availability), status badges incl. low-stock indicator, description, and the movement section under Suspense. Movement URL state is scoped so product filters cannot poison history pagination.
- Added `product-status-actions.tsx`: role-gated Edit link plus confirmed Archive/Restore dialog; restore conflicts (inactive category) surface inline without closing.
- Added `stock-movement-table.tsx`: read-only append-only table with type badges, signed deltas (+/- with direction icon), resulting stock, order-number links into `/sales/orders/[id]`, reason, actor, and LocalDateTime timestamps; dedicated "No stock movements recorded." empty state; pagination bound to canonical hrefs on the product scope.
- Component tests (7): row rendering incl. signed deltas and order reference links, em-dash placeholders for non-order rows, empty state, scoped pagination href, sales-role invisibility, edit link target, archive/restore flows with inline conflict alert.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, 286 unit tests.

### 2026-08-24 — Product create/edit forms completed

### 2026-08-24 — Product create/edit forms completed

- Added `getProduct` single-row query (join categories, serialized cents) powering the edit route with `notFound()` for missing ids.
- Added `features/products/components/product-form.tsx`: one TanStack form owns both modes. Category uses the searchable combobox; SKU auto-uppercases while typing; unit price validates as a decimal string > 0; reorder level and create-only opening stock are integer inputs. Create mode without active categories renders the prerequisite notice linking to Categories instead of the form. Server VALIDATION_ERROR field errors map back onto fields; UNIQUE_CONFLICT surfaces inline while preserving the draft; success navigates to the products grid. Edit mode seeds from `getProduct` (cents -> decimal string), shows read-only stock copy, and never submits stock fields.
- Routes: `/inventory/products/new` and `/inventory/products/[productId]/edit`.
- Component tests (6): prerequisite state, normalized submit incl. opening stock, client validation blocking, unique-SKU conflict draft preservation, edit seeding + no-stock submission, read-only stock.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, 279 unit + 23 product integration tests.

### 2026-08-24 — Products page and grid completed

### 2026-08-24 — Products page and grid completed

- Added `app/(dashboard)/inventory/products/page.tsx`: server component parses canonical list query (malformed URLs degrade to defaults), fetches one page plus active-category options and the action context in parallel, and renders inside Suspense with a table skeleton.
- Added `features/products/components/products-grid.tsx`: URL-bound grid with SKU (mono), name-over-category, exact Money cells, destructive low-stock treatment (icon + sr-only note when active stock is at/below reorder), reorder-at column, status badges, and role-gated actions — Edit links to `/inventory/products/[id]/edit`, Archive/Restore runs through a confirmed dialog that surfaces conflicts inline without closing. Toolbar filterSlot carries an aria-current segmented stock-status control (Active/Low stock/Archived/All) plus a category scope combobox; sort clicks map column order onto the server allowlist (`price` -> `price_asc/desc`, `stock` asc-only) and every control navigates canonical hrefs.
- Component tests (10): cell rendering incl. money formatting, low-stock marker uniqueness and coloring, both empty states, sales-role read-only view, archive/restore confirmation flows with inline conflict alert, canonical href assertions for status segments, allowlist sort mapping, pagination totals.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, 273 unit + 23 product integration tests.

### 2026-08-24 — Stock movement list query completed

### 2026-08-24 — Stock movement list query completed

- Added `features/products/stock-movement-schemas.ts` and `stock-movement-queries.ts`: `listStockMovements` serves both the product-detail history and the cross-product audit trail. Filters compose additively — product scope, movement type enum, actor, inclusive `YYYY-MM-DD` date window (`>= from::date`, `< to+1day`), and exact case-insensitive order-number match through a left join on orders (non-order movements stay visible). Sort allowlist: newest (id tiebreak), oldest, delta asc/desc; rows join products/users/orders for SKU/name/actor/order-number display.
- Integration tests (7): newest-first ordering with joined display names, type isolation, actor scoping across products, inclusive two-sided date windows, case-insensitive order-number lookup via sale movement, delta sort coverage, deterministic pagination at the pageSize floor.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, 263 unit + 23 product integration tests.

### 2026-08-24 — Product write services completed (create/update/setActive/adjust)

### 2026-08-24 — Product write services completed (create/update/setActive/adjust)

- Added `features/products/service.ts`: `createProduct` validates an active category (`NOT_FOUND`/`CONFLICT`), inserts the product with normalized SKU and bigint cents, writes the spec-mandated `Opening balance` movement when `openingStock > 0`, and appends `product.created`; `updateProduct` performs a full-field diff audit without touching stock and rejects inactive target categories; `setProductActive` gates restore on an active category and is idempotent no-op when state matches; `adjustStock` uses a single guarded atomic SQL update (`stock_on_hand + delta` between 0 and 1M) so concurrent adjustments cannot lose writes — negative results fail with `INSUFFICIENT_STOCK`, archived products with `CONFLICT` — then appends the adjustment movement row plus `product.stock_adjusted` audit in one transaction. Audit metadata serializes cents as strings (JSONB cannot carry BigInt).
- Added `features/products/actions.ts`: five server actions with Admin/Inventory guards, schema validation, and products/audit-log tag invalidation.
- Integration tests (9): opening movement + audit trail, zero-stock no-movement, case-insensitive SKU conflicts, missing/inactive category errors, sales-role rejection without writes, positive/negative adjustments with movement rows, insufficient-stock rollback isolation, archived-product conflict, restore-blocked-by-inactive-category with recovery.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, 263 unit tests.

### 2026-08-24 — Category form dialog completed (Categories section finished)

### 2026-08-24 — Product schemas completed

- Added `features/products/schemas.ts`: strict create/update/setProductActive/adjustStock contracts per API spec — SKU trimmed+uppercased (matching the upper() unique index), money as decimal strings validated to <=2 places and convertible to positive bigint cents with magnitude caps, quantities coerced integers bounded [0, 1M], zero-delta stock adjustments rejected via refine, reason required. List query schema adds category filter, low-stock status enum, seven-entry sort allowlist; serialized grid rows carry integer cents.
- Tests (12): SKU case-collision identity, money edge cases (zero/negative/over-precision/absurd), integer coercion incl. numeric-string stock, strict keys, update-vs-create shape differences (no openingStock on updates), adjustStock delta bounds + zero rejection, list defaults/coercion/allowlists.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck.

### 2026-08-24 — Category form dialog completed (Categories section finished)

- Added `CategoryFormDialog` covering both create and edit modes with one field contract: TanStack Form fields validate on change (name required/<=100, description <=1000), submit runs the shared schema server-side, VALIDATION_ERROR field errors merge into inline alerts, UNIQUE_CONFLICT renders via ActionErrorAlert without discarding the draft, success closes + refreshes.
- Wired into `CategoriesGrid`: role-gated "New category" toolbar button, per-row Edit button, conditional mounting keeps drafts remount-fresh; archive/restore flow from the prior task composes with it.
- Dialog tests (5): blank-name blocking with inline message, trimmed submission payload + close + refresh, conflict alert preserving input, edit prefill + categoryId payload, heading/entity anchoring.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (251 passing), integration tests (150 passing), build 7 Partial-Prerender routes.

### 2026-08-24 — Categories page and grid completed

- Added `/inventory/categories` (inside the inventory module layout): server component parses searchParams through `parseListQuery` + the category query schema, fetches the page via the shared query, and streams inside Suspense with a `DataTableSkeleton` fallback; hostile URLs degrade to defaults.
- Added `CategoriesGrid`: server-provided canonical URL values drive `DataTableToolbar`, controlled sorting (`name` <-> `name_desc` href swaps), and `DataTablePagination` with default-omitting hrefs; columns show name/slug, description, active-product counts, Active/Archived badges; unfiltered vs filtered empty states swap; archive/restore rows open the shared `ConfirmationDialog` wired to `setCategoryActiveAction`, surfacing CONFLICT rejections inline and refreshing on success. Action visibility is role-gated to Admin/Inventory.
- Badge primitive gained a warning variant for archived states.
- Component tests (9): rendering with badges/counts, both empty-state variants, role-hidden controls, archive/restore confirmation payloads + refresh, inline conflict alert without dialog dismissal, sort href toggling with default omission, pagination totals/navigation.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (246 passing), integration tests (150 passing), build now shows 7 Partial-Prerender routes.

### 2026-08-24 — setCategoryActive completed

- Extended the service with `setCategoryActive`: NOT_FOUND on miss; archival counts only ACTIVE products (archived ones never block) and rejects with CONFLICT explaining the prerequisite, leaving state and audit untouched; restore flips back freely. Both directions write `category.archived`/`category.restored` with before/after isActive metadata and restamp updatedBy.
- Added `setCategoryActiveAction` with Admin/Inventory guard and tag invalidation on success.
- Integration tests (6): archive empty + audit payload, active-product CONFLICT without residue, archived-products-don't-block, restore audit, NOT_FOUND, sales FORBIDDEN.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck.

### 2026-08-24 — updateCategory completed

- Extended `features/categories/service.ts` with `updateCategory`: NOT_FOUND on missing rows; derives the new slug and diffs name/slug/description against stored state; uniqueness pre-check excludes the row itself (re-submitting one's own name passes) while drifted slugs resync deterministically to slugify(name); updates stamp updatedBy and write `category.updated` with before/after maps containing ONLY changed fields; concurrent 23505 races map to UNIQUE_CONFLICT.
- Added `updateCategoryAction` (Admin/Inventory guard) with categories + audit-log tag invalidation.
- Integration tests (6): rename diff audit with actor restamp, drifted-slug resync, NOT_FOUND, normalized-name collision into another category, self-name re-submission allowed, sales FORBIDDEN without mutation.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck.

### 2026-08-24 — createCategory completed

- Added `features/categories/service.ts`: `createCategory` derives the stable slug via slugify, pre-checks case-normalized name and derived-slug conflicts for a precise UNIQUE_CONFLICT message, inserts with createdBy/updatedBy stamps inside a transaction, writes `category.created` audit metadata `{after:{name,slug}}`, and maps concurrent 23505 races to the same conflict vocabulary.
- Added `createCategoryAction` (Admin/Inventory guard via module matrix) that invalidates the categories and audit-log tags on success per the spec.
- Integration tests (6): full create assertions (slug derivation, actor stamps, audit row), case-insensitive duplicate name rejection, distinct-name/same-slug collision, sales FORBIDDEN leaving table untouched, inventory allowed without admin, strict validation before authorization.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck.

### 2026-08-24 — Category list query completed

- Added `features/categories/queries.ts`: `listCategories` runs a joined page query (left join restricted to active products so empty categories survive with count 0) grouped per category, plus a parallel total count sharing the same predicate; search is escaped case-insensitive name matching; status filter defaults to active; the four-entry sort allowlist maps to lower(name) asc/desc, newest, and most_products (aggregate ordering only on the joined query, tie-broken by name).
- Added `listCategoriesAction` guarded by the inventory module matrix (Admin + Inventory); input type uses zod's input shape so defaulted fields stay optional at the boundary.
- Integration tests (11): default active-only name sort with exact active-product counts, archived/all universes, escaped search incl. literal `%` typed by users matching only true owners, name_desc, most_products ranking, deterministic pagination across two pages, unauthenticated/sales FORBIDDEN, inventory-allowed, validation-order on the sort allowlist. The suite truncates its owned tables per test — safe under serialized integration files.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (237 passing), integration tests (132 passing).

### 2026-08-24 — Category schemas completed

- Added `features/categories/schemas.ts`: strict create/update/setCategoryActive contracts per API spec (requiredText(100) name, optionalText(1000) description collapsing blanks to undefined, uuid ids); `slugify()` — NFKD accent transliteration, `&`→"and", symbol stripping, dash collapsing, deterministic output so duplicate detection can compare slugs directly; list query schema with status (default active) and a four-entry sort allowlist; serialized grid row/page types.
- Tests (12): slug determinism across casing/spacing variants, transliteration, boundary dashes; valid/invalid create shapes incl. length caps and unknown-key rejection; update/create duplicate-shape guarantee; boolean strictness on setCategoryActive; list defaults/allowlist/coercion.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck.

### 2026-08-24 — Phase 1 gate PASSED

- **Clean-database migrations**: recreated `nexterp-pg-test` from scratch (`docker compose down -v` + up), then bootstrap.sql + all migrations applied through the suite harness. Full integration suite passed three consecutive times on the fresh volume; a nondeterministic cross-file race was eliminated by removing connection churn from the users suite afterEach (per-call `vi.resetModules()` already isolates React cache state).
- **Full battery**: Prettier clean; ESLint zero warnings on strict config; strict TypeScript typecheck clean; 225 unit/component tests passing across 34 files; 121 integration tests passing across 18 files (schema constraints, triggers, services, actions); production build compiles with six Partial-Prerender routes (/login, /dashboard, order edit/new among them); Playwright ran desktop + mobile Chromium against the live Supabase project — 8 anonymous/invalid-credential flows passed, 8 authenticated flows skipped pending seeded E2E admin credentials.
- **Secret scan**: scripted sweep of `.next/static`, `.next/server/client-reference`, and `.next/server/app` for `sb_secret_*`, `SUPABASE_SECRET_KEY`, `service_role`, `DATABASE_URL`, and postgres connection strings — zero hits; only publishable keys reach client-reachable output.

Phase 1 is complete. Phase 2 (Inventory: categories → products) is next.

### 2026-08-24 — Cache helpers completed (Shared UI infrastructure section finished)

- Added `lib/cache/tags.ts`: central tag vocabulary (users, audit-log, categories, customers, invoices, orders, products) with an `entityTag()` composite builder and named `CACHE_LIFETIMES` profile objects (referenceData / operationalLists / volatile, seconds-based stale/revalidate/expire; volatile stays under the 5-minute short-lived threshold so it is excluded from prerenders).
- Added `lib/cache/invalidate.ts`: `invalidateTags` (read-your-own-writes via Next 16 `updateTag`), `refreshStale` (stale-while-revalidate via two-argument `revalidateTag(tag, profile)` — the deprecated single-argument form can never be reached through this helper), and `invalidatePath`. No `unstable_*` APIs anywhere.
- Wired invalidation into `setUserRolesAction`/`setUserActiveAction` success paths per the API spec ("Revalidates users and audit-log"); users integration suites mock `next/cache`.
- Tests (9): kebab-case/uniqueness invariants on the tag registry, deterministic entity-tag composition, monotonic lifetime bounds, updateTag-vs-revalidateTag isolation, required-profile forwarding, and path delegation.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (225 passing), integration tests (121 passing).

### 2026-08-24 — Searchable combobox completed

- Added `components/shared/searchable-combobox.tsx`: WAI-ARIA combobox pattern over the shared Input — debounced server-side loading (`loadOptions(query)` receives raw trimmed queries; no client filtering), `aria-expanded`/`aria-controls`/`aria-activedescendant` wiring, ArrowDown/ArrowUp/Enter/Escape keyboard support with clamped highlight indices, mousedown-before-blur selection commit, "Searching…" polite status while in flight, explicit empty-state message, external canonical value reseeding via render-time reset, and null reporting when the field clears.
- Tests (6): debounce collapses keystrokes into one fetch with final query, keyboard highlight + Enter selection payload and closed state, Escape closes without selecting, empty-state rendering without options, in-flight status resolution to listed options, and clear-to-null semantics.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (216 passing).

### 2026-08-24 — Shared form controls completed

- Added `form-error-summary.tsx`: aggregates fieldErrors into a count headline ("Please fix N issues") with capitalized field/message list items; falls back to the summary message when no field errors exist.
- Added `form-controls.tsx`: generic `ConfirmationDialog` (destructive variant, pending state, children slot for inline warnings/errors) and `SubmitButton` (pending disable + label swap).
- Added `inputs.tsx`: `CurrencyInput` binds visible major-unit drafts to integer-cents callbacks through a strict decimal parser (no floats cross the boundary; invalid input is marked but never propagated; external canonical updates reseed via the React-blessed render-time reset pattern — no effect cascades) and `QuantityInput` (whole numbers ≥ min only; blur snaps invalid drafts back to committed value).
- `ActionErrorAlert` already existed from the auth phase and is reused as-is.
- Tests (10): summary list-item text and fallback, pending button states, confirm/cancel/children-slot flows, cent-exact typing (12.5 → 1250), invalid-input rejection + null on clear, canonical round-trip while unfocused, quantity propagation rules and blur restore.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (210 passing), integration tests (121 passing), production build.

### 2026-08-24 — Shared display components completed

- Added `components/shared/data-table-skeleton.tsx`: column-aware loading placeholder that keeps header labels visible, sizes pulsing cells deterministically, and marks the region `aria-busy`.
- Added `components/shared/display.tsx`: `EmptyState` (unfiltered vs filtered copy — filtered explains narrowing filters rather than implying missing data), `LocalDateTime` (locale rendering with machine-readable `dateTime` and exact UTC tooltip for auditors), and `Money` (exact Intl formatting from serialized integer cents, string-safe, currency parameter).
- Added `components/shared/status-badge.tsx`: exhaustive typed mappings — OrderStatusBadge (draft/confirmed/fulfilled/cancelled), InvoiceStatusBadge (issued/void), EntityActiveBadge (active/archived), StockLevelBadge (in/low/out) — plus a neutral `StatusBadge` base; adding an enum value without extending the map is now a compile error.
- Tests (11): full status-map coverage, datetime/UTC tooltip attributes, exact cents formatting incl. string payloads and EUR, unfiltered/filtered copy divergence, skeleton busy-state with header/placeholder counts.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (200 passing), integration tests (121 passing).

### 2026-08-24 — Reusable DataTable infrastructure completed

- Added `components/shared/data-table/data-table.tsx`: generic server-fed grid on a module-level TanStack Table v9 hook (core + sorting features); exports `createDataTableColumnHelper` so consumer columns stay type-checked against their rows. Sorting is fully controlled (`manualSorting`) — header buttons emit `{id, desc}` descriptors via `onSortChange`, headers carry `aria-sort`, and sort indicators render inside accessible buttons.
- Added `data-table-toolbar.tsx`: debounced search (timer cleanup verified), faceted-filter slot, column-visibility menu over canonical `columns` CSV values, and a Reset control that appears only with active state and preserves pageSize; every navigation goes through `listQueryHref`.
- Added `data-table-pagination.tsx`: labelled nav landmark with live "Showing X–Y of Z" count, page-size menu, prev/next icon buttons with dynamic aria-labels and boundary disabling; hrefs omit default-equal values.
- Tests (8): header scope/aria-sort contract, controlled sort descriptor emission, empty-state swap-in, result-count line and boundary-disabled pagination hrefs (default omission proven by bare-path push), toolbar labelling/menu trigger/debounced single-navigation (fake timers + fireEvent) /reset semantics.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (189 passing), integration tests (121 passing).

### 2026-08-24 — Shared list-query infrastructure completed

- Added `lib/list-query/parse.ts`: `parseListQuery` flattens URLSearchParams or Next.js search-param records with last-value-wins, parses against an object schema (coercion + defaults), ignores unknown keys silently, and on validation failure drops invalid keys individually before re-parsing so hostile URLs degrade to defaults; reports `recovered` so callers can rewrite sanitized URLs.
- Added `lib/list-query/canonical.ts`: `canonicalSearchParams` sorts keys alphabetically, drops undefined/null/empty values and default-equal values while keeping meaningful falsy values (false/0); `listQueryHref` merges a patch over current values (undefined deletes) for pagination/filter links.
- Added `lib/list-query/escape.ts`: `escapeLikePattern`, `ilikeContainsPattern`, `ilikeStartsWithPattern`; refactored the users query to consume the shared helper instead of its private copy.
- Unit tests (18): flattening/coercion/recovery semantics, strict-schema noise tolerance, canonical ordering/default omission/falsy retention/href merge-delete/round-trip, and LIKE escaping of %/_/backslash.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (181 passing), integration tests (121 passing).

### 2026-08-24 — Admin Users grid completed (auth section finished)

- Installed `@tanstack/react-table` v9 and adopted its new `createTableHook` API: a module-level hook registers `coreFeatures` plus the core row model once; columns are declared through the typed app column helper (`columnHelper.columns([...])` preserves per-column value types) and rendered with standalone `flexRender`.
- Added UI primitives: Base UI `dialog.tsx` (portal/overlay/popup with close affordance), `checkbox.tsx`, `badge.tsx`, and plain `table.tsx` wrappers.
- Built `/admin/users`: server page guards Admin via layout+page context, feeds one server page (pageSize 50) into `UsersTable`; empty state explains Supabase provisioning; own row labelled "(you)"; roles render as badges; status as success/destructive badges; last sign-in formatted in UTC or "Never".
- Added `RoleAssignmentDialog` (three labeled checkboxes with role descriptions initialized from persisted state each mount, save through `setUserRolesAction`) and `ConfirmUserActiveDialog` (enable/disable copy, destructive disable warning); both surface failures inline via `ActionErrorAlert` so LAST_ADMIN rejections explain themselves without closing, close + `router.refresh()` on success. Submit handlers avoid deprecated React.FormEvent by using React.SubmitEvent + voided async submit.
- Component tests (7): column/identity rendering, "(you)" labelling, empty state, role dialog open->toggle->save payload + refresh + auto-close, LAST_ADMIN inline alert keeping dialog open without refresh, enable/disable confirmation flows hitting `setUserActiveAction` with correct target states.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (163 passing), integration tests (121 passing), production build.

### 2026-08-24 — setUserActive service/action completed

- Extended schemas with strict `setUserActiveSchema` (`userId: z.uuid()`, boolean `isActive`) and the serialized result contract.
- Added `setUserActive` service sharing the role-administration advisory lock (an admin's active flag participates in the last-admin invariant): loads the target (NOT_FOUND on miss), and when disabling an admin counts other ACTIVE admins before flipping the flag; writes `user.enabled`/`user.disabled` with before/after isActive metadata in the same transaction.
- Added `setUserActiveAction` with validation-before-authorization Admin guard.
- Integration suite (10 tests): disable/enable round-trips with audit metadata, NOT_FOUND, LAST_ADMIN rejection leaving state and audit untouched, inactive admins excluded from survivors, allowed demotion when a second active admin exists, non-admin disable unaffected by admin counts; action-level FORBIDDEN-without-mutation, success, and strict-validation ordering.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (156 passing), integration tests (121 passing).

### 2026-08-24 — setUserRoles service/action completed

- Extended `features/users/schemas.ts` with `setUserRolesSchema` per the API spec: strict object, uuid id (z.uuid()), role array min 1 max 3 with a uniqueness superRefine.
- Added `features/users/service.ts`: `setUserRoles` runs in one transaction guarded by `pg_advisory_xact_lock` on a dedicated role-administration key; loads current memberships, canonicalizes before/after key order, rejects removing the last ACTIVE Admin (`LAST_ADMIN`) by counting other active administrators, replaces memberships with `assigned_by` stamped to the acting admin, and writes `user.roles_changed` with `{before:{roles}, after:{roles}}` metadata.
- Added `setUserRolesAction` (Admin-only guard, validation before authorization) returning `{ userId, roles }`.
- Integration suite `set-user-roles.integration.test.ts` (8 tests): membership replacement + assigned_by + audit before/after, NOT_FOUND for unknown users, LAST_ADMIN on sole-admin demotion with state left untouched, inactive admins excluded from the survivor count, demotion allowed when another active admin exists, and a concurrent double-demotion proving exactly one succeeds via the advisory lock; plus action-level FORBIDDEN-without-mutation and success paths.
- Test-infra change: integration files now run with `fileParallelism: false` because role administration asserts global invariants against the shared disposable database; this also eliminates cross-file truncation races. The set-user-roles suite truncates identity tables per test to guarantee a clean universe.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (156 passing), integration tests (111 passing).

### 2026-08-24 — Admin user-list query completed

- Moved the canonical `ROLE_KEYS`/`RoleKey` vocabulary into browser-safe `lib/auth/roles.ts`; `current-user.ts` re-exports for compatibility so schemas and UI can share it without touching server-only modules.
- Added `features/users/schemas.ts`: `userListQuerySchema` with trimmed optional search (max 100), role/status enums, coerced page/pageSize bounds (page >= 1, pageSize 5-100), plus serialized `UserListRow`/`UserListPage` contracts (ISO date strings) for client components.
- Added `features/users/queries.ts`: two round-trip listing — paginated profiles ordered by case-insensitive email (matching the unique lower-email index), then role memberships for exactly that page grouped in memory in canonical admin/sales/inventory order; search uses LIKE-escaped case-insensitive matching across email and display name, role filter via `exists()` subquery, status via boolean equality, and a parallel count with the same predicate.
- Added `listUsersAction` (Admin-only through `getActionContext(["admin"])`) returning the shared ActionResult shape.
- Tests: six schema unit tests; eleven integration tests covering ordering, role grouping/ordering, dual-field case-insensitive search, literal treatment of LIKE metacharacters (`%`), role/status/combination filters, deterministic pagination with totals, empty results, and the authorization matrix (unauthenticated/non-Admin/Admin/validation order). Fixtures use per-test unique tokens instead of truncation so the suite coexists with concurrently running integration files.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (152 passing), integration tests (103 passing), production build with `/login` still Partial-Prerender.

### 2026-08-22 — Playwright authentication coverage completed

- Extended the e2e environment contract with optional `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (both-or-neither validation); authenticated flows skip when absent.
- Added `e2e/auth.spec.ts`: anonymous protection redirects for `/dashboard` and deep links (`next=%2Finventory%2Fproducts%3Fpage%3D2`), generic invalid-credential messaging with preserved input, and — when seeded admin credentials are provided — sign-in success, primary-navigation role assertion, account-menu identity, deep-link return through `next`, sign-out re-protection, and authenticated bounce away from `/login`.
- Updated the smoke spec for the new root behavior (anonymous `/` → `/login`) and replaced the template-era heading assertion; login page title is now a real `h1`.
- Verified live against the configured Supabase project: 8 passed (desktop + mobile Chromium), 8 skipped pending seeded credentials; documented the contract in `e2e/README.md`.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (146 passing), integration tests (92 passing).

### 2026-08-22 — Login page and form completed

- Added `/login` as a Partial-Prerender route: the static card shell streams instantly while a Suspense-gated content component verifies the session (redirecting authenticated users) and sanitizes the `next` parameter before rendering the form.
- Built `LoginForm` with TanStack Form: Standard-Schema validation through a form-local extension of the shared `signInSchema` (blank `next` normalizes to absent), labeled email/password fields, show/hide password toggle with `aria-pressed`, per-field errors linked via `aria-describedby`, focus moved to the first invalid field after failed validation (fields stay enabled during validation so focusing works), pending "Signing in…" state with disabled controls during the action call, and full `window.location.assign` navigation to the server-provided redirect target on success.
- Errors render through the shared `ActionErrorAlert`: generic invalid credentials, disabled account, unprovisioned account, and unexpected failures with correlation IDs.
- Added seven component tests covering labels, toggle behavior, field-error presentation/focus, both failure messages with input preservation, pending label/disabling, and success navigation; fixed along the way by switching to `useSelector` for store reads.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (146 passing), integration tests (92 passing), production build.

### 2026-08-22 — Sign-in/sign-out actions completed

- Added the browser-safe `signInSchema` (`src/features/auth/schemas.ts`): trimmed lowercase email, 8–128 char password, optional `next`, strict object boundary.
- Implemented the `signIn` workflow (`src/features/auth/service.ts`): Supabase `signInWithPassword`, admission check requiring an active application user with at least one role (rejections also clear the fresh session), `last_signed_in_at` stamp plus `auth.signed_in` audit event in one transaction, and same-origin-sanitized redirect target.
- Reworked `src/features/auth/actions.ts`: public `signIn` action returning typed results with validation flattening and generic credential failures; `signOut` now returns `{ redirectTo: "/login" }` per the API contract, treating a missing session as success; `UserMenu` navigates on the result.
- Added the shared server-only audit writer (`src/lib/audit/writer.ts`) used inside caller transactions.
- Added schema unit tests and eight action integration tests against the disposable database (success, safe `next`, audit/last-signed-in writes, generic invalid credentials without message leakage, disabled account, roleless account, unprovisioned identity, validation short-circuit).
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (139 passing), integration tests (92 passing), production build.

### 2026-08-22 — Application shell and shared error UI completed

- Completed the responsive accessible shell: sticky header with skip link, server-rendered desktop navigation, a client `MobileNav` Sheet island (hidden md+) sharing the same role-filtered links, and an initials `UserMenu` dropdown exposing identity plus a working sign-out through a new minimal `signOut` Server Action (`src/features/auth/actions.ts`, full auth actions arrive with the login task).
- Added the accessible `Breadcrumbs` component (landmark labeling, `aria-current` terminal entry, link-safe middle entries) for page-level trails, and a `(dashboard)/loading.tsx` route skeleton; the shell already streams a skeleton fallback under Suspense.
- Added shared error surfaces: root `not-found.tsx` (dual not-found/or-no-access copy), client `error.tsx` with digest reference and retry, `global-error.tsx` owning the document, the existing `ForbiddenAccess` 403 presentation, and a typed `ActionErrorAlert` that renders an `ActionError` message with field-error lists while never surfacing raw codes.
- Component tests cover breadcrumbs structure/landmarks, alert variants including code suppression, and user-menu semantics (initials derivation, accessible trigger); Base UI ignores synthetic pointer events in jsdom, so opened-menu flows are deferred to the Playwright suite.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (134 passing), production build with Partial Prerender shells.

### 2026-08-22 — Protected dashboard layout and module guards completed

- Added the pure role-aware navigation model (`src/lib/auth/navigation.ts`) with per-module role requirements and a `visibleNavItems()` filter; covered by an eight-subset visibility matrix test plus href/label integrity checks.
- Restructured `(dashboard)/layout.tsx` around a Suspense-wrapped authenticated shell (Cache Components requirement): skeleton fallback streams instantly, verified users receive the filtered nav, unauthenticated requests redirect to login, and inactive/unprovisioned users get the shared forbidden UI. Correlation-ID generation now occurs only after request-data access, fixing a prerender-order constraint from Next 16.
- Added guarded module layouts for inventory `[admin|inventory]`, customers `[admin|sales]`, sales `[all]`, invoices `[admin|sales]`, ledger `[admin]`, and admin `[admin]`; page-level Admin/Sales guards on `/sales/orders/new` and edit routes; shared `ForbiddenAccess` component; auth-aware root redirect moved into the Proxy so no static root page exists.
- Verified on a production server: anonymous `/` → `/login`, protected routes → `/login?next=<encoded>`, build emits Partial-Prerender shells for all dashboard routes.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (125 passing), integration tests (84 passing), production build.

### 2026-08-22 — Proxy session refresh and route protection completed

- Extended `src/proxy.ts`: unauthenticated requests to protected prefixes (`/dashboard`, `/inventory`, `/customers`, `/sales`, `/accounting`, `/admin`) redirect to `/login?next=<sanitized path+query>`; authenticated users hitting `/login` redirect to `/dashboard`; all other paths pass through. Redirect responses carry refreshed auth cookies so token renewals survive navigation, and every passthrough response propagates the `x-correlation-id`.
- Hardened the shared Proxy client's `setAll` against an absent headers argument.
- Added twelve Proxy unit tests under a Node environment using real `NextRequest`/`NextResponse` objects: protected-prefix coverage, public-path passthrough, login bounce for authenticated users, safe-next encoding and scheme-relative-host rejection, cookie propagation onto redirects, and correlation-ID generation/reuse.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (114 passing), production build.

### 2026-08-22 — Permission guards and RBAC matrix completed

- Added browser-safe role helpers under `src/lib/auth/roles.ts` (`hasAnyRole`) plus the documented `MODULE_ROLE_REQUIREMENTS` table covering inventory, customers, orders, order authoring, invoices, ledger, and administration.
- Added server-only guards under `src/lib/auth/guards.ts`: `requireUser()` maps unauthenticated/inactive/unprovisioned states to typed `UNAUTHENTICATED`/`FORBIDDEN` failures with fresh correlation IDs; `requireAnyRole()` authorizes verified users against a requirement; `getActionContext(allowed?)` chains both into the documented action-boundary pattern.
- Added an exhaustive permission-matrix test asserting, for all eight role subsets against every module, exactly the grants/denials derived from `ARCHITECTURE.md`; plus guard tests for each rejected caller state, correlation-ID issuance, chained context checks, and empty-requirement edge cases.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (102 passing), integration tests (84 passing).

### 2026-08-22 — Verified current-user context completed

- Added server-only `getCurrentUser()` under `src/lib/auth/current-user.ts`: identity verified through `supabase.auth.getUser()` (never cookie contents alone), profile loaded via Drizzle, disabled users reported as `inactive`, identities without an application row as `unprovisioned`, and role membership returned sorted by enum order; wrapped in React `cache()` so every layout/page/widget in one render pass shares a single verification round-trip.
- Exported the `RoleKey` union and `CurrentUser`/`CurrentUserResult` types for downstream permission guards.
- Added six integration tests using a mocked Supabase client (network boundary only) against the real disposable database: no session, Auth verification failure, unprovisioned identity, disabled user, full multi-role profile, and roleless-but-active member.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (85 passing), integration tests (84 passing).

### 2026-08-22 — Action results, error mapping, and money helpers completed

- Added the browser-safe `ActionResult` contract under `src/lib/errors/action-result.ts` with the nine-code vocabulary from `API_SPEC.md`, success/failure builders, `DomainError` for expected service failures, and Zod `flattenError`-based validation flattening into `fieldErrors`.
- Added server-only `mapActionError()` under `src/lib/errors/map-action-error.ts`: rethrows Next.js redirect/not-found control flow untouched, passes domain errors through with attachments, maps PostgreSQL unique/foreign-key/check/retry codes to stable messages without leaking constraint names or SQL text, and logs unexpected failures with a correlation ID while returning a generic internal error.
- Added exact money helpers under `src/lib/money.ts`: regex-constrained decimal parsing to `bigint` cents with rounding rejection and a 99,999,999,999.99 ceiling, canonical decimal-string serialization for RSC boundaries (including negative defense), and bigint wire-string bridges.
- Raised the TypeScript target to ES2020 for BigInt literal support.
- Added 29 unit tests across the three modules covering every code path, boundary values, round-trip exactness, control-flow rethrow, and leak prevention.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (83 passing), production build.

### 2026-08-22 — Security headers, redirects, correlation, and logging completed

- Added root `.cursorignore` excluding secrets/env files, dependencies and lockfile, build/test artifacts, generated PDFs, OS noise, and debug logs.
- Added `buildSecurityHeaders()` under `src/lib/security/headers.ts` wired through `next.config.ts`: CSP scoped to self plus the project's Supabase HTTPS/WSS endpoints (eval permitted only in development), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy`.
- Added `sanitizeRedirectPath()`/`isSameOriginRelativePath()` under `src/lib/auth/safe-redirect.ts`, rejecting absolute URLs, scheme-relative hosts, backslash tricks, embedded control characters, and oversized targets with a safe fallback.
- Added a server-only structured logger under `src/lib/errors/logging.ts`: single-line JSON records with operation, correlation ID, user ID, error code, and deep redaction of sensitive keys plus Supabase key-material masking; the Proxy now propagates an `x-correlation-id` on every response.
- Verified headers and correlation ID on a real production server response; added unit tests for redirect sanitization, header/CSP composition, log formatting, redaction, and correlation IDs.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (54 passing), production build.

### 2026-08-22 — Development seed infrastructure completed

- Added `src/db/seed.mts`, a Node-runnable (native TypeScript) seed module with relative imports: validates `SEED_DEMO_ADMIN_ID`/`SEED_DEMO_SALES_ID`/`SEED_DEMO_INVENTORY_ID` through Zod, loads `.env.local` without overriding real environment values, fails with an actionable message for unmapped identities, inserts the three fixed role rows idempotently, ensures application users exist from the provisioned auth identities, and assigns roles idempotently with the Admin holding all three roles.
- Wired the `db:seed` package script, documented the mapping variables in `.env.example`, and verified the CLI end to end twice against the disposable database (idempotent).
- Added four seed integration tests covering role-row creation, multi-role admin mapping, triple-run idempotency, and unmapped-identity rejection; Phase 1 seeds only mapped base users/roles per plan.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (28 passing), integration tests (78 passing), production build.

### 2026-08-22 — Test factories and transaction helpers completed

- Added `src/test/factories/db.ts`: shared prepared integration connection, `withRolledBackTransaction()` on a dedicated reserved connection (always rolls back, keeping suites order-independent), an overridable deterministic UUID factory, and a fixed-epoch `fixedDate(offset)` timestamp helper.
- Added `src/test/factories/factories.ts` covering every table: auth identity provisioning through the sync trigger, role lookup and idempotent membership assignment, category/product/customer creation with explicit overrides, and draft-order/line/confirm/fulfill/cancel lifecycle helpers — all accepting an optional transaction handle.
- Added six factory integration tests proving override application, idempotent assignment, full lifecycle driving, zero residue across rolled-back writes, and deterministic timestamps.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (28 passing), integration tests (74 passing).

### 2026-08-22 — Drizzle relations and schema barrel completed

- Added `src/db/schema/relations.ts` with inferred relations across the full ERD: user/role membership, category-product, customer-order, order-line/product, order-invoice, order/invoice-ledger, product/order-stock movements, and audit actor links (with relation-name disambiguation where tables reference each other more than once).
- Added a server-safe `src/db/schema/index.ts` barrel exporting every table object, enum, sequence, snapshot type, and relation definition; `getDb()` now passes the schema into the Drizzle instance so relational queries are available.
- Added a barrel smoke unit test asserting table exports, enum values, sequence presence, and module identity; kept test files outside drizzle-kit's schema scan.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (28 passing), integration tests (68 passing), and a no-op regeneration confirming no schema drift.

### 2026-08-22 — RLS hardening completed

- Added custom migration `0009_rls-hardening.sql`: row-level security enabled on all twelve application tables; an idempotent non-owner `nexterp_runtime` role (NOLOGIN, no superuser/bypassrls/createdb/createrole) with least-privilege grants — full CRUD on business tables, read-only `roles`, SELECT/INSERT only on the three append-only trails with explicit UPDATE/DELETE revocation, and sequence usage for order/invoice numbering; permissive policies scoped `TO nexterp_runtime` only; and a hosted-parity block that strips all table/sequence privileges from `anon`/`authenticated` wherever those roles exist.
- The test bootstrap now creates local `anon`/`authenticated` role stubs so RLS behavior mirrors a hosted Supabase project.
- Added six integration tests: catalog verification of RLS enablement and runtime-role privilege flags, runtime-role business-table CRUD, append-only UPDATE/DELETE denial (42501) with reads still permitted, browser-role zero-row visibility plus VALUES-based insert denial despite granted table privileges, and runtime sequence access.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (68 passing) against a database rebuilt from an empty state.

### 2026-08-22 — Lifecycle and integrity migration completed

- Added custom migration `0008_lifecycle-controls.sql`: `set_updated_at()` triggers on users/customers/categories/products/orders; an order lifecycle trigger enforcing the legal transition matrix, confirmation/fulfillment/cancellation actor-timestamp-reason requirements, and customer/currency/total immutability once an order leaves draft; a line-item guard that freezes lines on non-draft orders while still permitting the draft-order cascade delete; a `DEFERRABLE INITIALLY DEFERRED` constraint trigger requiring exactly two balanced entries per affected journal at commit; append-only rejection triggers for stock movements and ledger entries plus an audit-specific trigger whose only permitted update is the ON DELETE SET NULL actor safety valve.
- Added eight integration tests: automatic `updated_at` refresh, legal confirm→fulfill path, skipped/reversed/terminal transition rejections, missing actors/reasons rejections, snapshot-field freezing with non-snapshot fields still writable, line-item lockout after draft (update/delete/insert), unbalanced and single-entry journal commit failures, and stock-movement update/delete rejection with SQLSTATE 55006.
- Existing suites were updated to respect the new invariants: ledger postings now run as balanced pairs inside transactions, and movement fixtures confirm orders through the legal path.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (62 passing) against a database rebuilt from an empty state.

### 2026-08-22 — Stock movements, ledger, and audit schemas completed

- Added `stock_movement_type`, `ledger_account`, `ledger_side`, and `journal_type` enums plus three schema files: `stock-movements.ts` (append-only columns via shared `createdAtOnly`, product/order references, nonzero-delta and nonnegative-result checks, order-reference type check), `ledger.ts` (journal grouping with per-journal account uniqueness, positive amounts, normal-side accounting rules for sale/reversal journals), and `audit.ts` (polymorphic entity reference, structured metadata JSONB defaulting to empty, correlation IDs, four query indexes).
- Generated migrations `0006_stock-movements.sql` and `0007_ledger-audit.sql` (drizzle-kit captured both remaining tables in one migration; file renamed and journal updated accordingly); the full chain re-applies cleanly from an empty database.
- Added nine integration tests: sale/opening/adjustment order-reference rules, zero-delta and negative-result rejections, balanced normal-side postings including reversal mirroring, amount/journal-uniqueness rules, structured audit metadata with anonymous actors, actor SET NULL on identity deletion, and audit query index presence.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (54 passing), production build.

### 2026-08-22 — Invoices schema completed

- Added `invoice_status` to the shared enums module and `src/db/schema/invoices.ts` with the `invoice_number_seq` sequence (start 1000), INV-number default, one-invoice-per-order uniqueness, positive/matching amount checks, USD-only check, typed seller/bill-to JSONB snapshots with required-key shape checks, status+issued-at index, and RESTRICT references.
- Generated and reviewed migration `0005_invoices.sql`; applied it to the disposable database.
- Added five integration tests: sequential INV numbering, per-order invoice uniqueness, zero and mismatched amount rejections, snapshot shape enforcement (missing required key), optional snapshot fields plus issued-status defaults.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (44 passing).

### 2026-08-22 — Orders schema completed

- Added `src/db/schema/orders.ts` with the `order_number_seq` sequence (start 1000), `orders` (SO-number default via `nextval`, status/version/currency/total checks, lifecycle actor/timestamp columns, status+created-at and customer/creator indexes) and `order_line_items` (SKU/name snapshots, per-order product uniqueness, quantity/price/total-matches checks, cascade-on-order-delete).
- Worked around a drizzle-kit BigInt snapshot bug by declaring `total_cents` default as raw SQL (`sql\`0\``); added a shared `enums.ts`for`order_status`.
- Generated and reviewed migration `0004_orders.sql`; applied it to the disposable database.
- Added six integration tests: sequential SO numbering, draft defaults (version 1, USD, zero total), version/total/currency check rejections, one-product-per-order uniqueness, quantity/line-total constraint rejections, and line-item cascade plus referenced-product restriction ordering.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (39 passing).

### 2026-08-22 — Customers schema completed

- Added `src/db/schema/customers.ts` with normalized email uniqueness, name/active indexes, required postal address fields, optional contact/company/notes fields, and RESTRICT actor references.
- Generated and reviewed migration `0003_customers.sql`; applied it to the disposable database.
- Added five integration tests covering case-insensitive email conflicts, required address columns (not-null violation), user-delete restriction through customer references, optional-field defaults, and index presence.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (33 passing).

### 2026-08-22 — Categories/products schema completed

- Added `src/db/schema/inventory.ts` with `categories` (case-normalized name uniqueness, slug uniqueness, active index) and `products` (upper-normalized SKU uniqueness, positive price, non-negative stock/reorder checks, category/actor foreign keys with RESTRICT, and the partial low-stock index on active products).
- Generated and reviewed migration `0002_inventory.sql`; applied it to the disposable database.
- Added seven integration tests covering case-insensitive name/SKU conflicts, slug uniqueness, price/stock/reorder check rejections, referenced-category delete restriction, column defaults, and the partial low-stock index definition.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (28 passing).

### 2026-08-22 — Auth identity synchronization trigger completed

- Added custom migration `0001_auth_identity_sync.sql` with a hardened `SECURITY DEFINER` trigger function (`search_path=""`, fully qualified objects, EXECUTE revoked from PUBLIC/anon/authenticated) that mirrors `auth.users` inserts into `public.users`, synchronizes trimmed email and whitespace-normalized display names (metadata precedence `display_name` → `full_name` → `name`, 120-char cap, email-prefix fallback) on relevant updates, rejects blank emails, and never assigns a role.
- Added ten integration tests: identity mirroring, zero default roles, non-string metadata fallback, oversize capping, blank-email rejection (23514), duplicate-email rejection across identities (23505), email and display-name synchronization, provisioning by a restricted invoker with no `public.users` privileges, and definer/search-path/EXECUTE-hardening introspection.
- Discovered and documented that postgres.js double-encodes manually stringified JSON parameters; the suite uses `sql.json()` bindings instead.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), integration tests (21 passing).

### 2026-08-22 — Identity schema and migration completed

- Added `src/db/schema/auth.ts` (read-only `auth.users` declaration), `src/db/schema/users.ts` (`role_key` enum, `roles`, `users`, `user_roles` with case-normalized email uniqueness, active flag index, composite role PK, and cascade/restrict/set-null referential actions), and `src/db/schema/shared.ts` timestamp helpers.
- Generated migration `0000_identity.sql`; hand-reviewed and removed the generated `CREATE SCHEMA auth`/`CREATE TABLE auth.users` statements so migrations manage only the public schema while the external foreign key remains; verified a subsequent generate produces no schema diff.
- Added the disposable-database bootstrap (`src/db/test/bootstrap.sql` + `db:test:bootstrap` script) that mimics the Supabase auth subset on vanilla Postgres, plus `src/db/test/setup-db.ts` which applies bootstrap + all committed migrations idempotently for integration suites.
- Added nine integration tests asserting enum values, unique/not-null constraints, FK delete rules (RESTRICT to auth identity, CASCADE/RESTRICT on user_roles, SET NULL assigner), case-normalized email uniqueness, and composite key ordering against the live disposable database.

### 2026-08-22 — Drizzle Kit and disposable integration database completed

- Added `drizzle-kit` 0.31.10 with a root `drizzle.config.ts`: PostgreSQL dialect, schema under `src/db/schema`, migrations output to `src/db/migrations`, `schemaFilter: ["public"]` so only the public schema is managed, strict/verbose generation.
- Added `db:generate` and `db:migrate` package scripts.
- Added a disposable integration-test database via `docker-compose.yml` (Postgres 17 alpine on localhost:54329, tmpfs data directory) with `db:test:start`/`db:test:stop` scripts and health-gated startup.
- The Vitest integration config now defaults `INTEGRATION_DATABASE_URL` to the compose database, so `pnpm test:integration` runs with no manual environment setup; the CI Quality job gained an equivalent Postgres service container and passes the URL to the integration step.
- Approved the previously placeholder `esbuild` build script in `pnpm-workspace.yaml` required by drizzle-kit.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), and the Drizzle connection smoke suite against the disposable database (start → test → stop verified).

### 2026-08-22 — Server-only Drizzle client completed

- Added `drizzle-orm` 0.45.2 with the `postgres` 3.4.9 driver.
- Added a lazy, server-only `getDb()` singleton under `src/db/index.ts` that reads `DATABASE_URL` through the validated server environment module and disables prepared statements (`prepare: false`) for the Supabase transaction-mode pooler.
- Documented restricted runtime credential expectations in `.env.example` (least-privilege role via pooler port 6543; never migration/secret credentials).
- Added unit tests for driver options, `prepare: false`, instance caching, and test-cache reset; added a connection smoke integration suite covering `SELECT 1` and in-transaction execution that skips when no database URL is configured.
- Started a disposable Postgres 17 Docker container on localhost:54329 for integration verification; smoke tests passed against it (2/2).
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (25 passing), and integration smoke tests against the disposable database.

### 2026-08-22 — Supabase clients and cookie adaptation tests completed

- Verified browser, server, Proxy, and admin Supabase clients against the installed `@supabase/ssr` 0.12.4 cookie adapter types (`getAll`/`setAll` with cache-prevention headers) and the Next.js 16 `proxy.ts` file convention.
- Extracted the Proxy Supabase client into a testable `createProxyClient(request)` factory under `src/lib/supabase/proxy.ts`; `src/proxy.ts` now only refreshes claims and returns the latest response.
- Added unit tests proving cookie adaptation for all four clients: server reads via `next/headers` and swallows RSC write failures; Proxy propagates refreshed cookies to request and response plus required no-cache headers; admin client uses the secret key without session persistence.
- Checks passed: Prettier, ESLint (zero warnings), strict typecheck, unit tests (21 passing), production build with Proxy detected.

### 2026-07-22 — Environment validation modules completed

- Added Zod schemas for public Supabase values, server credentials, and required seller identity fields with optional address/region normalization.
- Adopted current Supabase API key env names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and server-only `SUPABASE_SECRET_KEY`.
- Added browser-safe `getPublicEnv`, server-only `getServerEnv`/`getSellerIdentity`, and invoice-shaped seller snapshot mapping.
- Added `.env.example` with placeholders only and allowed that file through `.gitignore` while still ignoring real env files.
- Added unit coverage for valid/invalid boundaries, caching, and incomplete-server failures; stubbed `server-only` for Vitest.
- Checks passed: Prettier, ESLint, strict typecheck, unit tests, Playwright smoke tests, production build, and IDE diagnostics.

### 2026-07-22 — CI workflow completed

- Added a GitHub Actions pull-request and `main` workflow with Quality and Playwright jobs.
- Quality runs frozen install, format check, lint, typecheck, unit/component tests, integration tests, and production build.
- Playwright installs Chromium with OS dependencies, runs the browser suite under `CI`, and uploads failure artifacts.
- Added `test:integration` with a Node Vitest config that passes with no suites until database integration tests exist, and excluded those suites from the unit runner.
- Disabled Husky in CI and pinned Node from `.nvmrc` with pnpm caching.
- Checks passed: Prettier, ESLint, strict typecheck, unit tests, empty integration suite, Playwright smoke tests, production build, and IDE diagnostics.

### 2026-07-22 — Pre-commit quality checks completed

- Added Husky initialization through the package-manager `prepare` lifecycle.
- Added a tracked pre-commit hook that runs lint-staged without invoking full unit, database, build, or browser suites.
- Configured ESLint auto-fixes followed by Prettier for staged JavaScript/TypeScript files and Prettier for supported data, style, and documentation files.
- Verified Husky installation, Git hook routing, lint-staged configuration loading, and the installed pre-commit entrypoint.
- Checks passed: Prettier, ESLint, strict typecheck, unit tests, production build, and IDE diagnostics.

### 2026-07-22 — Playwright test foundation completed

- Added Playwright with desktop Chromium and Pixel 7 mobile Chromium projects.
- Configured Playwright-owned local Next.js server lifecycle and external preview/deployment targeting through a validated environment contract.
- Added CI-safe retries, single-worker execution, focused-test protection, trace-on-first-retry, and failure screenshots/videos.
- Added package scripts, ignored generated artifacts, documented test-only variables, and added a passing application-shell browser smoke test.
- Checks passed: two Playwright project tests, Prettier, ESLint, strict typecheck, unit tests, production build, and IDE diagnostics.

### 2026-07-22 — Unit and component test foundation completed

- Added Vitest 4 with the V8 coverage provider, React Testing Library, jest-dom matchers, user-event, and jsdom.
- Configured the `@/*` alias, React transformation, deterministic mock cleanup, and shared DOM test setup.
- Added the documented coverage floor for future `src/features/**` code: 80% lines/functions and 75% branches.
- Added `test`, `test:watch`, and `test:coverage` scripts plus a passing accessible-interaction smoke test.
- Checks passed: Vitest, coverage execution, ESLint, strict typecheck, production build, and IDE diagnostics.

### 2026-07-22 — Code quality tooling completed

- Added type-aware strict and stylistic TypeScript ESLint rules on top of the Next.js Core Web Vitals configuration.
- Enforced deterministic import groups, type-only imports, duplicate prevention, and zero-warning lint runs.
- Added Prettier with Tailwind CSS class sorting, repository-wide formatting scripts, and a clean formatting baseline.
- Added explicit `format`, `format:check`, `lint`, `lint:fix`, and `typecheck` package scripts.
- Checks passed: Prettier, ESLint, strict typecheck, production build, and IDE diagnostics.

### 2026-07-22 — shadcn/ui foundation completed

- Initialized the current shadcn/ui `base-nova` preset for Tailwind CSS 4, React 19, RSC, Base UI, and Lucide icons.
- Added owned primitives for buttons, cards, fields, alerts, avatar, breadcrumbs, dropdowns, separators, sheets, skeletons, and tooltips.
- Added accessible light/dark OKLCH tokens for application, sidebar, charts, and success/warning/info states.
- Corrected Geist typography tokens, added root tooltip context, and replaced generated metadata with NextERP metadata.
- Checks passed: ESLint, `tsc --noEmit`, production build, and IDE diagnostics.

### 2026-07-22 — Next.js 16 scaffold completed

- Created the Next.js 16.2.11 App Router project with React 19.2.4, Tailwind CSS 4, ESLint 9, TypeScript 5.9, and `src/` layout.
- Enabled Cache Components and strict TypeScript options.
- Pinned Node.js 24 and pnpm 11.15.1; generated a compatible lockfile and approved only required dependency build scripts.
- Verified the `@/*` import alias and Turbopack production build.
- Checks passed: ESLint, `tsc --noEmit`, production build, and IDE diagnostics. Test tooling is scheduled later in Phase 1, so no test script exists yet.

### 2026-07-22 — Phase 0 specification completed

- Produced the seven required specification documents.
- Standardized the platform on Next.js 16.x, React 19.2+, App Router, `proxy.ts`, and Cache Components.
- Added compact project rules under `.cursor/rules/`.
- Verified documentation consistency and found no linter diagnostics.
- Approval gate remains open; no application code has been written.

## Verification history

- 2026-08-24: categories suites green: 237 unit, 132 integration; lint, strict typecheck, format pass.
- 2026-08-24 PHASE 1 GATE: clean-DB migrations x3 stable, 225 unit + 121 integration + 8 live e2e passing, lint/typecheck/format clean, Partial-Prerender build ok, client-bundle secret scan CLEAN.
- 2026-08-24: cache helper suites green: 225 unit, 121 integration; lint, strict typecheck, format pass.
- 2026-08-24: combobox suites green: 216 unit; lint, strict typecheck, format pass.
- 2026-08-24: form-control suites green: 210 unit, 121 integration; lint, strict typecheck, format, build pass.
- 2026-08-24: display component suites green: 200 unit, 121 integration; lint, strict typecheck, format pass.
- 2026-08-24: data-table suites green: 189 unit, 121 integration; lint, strict typecheck, format pass.
- 2026-08-24: list-query suites green: 181 unit, 121 integration; lint, strict typecheck, format pass.
- 2026-08-24: Admin Users grid suites green: 163 unit, 121 integration; lint, strict typecheck, format, build pass.
- 2026-08-24: setUserActive suites green: 156 unit, 121 integration; lint, strict typecheck, format pass.
- 2026-08-24: setUserRoles suites green: 156 unit, 111 integration; lint, strict typecheck, format pass.
- 2026-08-24: Users feature suites green: 152 unit, 103 integration; lint, strict typecheck, format, and Partial-Prerender build all pass.
- 2026-08-22: Live Playwright run against the configured Supabase project: 8 passed, 8 skipped (no seeded admin); format, lint, strict typecheck, 146 unit and 92 integration tests green.
- 2026-08-22: Login form component suite passed (146 unit, 92 integration total) with format, lint, strict typecheck, and Partial-Prerender build green.
- 2026-08-22: Sign-in integration suite passed against the disposable database (92 integration, 139 unit total) with format, lint, strict typecheck, and production build green.
- 2026-08-22: Shell and error-UI component suites passed (134 unit tests total) with format, lint, strict typecheck, and Partial-Prerender production build green.
- 2026-08-22: Protected-shell task verified with navigation matrix tests, live redirect checks on `next start`, Partial-Prerender build, 125 unit + 84 integration tests, lint and strict typecheck green.
- 2026-08-22: Proxy protection suites passed (114 unit tests total) with format, lint, strict typecheck, and production build green.
- 2026-08-22: Permission-matrix and guard suites passed (102 unit, 84 integration total) with format, lint, and strict typecheck green.
- 2026-08-22: Current-user integration tests passed with mocked Auth boundary and real database (84 integration, 85 unit total), alongside format, lint, and strict typecheck.
- 2026-08-22: Action-result, error-mapping, and money unit suites passed (83 unit tests total) with format, lint, strict typecheck, and production build green.
- 2026-08-22: Security headers and correlation ID confirmed on a live `next start` response; redirect/logger/header unit suites passed (54 total) with format, lint, strict typecheck, and production build green.
- 2026-08-22: Seed CLI verified twice against the disposable database and seed integration tests passed (78 total), with format, lint, strict typecheck, 28 unit tests, and production build green.
- 2026-08-22: Factory integration tests passed (74 total), with format, lint, strict typecheck, and 28 unit tests green.
- 2026-08-22: Relations/barrel task verified with barrel unit tests (28 total), no-op regeneration diff check, full 68-test integration suite, format, lint, and strict typecheck.
- 2026-08-22: RLS migration applied from an empty database and all six hardening integration tests passed; full 68-test integration suite, format, lint, strict typecheck, and 25 unit tests green.
- 2026-08-22: Lifecycle migration applied from an empty database and all eight lifecycle-control integration tests passed; full 62-test integration suite, format, lint, strict typecheck, and 25 unit tests green.
- 2026-08-22: Stock-movement, ledger, and audit migrations applied from an empty database and all nine of their integration tests passed; format, lint, strict typecheck, 25 unit tests, the 54-test integration suite, and production build green.
- 2026-08-22: Invoices schema migration applied and its five integration tests passed; format, lint, strict typecheck, 25 unit tests, and the 44-test integration suite green.
- 2026-08-22: Orders schema migration applied and its six integration tests passed; format, lint, strict typecheck, 25 unit tests, and the 39-test integration suite green.
- 2026-08-22: Customers schema migration applied and its five integration tests passed; format, lint, strict typecheck, 25 unit tests, and the 33-test integration suite green.
- 2026-08-22: Inventory schema migration applied and all seven inventory integration tests passed; format, lint, strict typecheck, 25 unit tests, and the full 28-test integration suite green.
- 2026-08-22: Auth identity-sync trigger migration applied cleanly and all ten trigger integration tests passed alongside format, lint, strict typecheck, 25 unit tests, and the earlier schema suites (21 integration total).
- 2026-08-22: Identity schema migration applied to the disposable database and all nine constraint/integration tests passed; format, lint, strict typecheck, and 25 unit tests green; regeneration produced no diff after the auth-statement removal.
- 2026-08-22: Drizzle Kit config validated and the full integration cycle (compose start, smoke tests, compose stop) passed; format, lint, strict typecheck, and 25 unit tests green.
- 2026-08-22: Drizzle client unit tests passed and connection smoke tests passed against a disposable Postgres 17 container, alongside format, lint, strict typecheck, and the full unit suite.
- 2026-08-22: Supabase client cookie-adaptation tests passed with format, lint, strict typecheck, full unit suite, and production build.
- 2026-07-22: Environment schema/accessor unit tests passed with format, lint, typecheck, build, and Playwright.
- 2026-07-22: Local CI gate passed for format, lint, typecheck, unit, integration (empty), build, and Playwright.
- 2026-07-22: Husky prepare lifecycle and pre-commit entrypoint passed; lint-staged loaded successfully with no staged files.
- 2026-07-22: Desktop and mobile Chromium Playwright smoke tests passed with managed Next.js startup and shutdown.
- 2026-07-22: Vitest smoke test and coverage execution passed alongside lint, strict typecheck, and production build.
- 2026-07-22: Code quality formatting, strict lint, strict typecheck, and production build passed.
- 2026-07-22: shadcn/ui foundation lint, strict typecheck, and production build passed.
- 2026-07-22: Scaffold lint, strict typecheck, and Next.js production build passed.
- 2026-07-22: Phase 0 documentation and Cursor rules checked; no linter diagnostics.

## Approved deviations

- 2026-07-22: Supabase public/server credentials use the current publishable/secret API key names (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) instead of legacy `anon` / `service_role` env names.
