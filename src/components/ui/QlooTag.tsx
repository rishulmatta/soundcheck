"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "./cn";

type DataMode = "mock" | "live" | "unknown";
const DataSource = createContext<DataMode>("unknown");

export function DataSourceProvider({ mode, children }: { mode: DataMode; children: ReactNode }) {
  return <DataSource.Provider value={mode}>{children}</DataSource.Provider>;
}

/** Provenance tag. Once per group, at the group's label, never on every number. */
export function QlooTag({ className, mode }: { className?: string; mode?: DataMode }) {
  const contextMode = useContext(DataSource);
  const source = mode ?? contextMode;
  return (
    <span
      title={source === "mock" ? "Simulated signal, not a live Qloo response" : source === "live" ? "Qloo API signal" : "The data source for this signal has not been verified"}
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-sm border border-signal px-1.5 align-middle text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] text-signal",
        className,
      )}
    >
      {source === "mock" ? "Synthetic" : source === "live" ? "Qloo" : "Unverified"}
    </span>
  );
}
