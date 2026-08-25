"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { OrderWizardStore } from "./store";

/**
 * Wizard chrome shared by New Order and Edit Draft: progress rail, step
 * body, and validated navigation. Focus moves to each step's heading on
 * change and a live region announces progress for screen readers.
 */

export const ORDER_WIZARD_STEP_DEFS = [
  {
    id: "customer",
    title: "Customer",
    description: "Choose the active customer placing this order.",
  },
  {
    id: "line-items",
    title: "Line items",
    description: "Add products and set quantities.",
  },
  {
    id: "review",
    title: "Review",
    description: "Verify the draft before saving.",
  },
] as const;

function canAdvanceFrom(state: {
  stepIndex: number;
  customerId: string | null;
  lineCount: number;
}): boolean {
  if (state.stepIndex === 0) {
    return state.customerId !== null;
  }

  if (state.stepIndex === 1) {
    return state.lineCount > 0;
  }

  return false;
}

export function WizardShell({
  store,
  children,
}: {
  store: OrderWizardStore;
  children?: React.ReactNode;
}) {
  const stepIndex = useStore(store, (state) => state.stepIndex);
  const customerId = useStore(store, (state) => state.customerId);
  const lineCount = useStore(store, (state) => state.lines.length);
  const submitting = useStore(store, (state) => state.submitting);

  const goToStep = useStore(store, (state) => state.goToStep);
  const next = useStore(store, (state) => state.next);
  const back = useStore(store, (state) => state.back);

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);

  const step = ORDER_WIZARD_STEP_DEFS[stepIndex];

  if (!step) {
    throw new Error(`Invalid wizard step index: ${String(stepIndex)}`);
  }

  const canAdvance =
    !submitting && canAdvanceFrom({ stepIndex, customerId, lineCount });

  const isLastStep = stepIndex === ORDER_WIZARD_STEP_DEFS.length - 1;

  return (
    <div className="space-y-6">
      <ol
        className="flex flex-col gap-2 sm:flex-row sm:gap-4"
        data-testid="wizard-progress"
      >
        {ORDER_WIZARD_STEP_DEFS.map((def, index) => {
          const isCurrent = index === stepIndex;
          const isComplete = index < stepIndex;

          return (
            <li key={def.id} className="flex-1">
              {isComplete ? (
                <button
                  type="button"
                  onClick={() => goToStep(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <CheckIcon className="size-4" aria-hidden={true} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">
                      {def.title}
                    </span>
                    <span className="sr-only">{" — completed"}</span>
                  </span>
                </button>
              ) : (
                <div
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-4 py-3",
                    isCurrent
                      ? "border-primary bg-primary/5"
                      : "border-dashed border-border opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
                      isCurrent
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium">{def.title}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="sr-only" role="status">
        {`Step ${String(stepIndex + 1)} of ${String(ORDER_WIZARD_STEP_DEFS.length)}: ${step.title}`}
      </p>

      <section aria-labelledby="wizard-step-heading">
        <h2
          ref={headingRef}
          id="wizard-step-heading"
          tabIndex={-1}
          className="scroll-mt-20 text-xl font-semibold tracking-tight focus-visible:outline-none"
        >
          {step.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>

        <div className="mt-6">{children}</div>

        <div className="mt-8 flex items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              back();
            }}
            disabled={stepIndex === 0 || submitting}
          >
            Back
          </Button>
          {!isLastStep ? (
            <Button
              type="button"
              onClick={() => {
                next();
              }}
              disabled={!canAdvance}
            >
              Next
            </Button>
          ) : (
            <span />
          )}
        </div>
      </section>
    </div>
  );
}
