"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Printer } from "@/components/ui/icons";

/** Marks <html> as the print theme while the print view is mounted (the inline script in the page covers first paint). */
export function PrintTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "print");
    return () => {
      if (previous) root.setAttribute("data-theme", previous);
      else root.removeAttribute("data-theme");
    };
  }, []);
  return null;
}

export function PrintButton() {
  return (
    <Button variant="primary" icon={<Printer />} onClick={() => window.print()}>
      Print / Save as PDF
    </Button>
  );
}
