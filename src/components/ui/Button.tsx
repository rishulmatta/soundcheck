import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-spot text-on-spot hover:brightness-[0.94]",
  secondary: "border-line-strong text-ink hover:bg-bg-raised aria-pressed:bg-bg-raised aria-pressed:border-ink-muted",
  ghost: "text-ink-muted hover:text-ink aria-pressed:text-ink",
};

type Common = { variant?: Variant; size?: "md" | "sm"; icon?: ReactNode; className?: string; children?: ReactNode };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof Common> & { href?: undefined };
type AsLink = Common & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof Common | "href"> & { href: string; download?: boolean | string };

/** `spot` fills only the primary action. Renders a next/link for internal pages and a plain anchor for downloads. */
export function Button(props: AsButton | AsLink) {
  const { variant = "secondary", size = "md", icon, className, children, ...rest } = props;
  const classes = cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-transparent font-semibold transition-[background-color,filter,transform,color] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
    size === "md" ? "h-10 px-[18px] text-sm leading-5" : "h-8 px-3 text-[13px] leading-5",
    variants[variant],
    className,
  );
  const inner = (
    <>
      {icon}
      {children}
    </>
  );
  if ("href" in rest && rest.href !== undefined) {
    const { href, download, ...anchor } = rest as Omit<AsLink, keyof Common>;
    if (download !== undefined) {
      return (
        <a href={href} download={download === true ? "" : download} className={classes} {...anchor}>
          {inner}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...anchor}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {inner}
    </button>
  );
}
