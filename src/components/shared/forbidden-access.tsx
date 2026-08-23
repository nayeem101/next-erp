interface ForbiddenAccessProps {
  title?: string;
  description?: string;
}

/**
 * Shared 403 presentation for module layouts and pages whose verified user
 * lacks the required role. Rendered server-side; no interactivity required.
 */
export function ForbiddenAccess({
  title = "Access denied",
  description = "Your account does not have permission to view this area. Ask an administrator if you believe this is a mistake.",
}: ForbiddenAccessProps) {
  return (
    <section
      aria-labelledby="forbidden-heading"
      className="flex flex-col items-center justify-center gap-4 py-24 text-center"
    >
      <h1 id="forbidden-heading" className="text-2xl font-semibold">
        {title}
      </h1>
      <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
