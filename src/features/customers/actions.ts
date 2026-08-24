"use server";

import { z } from "zod";

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

import { listCustomers, listCustomerOrders } from "./queries";
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  listCustomerOrdersQuerySchema,
  setCustomerActiveSchema,
  updateCustomerSchema,
  type CreateCustomerArgs,
  type CreateCustomerResult,
  type CustomerListPage,
  type CustomerOrderPage,
  type ListCustomerOrdersQueryInput,
  type ListCustomersQueryInput,
  type SetCustomerActiveArgs,
  type SetCustomerActiveResult,
  type UpdateCustomerArgs,
  type UpdateCustomerResult,
} from "./schemas";
import { createCustomer, setCustomerActive, updateCustomer } from "./service";

/**
 * Paginated customer directory with order projections.
 *
 * Admin and Sales roles per the module access matrix; Inventory may read
 * customer identity only in the context of an order.
 */
export async function listCustomersAction(
  input: ListCustomersQueryInput,
): Promise<ActionResult<CustomerListPage>> {
  const parsed = listCustomersQuerySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.customers);

  if (!context.ok) {
    return context;
  }

  try {
    const page = await listCustomers(parsed.data);

    return actionSuccess(page);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Paginated order history for one customer. */
export async function listCustomerOrdersAction(
  customerId: string,
  input: ListCustomerOrdersQueryInput = {},
): Promise<ActionResult<CustomerOrderPage>> {
  const ids = z.object({ customerId: z.uuid() }).safeParse({ customerId });

  if (!ids.success) {
    return validationFailure(ids.error);
  }

  const parsed = listCustomerOrdersQuerySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.customers);

  if (!context.ok) {
    return context;
  }

  try {
    const page = await listCustomerOrders(customerId, parsed.data);

    return actionSuccess(page);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Sales customer creation. */
export async function createCustomerAction(
  input: CreateCustomerArgs,
): Promise<ActionResult<CreateCustomerResult>> {
  const parsed = createCustomerSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.customers);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await createCustomer(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(CACHE_TAGS.customers, CACHE_TAGS.auditLog);

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Sales customer update with changed-field audit metadata. */
export async function updateCustomerAction(
  input: UpdateCustomerArgs,
): Promise<ActionResult<UpdateCustomerResult>> {
  const parsed = updateCustomerSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.customers);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await updateCustomer(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(CACHE_TAGS.customers, CACHE_TAGS.auditLog);

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Sales customer active-state toggle. */
export async function setCustomerActiveAction(
  input: SetCustomerActiveArgs,
): Promise<ActionResult<SetCustomerActiveResult>> {
  const parsed = setCustomerActiveSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.customers);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await setCustomerActive(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(CACHE_TAGS.customers, CACHE_TAGS.auditLog);

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
