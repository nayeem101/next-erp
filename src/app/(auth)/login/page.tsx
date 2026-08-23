import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";
import { getCurrentUser } from "@/lib/auth/current-user";
import { sanitizeRedirectPath } from "@/lib/auth/safe-redirect";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function LoginCardFallback() {
  return (
    <Card className="w-full max-w-sm" aria-busy="true">
      <CardHeader>
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-8 animate-pulse rounded bg-muted" />
        <div className="h-8 animate-pulse rounded bg-muted" />
        <div className="h-9 animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: LoginPageProps["searchParams"];
}) {
  // Verified users never see the form; everyone else gets the entry point.
  const auth = await getCurrentUser();

  if (auth.status === "authenticated") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const initialNext = sanitizeRedirectPath(rawNext, "");

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <h1 className="text-xl font-semibold">Sign in to NextERP</h1>
        <CardDescription>
          Use your operator account to reach the console.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm initialNext={initialNext} />
      </CardContent>
    </Card>
  );
}

/** Auth entry point; verified users are bounced to the dashboard. */
export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Suspense fallback={<LoginCardFallback />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
