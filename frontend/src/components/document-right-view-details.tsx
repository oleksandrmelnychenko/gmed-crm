import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type DocumentRightViewDetailsProps = {
  busy: boolean;
  error: string;
  loadingLabel: string;
  errorContent?: ReactNode;
  children: ReactNode;
};

export function DocumentRightViewDetails({
  busy,
  error,
  loadingLabel,
  errorContent,
  children,
}: DocumentRightViewDetailsProps) {
  if (busy) {
    return (
      <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }

  if (error) {
    return <>{errorContent ?? null}</>;
  }

  return <>{children}</>;
}
