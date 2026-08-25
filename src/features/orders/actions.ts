"use server";

import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";
import { invalidateTags } from "@/lib/cache/invalidate";
import { entityTag, CACHE_TAGS } from "@/lib/cache/tags";
import {
  actionSuccess,
  type ActionResult,
  validationFailure,
} from "@/lib/errors/action-result";
import { mapActionError } from "@/lib/errors/map-action-error";

import { confirmOrder } from "./confirm";
import { cancelOrder, fulfillOrder } from "./lifecycle";
import {
  cancelOrderSchema,
  createDraftOrderSchema,
  transitionOrderSchema,
  updateDraftOrderSchema,
} from "./schemas";
import { createDraftOrder, updateDraftOrder } from "./service";

import type { ConfirmOrderResult } from "./confirm";
import type {
  CancelOrderArgs,
  CancelOrderResult,
  CreateDraftOrderArgs,
  CreateDraftOrderResult,
  TransitionOrderArgs,
  TransitionOrderResult,
  UpdateDraftOrderArgs,
  UpdateDraftOrderResult,
} from "./schemas";

/** Admin/Sales draft creation with server-side snapshots. */
export async function createDraftOrderAction(
  input: CreateDraftOrderArgs,
): Promise<ActionResult<CreateDraftOrderResult>> {
  const parsed = createDraftOrderSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return context;
  }

  try {
    const result = await createDraftOrder(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.orders,
      CACHE_TAGS.dashboard.recentOrders,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Sales draft update with optimistic version concurrency. */
export async function updateDraftOrderAction(
  input: UpdateDraftOrderArgs,
): Promise<ActionResult<UpdateDraftOrderResult>> {
  const parsed = updateDraftOrderSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return context;
  }

  try {
    const result = await updateDraftOrder(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.orders,
      CACHE_TAGS.dashboard.recentOrders,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Sales confirmation: stock deduction, invoice, and journal. */
export async function confirmOrderAction(
  input: TransitionOrderArgs,
): Promise<ActionResult<ConfirmOrderResult>> {
  const parsed = transitionOrderSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return context;
  }

  try {
    const result = await confirmOrder(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    // Confirmation touches stock, invoice, ledger, customer snapshot, and
    // every dashboard aggregate, so invalidate the full documented set.
    invalidateTags(
      CACHE_TAGS.orders,
      entityTag(CACHE_TAGS.orders, result.orderId),
      entityTag(CACHE_TAGS.customers, result.customerId),
      CACHE_TAGS.products,
      CACHE_TAGS.invoices,
      CACHE_TAGS.ledger,
      CACHE_TAGS.dashboard.revenue,
      CACHE_TAGS.dashboard.topProducts,
      CACHE_TAGS.dashboard.lowStock,
      CACHE_TAGS.dashboard.recentOrders,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Inventory fulfillment of a confirmed order. */
export async function fulfillOrderAction(
  input: TransitionOrderArgs,
): Promise<ActionResult<TransitionOrderResult>> {
  const parsed = transitionOrderSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderFulfillment,
  );

  if (!context.ok) {
    return context;
  }

  try {
    const result = await fulfillOrder(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.orders,
      entityTag(CACHE_TAGS.orders, result.orderId),
      CACHE_TAGS.dashboard.recentOrders,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Sales cancellation with reversal side effects when confirmed. */
export async function cancelOrderAction(
  input: CancelOrderArgs,
): Promise<ActionResult<CancelOrderResult>> {
  const parsed = cancelOrderSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(
    MODULE_ROLE_REQUIREMENTS.orderAuthoring,
  );

  if (!context.ok) {
    return context;
  }

  try {
    const result = await cancelOrder(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    if (result.reversed) {
      // Cancelling a confirmed order matches confirmation's breadth.
      invalidateTags(
        CACHE_TAGS.orders,
        entityTag(CACHE_TAGS.orders, result.orderId),
        entityTag(CACHE_TAGS.customers, result.customerId),
        CACHE_TAGS.products,
        CACHE_TAGS.invoices,
        CACHE_TAGS.ledger,
        CACHE_TAGS.dashboard.revenue,
        CACHE_TAGS.dashboard.topProducts,
        CACHE_TAGS.dashboard.lowStock,
        CACHE_TAGS.dashboard.recentOrders,
        CACHE_TAGS.auditLog,
      );
    } else {
      invalidateTags(
        CACHE_TAGS.orders,
        entityTag(CACHE_TAGS.orders, result.orderId),
        entityTag(CACHE_TAGS.customers, result.customerId),
        CACHE_TAGS.dashboard.recentOrders,
        CACHE_TAGS.auditLog,
      );
    }

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
