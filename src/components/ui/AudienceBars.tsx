"use client";

import type { Demographics } from "@/lib/types";
import { CountUp } from "./motion";
import { LimitedData } from "./LimitedData";
import { QlooTag } from "./QlooTag";

/** "24_and_younger" -> "≤24", "25_to_29" -> "25–29", "55_and_older" -> "55+". */
export function bucketLabel(bucket: string): string {
  const younger = bucket.match(/^(\d+)_and_younger$/);
  if (younger) return `≤${younger[1]}`;
  const older = bucket.match(/^(\d+)_and_older$/);
  if (older) return `${older[1]}+`;
  const range = bucket.match(/^(\d+)_to_(\d+)$/);
  if (range) return `${range[1]}–${range[2]}`;
  return bucket.replace(/_/g, " ");
}

/** Plain-div bars: signal fill on a line track, values in Data style on the right. Bars fill after the numbers land. */
export function AudienceBars({ demographics, play = true, animate = true }: { demographics: Demographics; play?: boolean; animate?: boolean }) {
  const { age, gender, status } = demographics;
  // Qloo gives gender as scores against a baseline (roughly -1..1), not shares.
  const diff = gender.female - gender.male;
  const skew = diff >= 0.04 ? "Skews female" : diff <= -0.04 ? "Skews male" : "Similar gender scores";
  const skewValue = `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)}`;
  return (
    <div>
      <div className="label mb-2 flex items-center gap-2">
        Overall audience <QlooTag />
      </div>
      <p className="mb-3 text-xs leading-4 text-ink-muted">Act-wide profile; not specific to this city.</p>
      {age.length === 0 ? (
        <LimitedData status={status}>Limited data on the act’s overall audience age.</LimitedData>
      ) : (
        <>
          <div className="grid gap-2">
            {age.map((a) => {
              const neg = a.score < 0;
              const abs = Math.min(1, Math.abs(a.score));
              return (
                <div key={a.bucket} className="grid grid-cols-[48px_1fr_56px] items-center gap-2">
                  <span className="text-[13px] leading-[18px] text-ink-muted">{bucketLabel(a.bucket)}</span>
                  <span className="h-2 overflow-hidden rounded-sm bg-line">
                    <span
                      className={`sc-bar block h-full rounded-sm ${neg ? "bg-ink-faint" : "bg-signal"}`}
                      style={{ width: `${abs * 100}%`, ["--sc-delay" as string]: "500ms" }}
                      data-play={play ? "true" : "false"}
                      data-static={animate ? undefined : "true"}
                    />
                  </span>
                  <span className="text-right text-[13px] text-ink">
                    <CountUp value={abs} play={play} animate={animate} prefix={neg ? "−" : "+"} />
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
            {skew} <span className="num text-ink">{skewValue}</span> <span className="text-ink-faint">vs baseline</span>
          </p>
          {status !== "ok" && <LimitedData status={status} className="mt-3">Partial Qloo audience data. Showing what came back.</LimitedData>}
        </>
      )}
    </div>
  );
}
