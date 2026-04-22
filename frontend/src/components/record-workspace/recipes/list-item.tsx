import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function ListItem({
  onClick,
  interactive,
  className,
  children,
}: {
  onClick?: () => void;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const isButton = Boolean(onClick);
  const classNames = cn(
    "rounded-xl px-4 py-3",
    tokens.surface.card,
    (interactive || isButton) &&
      "cursor-pointer transition-colors hover:border-border hover:bg-muted/30",
    isButton && "w-full text-left",
    className,
  );

  if (isButton) {
    return (
      <button type="button" onClick={onClick} className={classNames}>
        {children}
      </button>
    );
  }

  return <div className={classNames}>{children}</div>;
}
