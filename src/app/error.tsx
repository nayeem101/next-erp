"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level boundary for unexpected render failures. Offers a retry and
 * reports the failure through the console for server log collection.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Unhandled route error",
        digest: error.digest,
        errorName: error.name,
      }),
    );
  }, [error]);

  return (
    <section
      aria-labelledby="route-error-heading"
      className="flex flex-col items-center justify-center gap-4 py-24 text-center"
    >
      <h1 id="route-error-heading" className="text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        An unexpected error interrupted this page. You can try again; if the
        problem persists, contact support
        {error.digest ? (
          <>
            {" "}
            and reference code{" "}
            <code className="rounded bg-muted px-1 py-0.5">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
