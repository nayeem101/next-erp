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

import { listProducts } from "./queries";
import {
  adjustStockSchema,
  createProductSchema,
  listProductsQuerySchema,
  setProductActiveSchema,
  updateProductSchema,
  type AdjustStockArgs,
  type AdjustStockResult,
  type CreateProductArgs,
  type CreateProductResult,
  type ListProductsQueryInput,
  type ProductListPage,
  type SetProductActiveArgs,
  type SetProductActiveResult,
  type UpdateProductArgs,
  type UpdateProductResult,
} from "./schemas";
import {
  adjustStock,
  createProduct,
  setProductActive,
  updateProduct,
} from "./service";

/**
 * Paginated product catalog with category names and stock projections.
 *
 * Admin and Inventory roles per the module access matrix.
 */
export async function listProductsAction(
  input: ListProductsQueryInput,
): Promise<ActionResult<ProductListPage>> {
  const parsed = listProductsQuerySchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const page = await listProducts(parsed.data);

    return actionSuccess(page);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Inventory product creation with opening-stock movement. */
export async function createProductAction(
  input: CreateProductArgs,
): Promise<ActionResult<CreateProductResult>> {
  const parsed = createProductSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await createProduct(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.products,
      CACHE_TAGS.dashboard.lowStock,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Inventory product update with changed-field audit metadata. */
export async function updateProductAction(
  input: UpdateProductArgs,
): Promise<ActionResult<UpdateProductResult>> {
  const parsed = updateProductSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await updateProduct(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.products,
      CACHE_TAGS.dashboard.lowStock,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Inventory product active-state toggle. */
export async function setProductActiveAction(
  input: SetProductActiveArgs,
): Promise<ActionResult<SetProductActiveResult>> {
  const parsed = setProductActiveSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await setProductActive(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.products,
      CACHE_TAGS.dashboard.lowStock,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}

/** Admin/Inventory stock adjustment with reason tracking. */
export async function adjustStockAction(
  input: AdjustStockArgs,
): Promise<ActionResult<AdjustStockResult>> {
  const parsed = adjustStockSchema.safeParse(input);

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const context = await getActionContext(MODULE_ROLE_REQUIREMENTS.inventory);

  if (!context.ok) {
    return context;
  }

  try {
    const result = await adjustStock(
      parsed.data,
      context.user.id,
      context.correlationId,
    );

    invalidateTags(
      CACHE_TAGS.products,
      CACHE_TAGS.dashboard.lowStock,
      CACHE_TAGS.auditLog,
    );

    return actionSuccess(result);
  } catch (error) {
    return mapActionError(error, context.correlationId);
  }
}
