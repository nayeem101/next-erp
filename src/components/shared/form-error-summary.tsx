import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ActionError } from "@/lib/errors/action-result";

/**
 * Aggregates per-field failures into a single reviewable list. Paired with
 * `FormFieldError`-style inline hints; the summary guarantees keyboard and
 * screen-reader users hear every problem even when fields are off-screen.
 */
export function FormErrorSummary({ error }: { error: ActionError }) {
  const entries = Object.entries(error.fieldErrors ?? {});
  const totalMessages = entries.reduce(
    (count, [, messages]) => count + messages.length,
    0,
  );

  return (
    <Alert variant="destructive" data-slot="form-error-summary">
      <AlertTitle>
        {totalMessages > 0
          ? `Please fix ${totalMessages === 1 ? "1 issue" : `${String(totalMessages)} issues`} below.`
          : error.message}
      </AlertTitle>
      {entries.length > 0 && (
        <AlertDescription>
          <ul className="list-inside list-disc space-y-0.5">
            {entries.map(([field, messages]) =>
              messages.map((message) => (
                <li key={`${field}-${message}`}>
                  <span className="font-medium capitalize">
                    {field
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (c) => c.toUpperCase())}
                  </span>
                  {": "}
                  {message}
                </li>
              )),
            )}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  );
}
