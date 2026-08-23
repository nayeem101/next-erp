import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h1 id="not-found-heading" className="text-2xl font-semibold">
        Page not found
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        The page you requested does not exist or you do not have access to it.
      </p>
      <Button render={<Link href="/dashboard" />}>Back to dashboard</Button>
    </section>
  );
}
