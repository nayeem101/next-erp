"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/features/auth/actions";

export interface UserMenuProps {
  displayName: string;
  email: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);

  const first = parts[0]?.[0] ?? "U";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";

  return `${first}${last}`.toUpperCase();
}

export function UserMenu({ displayName, email }: UserMenuProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${displayName}`}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        disabled={isPending}
      >
        <Avatar>
          <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs font-normal text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            startTransition(() => {
              void signOut().catch(() => undefined);
            });
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
