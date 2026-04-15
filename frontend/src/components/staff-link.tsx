import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react";
import { Link, type LinkProps } from "react-router-dom";

import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

function pathnameOnly(to: string): string {
  const base = to.split("?")[0] ?? "/";
  if (base === "") {
    return "/";
  }
  return base.startsWith("/") ? base : `/${base}`;
}

export type StaffLinkProps = Omit<LinkProps, "to"> & {
  to: string;
  /** Applied to the non-interactive wrapper when access is denied. */
  deniedClassName?: string;
};

/**
 * In-app link that respects staff route rules: if the role cannot open `to`,
 * renders a non-navigating surrogate (optionally disables a single child element).
 */
export function StaffLink({
  to,
  className,
  children,
  deniedClassName,
  ...rest
}: StaffLinkProps) {
  const { canStaffPath } = useStaffNavigate();
  const path = pathnameOnly(to);

  if (!canStaffPath(path)) {
    const only = Children.toArray(children);
    if (only.length === 1 && isValidElement(only[0])) {
      const child = only[0] as ReactElement<{
        disabled?: boolean;
        className?: string;
        title?: string;
      }>;
      return cloneElement(child, {
        disabled: true,
        className: cn(className, child.props.className, "cursor-not-allowed opacity-45"),
        title: child.props.title ?? "No access for your role",
      });
    }
    return (
      <span
        className={cn(className, deniedClassName ?? "cursor-not-allowed opacity-45")}
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  return (
    <Link to={to} className={className} {...rest}>
      {children}
    </Link>
  );
}
