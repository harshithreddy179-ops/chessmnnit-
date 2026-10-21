"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface NavLink {
  href: string;
  label: string;
}

export function MobileNav({ links, children }: { links: NavLink[]; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-none rounded-b-xl sm:max-w-none">
          <DialogTitle>Menu</DialogTitle>
          <DialogDescription className="sr-only">Site navigation</DialogDescription>
          <nav aria-label="Mobile" className="grid gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
