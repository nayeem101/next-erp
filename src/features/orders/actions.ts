"use server";

import { getActionContext } from "@/lib/auth/guards";
import { MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";
import { invalidateTags } from "@/lib/cache/invalidate";
import { CACHE_TAGS } from "@/lib/cache/tags";
import {
  actionSuccess,
  type ActionResult,
  validationFailure,
} from "@/lib/errors/action-result";
import { mapActionError } from "@/lib/errors/map-action-error";

import { createDraftOrderSchema, updateDraftOrderSchema } from "./schemas";
import { createDraftOrder, updateDraftOrder } from "./service";

import type {
  CreateDraftOrderArgs,
  CreateDraftOrderResult,
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

    invalidateTags(CACHE_TAGS.orders, CACHE_TAGS.auditLog);

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

    invalidateTags(CACHE_TAGS.orders, CACHE_TAGS.auditLog);

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
