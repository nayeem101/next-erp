import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { RevenueChart } from "./revenue-chart";

const points = [
  { bucket: "2026-08-01", label: "Aug 1", revenueCents: 12500 },
  { bucket: "2026-08-02", label: "Aug 2", revenueCents: 0 },
  { bucket: "2026-08-03", label: "Aug 3", revenueCents: 42000 },
];

describe("revenue chart renderer", () => {
  test("renders the serialized series with a text summary", () => {
    render(<RevenueChart granularity="daily" points={points} />);

    const summary = screen.getByText(/Total net revenue for the period/, {
      selector: "#revenue-summary",
    });

    expect(summary).toHaveTextContent("$545");
    expect(summary).toHaveTextContent("3 daily buckets");
    expect(summary).toHaveTextContent("$420");
  });

  test("renders the visible net total line", () => {
    render(<RevenueChart granularity="monthly" points={points} />);

    expect(screen.getByText("$545")).toBeInTheDocument();
    expect(screen.getByText(/net across 12 months/)).toBeInTheDocument();
  });
});
