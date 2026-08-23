"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface NavLink {
  key: string;
  label: string;
  href: string;
}

/**
 * Mobile navigation drawer. Desktop renders the inline list server-side;
 * this island only appears below the breakpoint and mirrors the same links.
 */
export function MobileNav({ links }: { links: readonly NavLink[] }) {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation menu"
            className="md:hidden"
          />
        }
      >
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader>
          <SheetTitle>NextERP</SheetTitle>
        </SheetHeader>
        <nav aria-label="Primary mobile">
          <ul className="space-y-1 px-2">
            {links.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "block rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
                        : "block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
