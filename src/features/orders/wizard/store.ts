import { create } from "zustand";

import type { ActiveCustomerOption, ActiveProductOption } from "../selectors";

/**
 * Per-instance client wizard state. Money is bigint cents; the server
 * recomputes everything authoritative at save time, so this store is a
 * convenience buffer only. Instances are created per mount via
 * `createOrderWizardStore()` so two wizards never share state.
 */

export const ORDER_WIZARD_STEPS = ["customer", "line-items", "review"] as const;

export type OrderWizardStep = (typeof ORDER_WIZARD_STEPS)[number];

export interface WizardLine {
  /** Stable client identity for list rendering and quantity edits. */
  key: string;
  productId: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export interface HydratableDraft {
  customerId: string;
  customerName: string | null;
  lines: {
    productId: string;
    sku: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
  }[];
  notes: string;
}

export interface OrderWizardState {
  stepIndex: number;
  customerId: string | null;
  customerName: string | null;
  lines: WizardLine[];
  notes: string;
  submitting: boolean;

  setCustomer: (customer: ActiveCustomerOption | null) => void;
  addProduct: (product: ActiveProductOption) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  setNotes: (notes: string) => void;
  hydrateDraft: (draft: HydratableDraft) => void;
  goToStep: (stepIndex: number) => boolean;
  next: () => boolean;
  back: () => void;
  setSubmitting: (submitting: boolean) => void;
  reset: () => void;
}

const MAX_QUANTITY = 1_000_000;
const MAX_LINES = 100;

function createClientKey(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);

  bytes[6] = (bytes.at(6) ?? 0) & 0x0f;
  bytes[6] = (bytes.at(6) ?? 0) | 0x40;
  bytes[8] = (bytes.at(8) ?? 0) & 0x3f;
  bytes[8] = (bytes.at(8) ?? 0) | 0x80;

  return [...bytes]
    .map((byte, index) =>
      [4, 6, 8, 10].includes(index)
        ? `-${byte.toString(16).padStart(2, "0")}`
        : byte.toString(16).padStart(2, "0"),
    )
    .join("");
}

export function createOrderWizardStore() {
  return create<OrderWizardState>()((set, get) => ({
    stepIndex: 0,
    customerId: null,
    customerName: null,
    lines: [],
    notes: "",
    submitting: false,

    setCustomer: (customer) => {
      set({
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
      });
    },

    addProduct: (product) => {
      const existing = get().lines.find(
        (line) => line.productId === product.id,
      );

      if (existing) {
        // Unique rows per product: bumping the existing line beats a dupe.
        set({
          lines: get().lines.map((line) =>
            line.productId === product.id
              ? { ...line, quantity: Math.min(line.quantity + 1, MAX_QUANTITY) }
              : line,
          ),
        });

        return;
      }

      if (get().lines.length >= MAX_LINES) {
        return;
      }

      set({
        lines: [
          ...get().lines,
          {
            key: createClientKey(),
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unitPriceCents: product.unitPriceCents,
            quantity: 1,
          },
        ],
      });
    },

    updateQuantity: (key, quantity) => {
      set({
        lines: get().lines.map((line) =>
          line.key === key
            ? {
                ...line,
                quantity: Math.min(Math.max(quantity, 1), MAX_QUANTITY),
              }
            : line,
        ),
      });
    },

    removeLine: (key) => {
      set({ lines: get().lines.filter((line) => line.key !== key) });
    },

    setNotes: (notes) => {
      set({ notes });
    },

    hydrateDraft: (draft) => {
      set({
        stepIndex: 0,
        customerId: draft.customerId,
        customerName: draft.customerName,
        notes: draft.notes,
        submitting: false,
        lines: draft.lines.map((line) => ({ ...line, key: createClientKey() })),
      });
    },

    goToStep: (stepIndex) => {
      const state = get();

      // Forward movement requires every intermediate step to be complete.
      if (state.submitting) {
        return false;
      }

      if (stepIndex > 0 && !state.customerId) {
        return false;
      }

      if (stepIndex > 1 && state.lines.length === 0) {
        return false;
      }

      set({
        stepIndex: Math.min(
          Math.max(stepIndex, 0),
          ORDER_WIZARD_STEPS.length - 1,
        ),
      });

      return true;
    },

    next: () => get().goToStep(get().stepIndex + 1),

    back: () => {
      set({ stepIndex: Math.max(get().stepIndex - 1, 0) });
    },

    setSubmitting: (submitting) => {
      set({ submitting });
    },

    reset: () => {
      set({
        stepIndex: 0,
        customerId: null,
        customerName: null,
        lines: [],
        notes: "",
        submitting: false,
      });
    },
  }));
}

export type OrderWizardStore = ReturnType<typeof createOrderWizardStore>;

/** Exact bigint total across wizard lines; mirrors server math. */
export function wizardTotalCents(lines: WizardLine[]): bigint {
  return lines.reduce(
    (total, line) =>
      total + BigInt(line.quantity) * BigInt(line.unitPriceCents),
    0n,
  );
}
