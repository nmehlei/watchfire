"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  History,
  BellOff,
  Search,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: Route;
  label: string;
  // Match function — covers nested detail pages (e.g. /findings/abc) too.
  matches: (pathname: string) => boolean;
  Icon: LucideIcon;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "Overview", matches: (p) => p === "/", Icon: LayoutDashboard },
  { href: "/findings", label: "Findings", matches: (p) => p.startsWith("/findings"), Icon: ListChecks },
  { href: "/runs", label: "Runs", matches: (p) => p.startsWith("/runs"), Icon: History },
  { href: "/mutes", label: "Mutes", matches: (p) => p.startsWith("/mutes"), Icon: BellOff },
  { href: "/search", label: "Search", matches: (p) => p.startsWith("/search"), Icon: Search },
];

export function NavBar() {
  const pathname = usePathname() ?? "/";

  return (
    <>
      {/* Desktop + tablet: sticky top strip. */}
      <nav className="sticky top-0 z-10 hidden border-b border-zinc-800 bg-zinc-950/80 backdrop-blur md:block">
        <ul className="mx-auto flex w-full max-w-5xl items-center gap-1 overflow-x-auto px-2 py-2 text-sm">
          {ITEMS.map(({ href, label, matches, Icon }) => {
            const active = matches(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${
                    active
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Mobile: bottom tab bar. Safe-area aware on iOS so it sits above
          the home indicator. The trailing spacer below pads content so
          the last row doesn't slide under the bar. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {ITEMS.map(({ href, label, matches, Icon }) => {
            const active = matches(pathname);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${
                    active ? "text-zinc-100" : "text-zinc-500"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
