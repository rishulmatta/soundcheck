import Link from "next/link";

/** Slim top bar for inner pages: the wordmark set in type, no logo mark. */
export function SiteBar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex h-14 items-center justify-between">
      <Link href="/" className="disp rounded-sm text-[22px] leading-none tracking-[0.04em] text-ink transition-colors duration-150 hover:text-spot">
        Soundcheck
      </Link>
      {right}
    </div>
  );
}
