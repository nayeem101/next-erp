import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Button } from "@/components/ui/button";

test("renders and activates an accessible button", async () => {
  const user = userEvent.setup();
  const handleClick = vi.fn();

  render(<Button onClick={handleClick}>Create order</Button>);

  await user.click(screen.getByRole("button", { name: "Create order" }));

  expect(handleClick).toHaveBeenCalledOnce();
});
