import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Breadcrumbs } from "@/components/shared/breadcrumbs";

describe("Breadcrumbs", () => {
  test("renders nothing for an empty trail", () => {
    const { container } = render(<Breadcrumbs items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  test("labels the landmark and marks the current page", () => {
    render(
      <Breadcrumbs
        items={[
          { label: "Inventory", href: "/inventory/products" },
          { label: "Widgets", href: "/inventory/products/p-1" },
          { label: "Edit" },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });

    expect(nav).toBeInTheDocument();

    const current = screen.getByText("Edit");

    expect(current).toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("link", { name: "Inventory" })).toHaveAttribute(
      "href",
      "/inventory/products",
    );
    expect(
      screen.queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  test("renders a plain span when a middle entry has no href", () => {
    render(
      <Breadcrumbs
        items={[{ label: "A", href: "/a" }, { label: "B" }, { label: "C" }]}
      />,
    );

    const middle = screen.getByText("B");

    expect(middle).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "B" })).not.toBeInTheDocument();
  });
});
