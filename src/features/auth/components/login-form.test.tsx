import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { LoginForm } from "@/features/auth/components/login-form";
import type {
  ActionError,
  ActionErrorCode,
  ActionResult,
} from "@/lib/errors/action-result";

const signInMock =
  vi.fn<(input: unknown) => Promise<ActionResult<{ redirectTo: string }>>>();

vi.mock("@/features/auth/actions", () => ({
  signIn: (input: unknown) => signInMock(input),
}));

const assignMock = vi.fn();

beforeEach(() => {
  signInMock.mockReset();
  assignMock.mockReset();
  // jsdom marks `location` unforgeable; a plain stub satisfies the component.
  vi.stubGlobal("location", {
    href: "http://localhost:3000/login",
    origin: "http://localhost:3000",
    assign: assignMock,
  });
});

type FailureResult = ActionResult<{ redirectTo: string }>;

function failureResult(code: ActionErrorCode, message: string): FailureResult {
  const error: ActionError = { code, message };

  return { ok: false, error };
}

describe("LoginForm", () => {
  test("renders labeled credential fields", () => {
    render(<LoginForm initialNext="" />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    const password = screen.getByLabelText("Password");

    expect(password).toHaveAttribute("type", "password");
  });

  test("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<LoginForm initialNext="" />);

    const toggle = screen.getByRole("button", { name: "Show password" });
    await user.click(toggle);

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  test("shows field errors and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(<LoginForm initialNext="" />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const email = await screen.findByLabelText("Email");

    await waitFor(() => {
      expect(email).toHaveAttribute("aria-invalid", "true");
      expect(email.getAttribute("aria-describedby")).toBe("email-error");
    });
    await waitFor(() => {
      expect(email).toHaveFocus();
    });
    const passwordError = screen.getByText((_, element) => {
      const text = element === null ? "" : element.textContent;

      return (
        element !== null && element.id === "password-error" && text.length > 0
      );
    });

    expect(passwordError).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  test("surfaces the generic invalid-credentials failure and preserves input", async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValue(
      failureResult(
        "UNAUTHENTICATED",
        "Incorrect email or password. Please try again.",
      ),
    );

    render(<LoginForm initialNext="" />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password-1");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText("Incorrect email or password. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    expect(assignMock).not.toHaveBeenCalled();
  });

  test("shows the inactive-account message from a FORBIDDEN failure", async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValue(
      failureResult(
        "FORBIDDEN",
        "This account has been disabled. Contact an administrator.",
      ),
    );

    render(<LoginForm initialNext="" />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText(/account has been disabled/i),
    ).toBeInTheDocument();
  });

  test("shows a pending label while submitting", async () => {
    let resolveSignIn!: (value: ActionResult<{ redirectTo: string }>) => void;
    signInMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<LoginForm initialNext="" />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /^Sign in$/i }));

    const pendingButton = await screen.findByRole("button", {
      name: "Signing in…",
    });

    expect(pendingButton).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();

    resolveSignIn({ ok: true, data: { redirectTo: "/dashboard" } });
  });

  test("navigates to the redirect target after success", async () => {
    const user = userEvent.setup();
    signInMock.mockResolvedValue({
      ok: true,
      data: { redirectTo: "/inventory/products" },
    });

    render(<LoginForm initialNext="/inventory/products" />);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /^Sign in$/i }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("/inventory/products");
    });
    expect(signInMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        next: "/inventory/products",
      }),
    );
  });
});
