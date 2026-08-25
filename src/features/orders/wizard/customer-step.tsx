"use client";

import { Building2Icon, MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { Card, CardContent } from "@/components/ui/card";

import type { ActiveCustomerOption } from "../selectors";
import type { OrderWizardStore } from "./store";

/**
 * Wizard step 1: pick an active customer. Options arrive serialized from
 * the server page; selection flows straight into the wizard store and a
 * contact preview confirms who is buying.
 */

function matchesQuery(customer: ActiveCustomerOption, query: string): boolean {
  const haystack =
    `${customer.name} ${customer.companyName ?? ""} ${customer.email} ${customer.city}`.toLowerCase();

  return haystack.includes(query.toLowerCase());
}

export function CustomerStep({
  store,
  options,
}: {
  store: OrderWizardStore;
  options: ActiveCustomerOption[];
}) {
  const customerId = useStore(store, (state) => state.customerId);
  const setCustomer = useStore(store, (state) => state.setCustomer);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((option) => option.id === customerId) ?? null,
    [options, customerId],
  );

  const filtered = useMemo(
    () =>
      query.trim() === ""
        ? options
        : options.filter((option) => matchesQuery(option, query.trim())),
    [options, query],
  );

  if (options.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-medium">No active customers</p>
          <p className="text-sm text-muted-foreground">
            Orders require an active customer. Create or restore one first, then
            come back to start this order.
          </p>
        </CardContent>
      </Card>
    );
  }

  function commitSelection(option: ActiveCustomerOption) {
    setCustomer(option);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const option: ActiveCustomerOption | undefined = filtered[activeIndex];

      if (option) {
        event.preventDefault();
        commitSelection(option);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <label
          htmlFor="order-customer-combo"
          className="mb-2 block text-sm font-medium"
        >
          Customer
        </label>

        <input
          ref={inputRef}
          id="order-customer-combo"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          placeholder={
            selected
              ? selected.name
              : "Search active customers by name, company, email, or city"
          }
          value={selected && query === "" ? "" : query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={handleKeyDown}
        />

        {open ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Active customers"
            className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md"
          >
            {filtered.length === 0 ? (
              <li
                className="px-3 py-2 text-sm text-muted-foreground"
                role="option"
                aria-selected={false}
                aria-disabled={true}
              >
                No customers match &ldquo;{query}&rdquo;
              </li>
            ) : (
              filtered.map((option, index) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.id === customerId}
                    data-active={index === activeIndex || undefined}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none data-[active]:bg-accent data-[active]:text-accent-foreground"
                    onMouseDown={(event) => {
                      // Keep input focus; blur would close the list first.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      commitSelection(option);
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                  >
                    <span className="block font-medium">{option.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.email} · {option.city}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      {selected ? (
        <Card role="group" aria-label={`Selected customer: ${selected.name}`}>
          <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
            <div className="flex items-center gap-2 sm:col-span-2">
              <p className="font-semibold">{selected.name}</p>
              {selected.companyName ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Building2Icon className="size-3" aria-hidden={true} />
                  {selected.companyName}
                </span>
              ) : null}
            </div>
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <MailIcon className="size-4 shrink-0" aria-hidden={true} />
              {selected.email}
            </p>
            {selected.phone ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <PhoneIcon className="size-4 shrink-0" aria-hidden={true} />
                {selected.phone}
              </p>
            ) : null}
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
              <MapPinIcon className="size-4 shrink-0" aria-hidden={true} />
              {[selected.city, selected.region, selected.countryCode]
                .filter(Boolean)
                .join(", ")}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
