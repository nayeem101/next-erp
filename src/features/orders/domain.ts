import type { RoleKey } from "@/lib/auth/roles";

/**
 * Pure order domain rules: exact-money snapshot building, totals, lifecycle
 * transitions, and role requirements.  No I/O lives here so the rules stay
 * exhaustively testable and reusable by services and UI alike.
 */

export type OrderStatus = "draft" | "confirmed" | "fulfilled" | "cancelled";

export type OrderAction =
  "createDraft" | "updateDraft" | "confirm" | "fulfill" | "cancel";

// ---------------------------------------------------------------------------
// Snapshot and totals
// ---------------------------------------------------------------------------

export interface LineSnapshotRequest {
  productId: string;
  quantity: number;
}

/** Current product master data the server reads at write time. */
export interface ProductMasterData {
  productId: string;
  sku: string;
  name: string;
  unitPriceCents: bigint;
}

export interface OrderLineSnapshot {
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitPriceCents: bigint;
  /** quantity * unitPriceCents in exact bigint arithmetic. */
  lineTotalCents: bigint;
}

export class MissingProductError extends Error {
  constructor(productId: string) {
    super(`Missing product master data for ${productId}`);
    this.name = "MissingProductError";
  }
}

/**
 * Builds immutable line snapshots from current master data in request order.
 * Quantities are trusted to be validated positive integers upstream.
 */
export function buildLineSnapshots(
  lines: readonly LineSnapshotRequest[],
  masterByProductId: ReadonlyMap<string, ProductMasterData>,
): OrderLineSnapshot[] {
  return lines.map((line) => {
    const master = masterByProductId.get(line.productId);

    if (master === undefined) {
      throw new MissingProductError(line.productId);
    }

    return {
      productId: master.productId,
      productSku: master.sku,
      productName: master.name,
      quantity: line.quantity,
      unitPriceCents: master.unitPriceCents,
      lineTotalCents: BigInt(line.quantity) * master.unitPriceCents,
    };
  });
}

/** Exact sum of snapshot line totals as bigint cents. */
export function computeOrderTotalCents(
  snapshots: readonly Pick<OrderLineSnapshot, "quantity" | "unitPriceCents">[],
): bigint {
  return snapshots.reduce<bigint>(
    (total, line) => total + BigInt(line.quantity) * line.unitPriceCents,
    0n,
  );
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/** Allowed status graph per PRD: terminal states have no exits. */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Cancellation side-effect class: drafts cancel cleanly with nothing to
 * undo; confirmed orders require restock plus invoice void and reversal
 * journal; terminal states cannot cancel at all.
 */
export type CancellationKind =
  "not-cancellable" | "clean-draft" | "reverse-sale";

export function cancellationKindFor(status: OrderStatus): CancellationKind {
  switch (status) {
    case "draft":
      return "clean-draft";
    case "confirmed":
      return "reverse-sale";
    case "fulfilled":
    case "cancelled":
      return "not-cancellable";
  }
}

// ---------------------------------------------------------------------------
// Role projection
// ---------------------------------------------------------------------------

/** Module matrix from ARCHITECTURE.md, narrowed per action. */
export const ORDER_ACTION_ROLES: Readonly<
  Record<OrderAction, readonly RoleKey[]>
> = {
  createDraft: ["admin", "sales"],
  updateDraft: ["admin", "sales"],
  confirm: ["admin", "sales"],
  fulfill: ["admin", "inventory"],
  cancel: ["admin", "sales"],
};

export function hasAnyRole(
  currentRoles: readonly RoleKey[],
  requiredRoles: readonly RoleKey[],
): boolean {
  return currentRoles.some((role) => requiredRoles.includes(role));
}

export function canPerformAction(
  action: OrderAction,
  currentRoles: readonly RoleKey[],
): boolean {
  return hasAnyRole(currentRoles, ORDER_ACTION_ROLES[action]);
}

/**
 * Financial visibility: Inventory may work orders but never sees money.
 * Admin and Sales see totals everywhere.
 */
export function canViewFinancials(currentRoles: readonly RoleKey[]): boolean {
  return hasAnyRole(currentRoles, ["admin", "sales"]);
}
