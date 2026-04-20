import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type DocumentRightViewContentProps = {
  busy: boolean;
  hasError: boolean;
  errorContent: ReactNode;
  loadingLabel: string;
  children: ReactNode;
};

export function DocumentRightViewContent({
  busy,
  hasError,
  errorContent,
  loadingLabel,
  children,
}: DocumentRightViewContentProps) {
  if (busy) {
    return (
      <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }

  if (hasError) return <>{errorContent}</>;

  return <>{children}</>;
}
