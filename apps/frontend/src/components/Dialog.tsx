import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Icon } from "./primitives";

// Styled wrapper around Radix Dialog: a dimmed paper overlay + a centered card.
// Radix handles focus trapping, Esc-to-close and aria wiring for us.
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  width?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-stone-900/30 backdrop-blur-[2px] data-[state=open]:animate-[fadeIn_120ms_ease]" />
        <RadixDialog.Content
          className={`fixed left-1/2 top-1/2 z-50 w-[92vw] ${width} -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-paper p-6 shadow-2xl focus:outline-none`}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="font-display text-xl font-semibold text-ink">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close className="rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-ink">
              <Icon name="close" />
            </RadixDialog.Close>
          </div>
          {description && (
            <RadixDialog.Description className="mt-1 text-sm text-stone-500">
              {description}
            </RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
