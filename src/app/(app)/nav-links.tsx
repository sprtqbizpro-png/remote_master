"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

export function NavLinks({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: "/applications", label: "Applications" },
    { href: "/board", label: "Board" },
    { href: "/resume-kit", label: "Resume kit" },
    ...(isOwner
      ? [
          { href: "/admin/users", label: "Users" },
          { href: "/admin/settings", label: "Settings" },
        ]
      : []),
  ];
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "whitespace-nowrap rounded-md px-2 py-1.5 font-medium sm:px-3",
            pathname.startsWith(link.href) ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
