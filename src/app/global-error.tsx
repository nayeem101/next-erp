"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Last-resort boundary for failures in the root layout itself. Owns the full
 * document so it can render even when the shell has crashed.
 */
export default function GlobalError({
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
        message: "Unhandled global error",
        digest: error.digest,
        errorName: error.name,
      }),
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: "center",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <section aria-labelledby="global-error-heading" className="text-center">
          <h1 id="global-error-heading" className="text-2xl font-semibold">
            Application error
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The application failed to start. Please try reloading the page.
          </p>
          <Button className="mt-4" onClick={reset}>
            Reload
          </Button>
        </section>
      </body>
    </html>
  );
}
