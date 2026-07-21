# NextERP UI Specification

## Experience principles

- The interface is an enterprise desktop-first application that remains usable on tablet and mobile.
- Information density is deliberate: compact tables, clear hierarchy, persistent filters in the URL, and visible workflow state.
- Server-rendered content is the default. Client islands own interaction, never privileged data access.
- Every action has an explicit pending state; destructive or consequential actions require confirmation.
- Color is not the only status signal. Badges include text and icons where useful.
- Forms are keyboard accessible, use persistent labels, associate errors with fields, and focus the first invalid input.
- Dates display in the browser locale with a tooltip containing the exact UTC timestamp. Currency displays as USD while remaining integer cents in data.
- Archived records remain distinguishable and are excluded from default selectors.

## Application shell

Route group: `/(dashboard)`.

Server responsibilities:

- Verify the current Supabase identity and application roles.
- Construct role-aware navigation.
- Render breadcrumbs and page content.

Client responsibilities:

- Responsive sidebar open/close state.
- User menu and logout interaction.
- Toast region for action outcomes.
- Theme state only if dark mode is included during visual implementation.

Navigation by role:

- All: Dashboard.
- Admin: Inventory, Customers, Sales Orders, Invoices, Ledger, Users, Audit Log.
- Sales: Customers, Sales Orders, Invoices.
- Inventory: Inventory, Sales Orders (operational queue only).

The shell includes a skip link, semantic landmarks, active navigation state, user name/roles, and a mobile sheet. Unauthorized links are hidden for usability, while server guards remain authoritative.

## Standard page states

Unless a page states otherwise:

- Loading: route-level or local skeleton matching the final layout; no generic full-page spinner.
- Empty: explanation, cleared-filter option when filtered, and a role-appropriate primary action.
- Error: local error boundary with concise message, correlation ID when present, and retry. Permission failures render 403 content; inaccessible records use 404 where revealing existence is undesirable.
- Pending mutation: initiating control is disabled, label changes to the active verb, and unrelated navigation remains available when safe.
- Success: toast plus navigation or in-place refresh. Focus moves to the page heading or meaningful updated region.
- Conflict: preserve form values, explain that data changed, and offer reload/review rather than silently overwriting.

## Page specifications

### `/login`

Purpose: Authenticate demo users and establish the Supabase cookie session.

Key components:

- Centered `Card`.
- `LoginForm` with email, password, show-password toggle, and submit button.
- Optional non-secret demo account labels supplied by deployment configuration.

Boundary:

- Server page redirects already-authenticated users.
- Client `LoginForm` uses React Hook Form, shared `signInSchema`, and `signIn`.

States:

- Loading/pending: button shows “Signing in…” and fields are disabled.
- Empty: not applicable.
- Error: generic invalid-credentials message; inactive/unprovisioned account message; unexpected error with correlation ID.

### `/dashboard`

Purpose: Role-aware operational overview and the main demo landing page.

Key components:

- Date-range selector using URL parameters (`30d`, `90d`, `12m`).
- `RevenueChartWidget` for Admin/Sales.
- `TopProductsWidget` for Admin/Sales; Inventory sees units sold without revenue.
- `LowStockWidget` for Admin/Inventory.
- `RecentOrdersWidget` for all roles, with Inventory limited to operational fields.

Boundary:

- Server page and each async widget query.
- Each widget has its own Suspense and error boundary.
- Client `DashboardRangeSelect` updates URL state.
- Client Recharts renderers receive serialized series from server widget wrappers.

Defaults and metrics:

- Default range is `30d`.
- Revenue uses daily buckets for 30/90 days and monthly buckets for 12 months, based on net Sales Revenue ledger postings.
- Top products shows at most five products by positive net units sold in the period.
- Low stock and recent orders show at most five rows.
- Recent-order cache/query projections are separate for sales and operations roles.

States:

- Loading: independent card skeletons; shell and completed widgets remain interactive.
- Empty: widget-specific “No sales in this period,” “No low-stock products,” or “No orders yet.”
- Error: one widget displays retry without affecting siblings.

### `/inventory/products`

Purpose: Search and administer product master data and current stock.

Key components:

- `PageHeader`, “New product” button for Admin/Inventory.
- `ProductDataTable` columns: SKU, name, category, unit price, stock, reorder level, status, row actions.
- URL-backed search, category/status/low-stock filters, sort, page, page size, and column visibility.
- Low-stock cells use icon + text treatment.

Boundary:

- Server page validates parameters, authorizes, and retrieves one page.
- Client DataTable controls and row-action menu.

States:

- Empty default: “No products yet” with create action.
- Empty filtered: “No products match these filters” with reset.
- Error/loading: standard table skeleton and route error.

### `/inventory/products/new`

Purpose: Create product master data and optional opening stock.

Key components: `ProductForm`, category `Combobox`, currency input, quantity inputs, `Card`, cancel link.

Boundary:

- Server page loads active category options.
- Client form uses `createProductSchema`; invokes `createProduct`.

States:

- Empty: if no active categories exist, show prerequisite message and link to Categories instead of the form.
- Pending/success/validation/unique-SKU errors follow form standards.

### `/inventory/products/[productId]`

Purpose: Inspect product details, current balance, and movement history.

Key components:

- Product summary cards.
- `StatusBadge`, low-stock indicator.
- Admin/Inventory actions: Edit, Adjust stock, Archive/Restore.
- `StockAdjustmentDialog`.
- Paginated `StockMovementDataTable` with type, delta, resulting stock, reference/order, reason, actor, timestamp.

Boundary:

- Server page loads product and first movement page.
- Client dialogs, table controls, and confirmation controls.

States:

- Missing/inaccessible: 404.
- No movements: “No stock movements recorded.”
- Adjustment insufficient stock: dialog stays open and shows current available stock.

### `/inventory/products/[productId]/edit`

Purpose: Edit product master data without directly changing stock.

Key components: `ProductForm` in edit mode; stock field shown read-only with link to Adjust stock.

Boundary:

- Server page loads product and active categories.
- Client form uses `updateProductSchema`; invokes `updateProduct`.

States: archived product is editable but restore rules are explained; standard conflict and validation states.

### `/inventory/categories`

Purpose: Maintain category master data.

Key components:

- `CategoryDataTable` with name, slug, product count, status, actions.
- `CategoryFormDialog` for create/edit.
- `ConfirmActionDialog` for archive/restore.

Boundary:

- Server page provides paginated categories.
- Client table controls and dialogs invoke category actions.

States:

- Empty: create-first-category prompt.
- Archive conflict: names the active product count and links to the filtered product list.

### `/inventory/stock-movements`

Purpose: Cross-product inventory audit trail.

Key components:

- `StockMovementDataTable`.
- URL filters for product, movement type, actor, date range, and order number.
- Links to product/order details.

Boundary:

- Server query and pagination.
- Client filters/table interaction.

States: read-only empty/filter/error/loading states. There is no edit/delete affordance.

### `/customers`

Purpose: Search and maintain CRM-lite customer records.

Key components:

- “New customer” action.
- `CustomerDataTable` columns: name, company, email, phone, order count, lifetime net sales, status.
- URL search/status filters and table controls.

Boundary: server page/query; client DataTable controls and archive confirmation.

States: standard empty and filtered-empty states.

### `/customers/new`

Purpose: Create a customer.

Key components: `CustomerForm` grouped into identity, contact, address, and notes sections.

Boundary: server page; client React Hook Form using `createCustomerSchema`.

States: field errors, duplicate-email error attached to email, pending and success navigation.

### `/customers/[customerId]`

Purpose: Customer summary and order history.

Key components:

- Contact/address summary.
- Active/archived badge and Edit/Archive/Restore actions.
- KPI cards: current confirmed/fulfilled order count and lifetime net sales; cancelled orders are excluded.
- `OrderDataTable` filtered to the customer.

Boundary: server detail and order-history query; client table/action controls.

States: 404, no-order history prompt with “Create order” for active customers, standard loading/error.

### `/customers/[customerId]/edit`

Purpose: Edit customer contact data.

Key components: `CustomerForm` in edit mode.

Boundary: server entity load; client form using `updateCustomerSchema`.

States: duplicate email, stale/conflict, archived notice, standard form states.

### `/sales/orders`

Purpose: Sales list for Admin/Sales and fulfillment queue for Inventory.

Key components:

- Admin/Sales “New order” action.
- `OrderDataTable` columns: number, customer, status, total (hidden from Inventory), line count, created/confirmed date, creator, actions.
- Filters for status, customer, date range, creator; Inventory defaults to confirmed orders.
- Role-aware row actions: edit/confirm/cancel for Admin/Sales, fulfill for Admin/Inventory.

Boundary: server query with role-specific projection; client table controls and confirm dialogs.

States: standard list states. Inventory empty copy reads “No orders awaiting fulfillment” when filtered to confirmed.

### `/sales/orders/new`

Purpose: Create, review, save, and optionally confirm a multi-line order.

Key components:

- `OrderWizard`.
- Step 1 `CustomerStep`: searchable active-customer combobox and contact preview.
- Step 2 `LineItemsStep`: searchable product picker, availability, editable quantities, remove action, line and order totals.
- Step 3 `ReviewStep`: immutable summary, notes, validation warnings.
- Step 4 `ConfirmationStep`: result with links to order and invoice.
- Save Draft and Confirm Order actions. Confirm first creates the draft, then calls confirm with the returned ID/version; if confirmation fails, the valid draft remains available for correction.

Boundary:

- Server page loads only initial selector data needed for the MVP-sized demo dataset; searchable selectors can submit URL-backed server queries if the dataset grows.
- Client wizard owns transient steps and line selections in a per-instance Zustand store.
- React Hook Form owns each step's field state; shared schemas validate.
- Server actions re-read customer/product price and availability.

States:

- Empty product/customer prerequisites explain what must be created.
- Step validation prevents advancement and focuses the first error.
- Insufficient stock returns the user to line items and marks affected rows.
- Server-captured draft prices are shown as the order commitment; confirmation never silently reprices a saved draft. Editing the draft refreshes snapshots from current product data.
- Pending confirmation locks wizard navigation to prevent duplicate submission.

### `/sales/orders/[orderId]/edit`

Purpose: Edit an existing draft through the same wizard.

Boundary and components: same as new order, preloaded by a Server Component; client store receives a serialized initial draft and version.

States:

- Non-draft order: show status and link to detail; no editable form.
- Version conflict: preserve local state and offer “Reload latest draft.”
- Other states match the new-order wizard.

### `/sales/orders/[orderId]`

Purpose: Canonical order detail and lifecycle actions.

Key components:

- Header with number, `StatusBadge`, customer link, dates, actor names.
- Line item table using snapshots.
- Admin/Sales see unit prices, line totals, order total, and notes. Inventory sees product SKU/name, quantity, operational notes, and fulfillment data but no monetary fields.
- Timeline for draft/confirm/fulfill/cancel events.
- Admin/Sales actions: Edit draft, Confirm, Cancel.
- Admin/Inventory action: Fulfill confirmed.
- Admin/Sales invoice card/link after confirmation.

Boundary:

- Server order aggregate with role-specific fields.
- Client confirmation dialogs and action buttons receive ID/version only.

States:

- 404 for missing/inaccessible.
- Action conflicts refresh the displayed version/status after warning.
- Cancel dialog requires a reason.
- Consequential confirm/cancel/fulfill dialogs state the side effects.

### `/accounting/invoices`

Purpose: Admin/Sales invoice register.

Key components:

- `InvoiceDataTable`: number, order, customer, status, total, issued date, download.
- Status/customer/date filters.

Boundary: server query; client table controls and download link.

States: standard list states. Void rows remain visible and visually marked.

### `/accounting/invoices/[invoiceId]`

Purpose: HTML invoice view and PDF entry point.

Key components:

- Invoice header/status.
- Snapshotted seller/customer bill-to blocks, so later profile/configuration edits do not rewrite historical invoices.
- Snapshot line table and totals.
- Order link and Download PDF button.
- Large, non-color-only VOID treatment when applicable.

Boundary: entirely server-rendered except a small download pending indicator if needed. The download targets the authenticated PDF route handler.

States: 404, PDF failure toast/error response, standard loading/error.

### `/accounting/ledger`

Purpose: Admin-only, read-only proof of balanced cross-module accounting.

Key components:

- `LedgerDataTable` grouped visually by journal ID.
- Columns: posted date, journal/reference, type, order, invoice, account, debit, credit, actor.
- Filters for date, journal type, account, order/invoice number.
- Per-journal balance indicator; data invariant should always show zero difference.

Boundary: server authorization/query; client filters/table display.

States: empty ledger explanation; no mutation controls; invariant mismatch renders a prominent diagnostic error and is logged.

### `/admin/users`

Purpose: Admin assigns application roles and enables/disables provisioned users.

Key components:

- `UserDataTable`: name, email, roles, status, last sign-in.
- `RoleAssignmentDialog` with checkboxes.
- `ConfirmActionDialog` for enable/disable.

Boundary: server user query; client dialogs invoke user actions.

States:

- Last-Admin error explains why the operation is blocked.
- Current user is labelled.
- Empty state explains that identities are provisioned in Supabase.

### `/admin/audit-log`

Purpose: Admin-only append-only business/security activity history.

Key components:

- `AuditDataTable`: timestamp, actor, action, entity type, entity link/ID, summary, correlation ID.
- Filters for actor, action, entity type, date range.
- `AuditDetailsSheet` renders sanitized structured before/after metadata.

Boundary: server query/pagination; client table controls and details sheet.

States: empty/filter/loading/error states; no mutation affordances.

## Shared component inventory

### Data display

- `DataTable<TData, TValue>`: TanStack Table wrapper with controlled sorting, filters, visibility, pagination, accessible headers, responsive overflow, and URL adapters.
- `DataTableToolbar`: search, faceted filters, reset, column visibility.
- `DataTablePagination`: page and page-size controls with result count.
- `DataTableSkeleton`: column-aware skeleton.
- `EmptyState`: icon, title, description, optional action.
- `StatusBadge`: exhaustive typed mapping for order, invoice, active/archive, and stock states.
- `Money`: formats serialized cents with `Intl.NumberFormat`.
- `LocalDateTime`: locale display plus exact UTC tooltip.
- `PageHeader`, `Breadcrumbs`, `DetailField`, `KpiCard`.

### Forms and actions

- `FormFieldError` and `FormErrorSummary`.
- `CurrencyInput`, `QuantityInput`, `SearchCombobox`.
- `SubmitButton` driven by form/action pending state.
- `ConfirmActionDialog` for archive, restore, confirm, fulfill, and disable.
- `ActionErrorAlert` maps typed action errors to accessible copy.
- `StockAdjustmentDialog`.
- `ProductForm`, `CategoryForm`, `CustomerForm`.

### Order workflow

- `OrderWizard` and `WizardProgress`.
- `CustomerStep`, `LineItemsStep`, `ReviewStep`, `ConfirmationStep`.
- `ProductPicker`, `OrderLineEditor`, `OrderTotals`.
- `OrderStatusTimeline`.

### Dashboard and accounting

- `WidgetCard`, `WidgetSkeleton`, `WidgetError`.
- `RevenueChart`, `TopProductsChart`, `LowStockList`, `RecentOrdersList`.
- `InvoiceDocument` shared conceptually by HTML and react-pdf renderers through a common view model.
- `JournalBalanceIndicator`.

## Responsive behavior

- At desktop widths, the sidebar is persistent and forms use two-column groups where scanning improves.
- At tablet/mobile widths, the sidebar becomes a sheet, forms stack, and wizard controls remain reachable without horizontal page scrolling.
- Data tables intentionally use contained horizontal scrolling rather than hiding business columns unpredictably. Critical identity/status columns can be pinned if TanStack Table support is added without compromising accessibility.
- Charts provide text summaries and accessible labels because visual plots alone are insufficient.

## Accessibility acceptance

- All pages have one descriptive `h1`.
- Dialogs trap focus, return focus to their trigger, and support Escape unless a commit is actively pending.
- Table sort buttons expose direction; pagination has accessible names.
- Wizard step and validation status is announced through an `aria-live` region.
- Toasts supplement, not replace, persistent field/page errors.
- Destructive actions are not represented by icon-only controls without accessible names.
- Automated axe checks cover login, product list/form, customer form, order wizard, invoice, and dashboard; critical flows receive keyboard smoke tests.

