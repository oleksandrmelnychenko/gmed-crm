import { useEffect, useState } from "react";
import { ExternalLink, Folder, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";

type CasePreview = {
  id: string;
  case_id: string;
  status: string;
  hauptanfragegrund: string | null;
  aktuelle_anamnese: string | null;
  zuweiser: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function PatientCasePreviewSheet({
  caseId,
  open,
  onOpenChange,
}: {
  caseId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const { staffGo } = useStaffNavigate();
  const [detail, setDetail] = useState<CasePreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !caseId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<CasePreview>(`/cases/${caseId}`)
      .then((row) => {
        if (!cancelled) {
          setDetail(row);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, caseId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] gap-0">
        <SheetHeader className="px-4 py-3 flex-row items-center justify-between">
          <SheetTitle className="inline-flex items-center gap-2">
            <Folder className="size-4 text-muted-foreground" />
            {detail ? (
              <span className="font-mono text-sm">{detail.case_id}</span>
            ) : (
              l("Fall", "Кейс", "Case")
            )}
          </SheetTitle>
          {caseId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-lg gap-1 text-[12px] text-muted-foreground"
              onClick={() => {
                onOpenChange(false);
                staffGo(`/cases?case=${caseId}`);
              }}
            >
              {l("Vollansicht", "Открыть раздел", "Full view")}
              <ExternalLink className="size-3" />
            </Button>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <LoaderCircle className="size-4 mr-2 animate-spin" />
              Loading…
            </div>
          ) : !detail ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {tr[`cases_${detail.status}`] ?? detail.status}
                </Badge>
                <span className="text-[11.5px] text-muted-foreground">
                  {formatDate(detail.created_at)}
                </span>
              </div>

              <Field
                label={l("Hauptanfragegrund", "Основная причина обращения", "Main request reason")}
                value={detail.hauptanfragegrund}
              />
              <Field
                label={l("Aktuelle Anamnese", "Текущий анамнез", "Current anamnesis")}
                value={detail.aktuelle_anamnese}
              />
              <Field
                label={l("Zuweiser", "Направитель", "Referrer")}
                value={detail.zuweiser}
              />
              <Field
                label={l("Notizen", "Заметки", "Notes")}
                value={detail.notes}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <p className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground">
        {value?.trim() || "—"}
      </p>
    </div>
  );
}
