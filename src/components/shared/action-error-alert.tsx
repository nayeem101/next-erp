import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ActionError } from "@/lib/errors/action-result";

/**
 * Typed presentation for a failed `ActionResult`. Renders the actionable
 * message plus any field-level errors; never displays raw codes alone.
 */
export function ActionErrorAlert({ error }: { error: ActionError }) {
  const fieldEntries = Object.entries(error.fieldErrors ?? {});

  return (
    <Alert variant="destructive">
      <AlertTitle>{error.message}</AlertTitle>
      {fieldEntries.length > 0 && (
        <AlertDescription>
          <ul className="list-inside list-disc space-y-0.5">
            {fieldEntries.map(([field, messages]) =>
              messages.map((message) => (
                <li key={`${field}-${message}`}>{message}</li>
              )),
            )}
          </ul>
        </AlertDescription>
      )}
    </Alert>
  );
}
