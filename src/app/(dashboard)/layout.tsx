import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ForbiddenAccess } from "@/components/shared/forbidden-access";
import { MobileNav } from "@/components/shared/mobile-nav";
import { UserMenu } from "@/components/shared/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { visibleNavItems } from "@/lib/auth/navigation";
import { cn } from "@/lib/utils";

function ShellSkeleton() {
  return (
    <div
      className="flex min-h-svh flex-col"
      aria-busy="true"
      aria-label="Loading application shell"
    >
      <div className="border-b">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-6 px-4 py-3 sm:px-6">
          <div className="h-5 w-20 animate-pulse rounded bg-muted" />
          <div className="flex gap-2">
            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
      <main id="main-content" className="flex-1 p-6">
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </main>
    </div>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const result = await getCurrentUser();

  if (result.status === "unauthenticated") {
    redirect("/login");
  }

  if (result.status !== "authenticated") {
    return <ForbiddenAccess />;
  }

  const items = visibleNavItems(result.user.roles);
  const navLinks = items.map(({ key, label, href }) => ({ key, label, href }));

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:text-foreground"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <MobileNav links={navLinks} />
            <Link
              href="/dashboard"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "px-2 font-semibold tracking-tight",
              )}
            >
              NextERP
            </Link>
          </div>
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex flex-wrap items-center gap-1">
              {items.map((item) => (
                <li key={item.key}>
                  <a
                    href={item.href}
                    className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <UserMenu
            displayName={result.user.displayName}
            email={result.user.email}
          />
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6"
      >
        {children}
      </main>
      <footer className="border-t px-4 py-4 text-xs text-muted-foreground sm:px-6">
        NextERP — internal operations console
      </footer>
    </div>
  );
}

/**
 * Protected application shell.
 *
 * The verified-user read is request-scoped; with Cache Components it must
 * stream inside a Suspense boundary rather than block the static shell.
 * Pages supply their own breadcrumb trails at render time.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
