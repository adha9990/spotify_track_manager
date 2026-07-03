import type { ButtonHTMLAttributes, ReactNode } from "react";

// Small shared building blocks. Kept inline (no UI-kit dependency) so the editorial
// look stays under our control. `cx` is a trivial className joiner.

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110 active:brightness-95 shadow-sm",
  outline: "border border-stone-300 text-ink hover:bg-stone-100",
  ghost: "text-stone-600 hover:bg-stone-200/60 hover:text-ink",
  danger: "text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200",
};
const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "outline", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-md font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "ok" }) {
  const tones = {
    neutral: "bg-stone-200/70 text-stone-600",
    accent: "bg-accent/10 text-accent",
    warn: "bg-amber-100 text-amber-800",
    ok: "bg-emerald-100 text-emerald-700",
  } as const;
  return (
    <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-semibold nums", tones[tone])}>
      {children}
    </span>
  );
}

const PATHS = {
  play: "M8 5v14l11-7z",
  trash: "M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7",
  search: "M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z",
  refresh: "M4 12a8 8 0 0114-5.3L20 8M20 4v4h-4M20 12a8 8 0 01-14 5.3L4 16m0 4v-4h4",
  close: "M6 6l12 12M18 6L6 18",
  swap: "M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4",
  check: "M5 13l4 4L19 7",
} as const;

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
