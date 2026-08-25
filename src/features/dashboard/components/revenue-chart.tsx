"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { RevenuePoint } from "../schemas";

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Client renderer for the serialized revenue series. Receives plain
 * data from the server widget wrapper; never touches the database.
 */
export function RevenueChart({
  points,
  granularity,
}: {
  points: RevenuePoint[];
  granularity: "daily" | "monthly";
}) {
  const peak = Math.max(...points.map((point) => point.revenueCents), 0);
  const total = points.reduce((sum, point) => sum + point.revenueCents, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">Revenue over time</CardTitle>
        <span className="text-xs text-muted-foreground">
          Net sales revenue, {granularity}
        </span>
      </CardHeader>
      <CardContent>
        <p className="sr-only" id="revenue-summary">
          Total net revenue for the period is {formatCents(total)} across{" "}
          {String(points.length)} {granularity} buckets; the best bucket reached{" "}
          {formatCents(peak)}.
        </p>
        <div aria-hidden={true}>
          <ResponsiveContainer height={240} width="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                fontSize={11}
                minTickGap={24}
                stroke="var(--muted-foreground)"
                tickLine={false}
              />
              <YAxis
                fontSize={11}
                stroke="var(--muted-foreground)"
                tickFormatter={(value: number) => formatCents(value)}
                tickLine={false}
                width={72}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
                formatter={(value) => formatCents(Number(value))}
              />
              <Line
                dataKey="revenueCents"
                dot={false}
                stroke="var(--primary)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          <span aria-hidden={true}>{formatCents(total)}</span> net across{" "}
          {granularity === "monthly"
            ? "12 months"
            : `${points.length.toString()} days`}
          .
        </p>
      </CardContent>
    </Card>
  );
}
