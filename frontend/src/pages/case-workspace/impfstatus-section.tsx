import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t as translateCatalog, useLang } from "@/lib/i18n";

import { useCaseWorkspace } from "./context";
import { Banner, Field, Panel, textareaBaseClassName } from "./primitives";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

export function ImpfstatusSection() {
  const { lang, t } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveImpfstatus,
  } = useCaseWorkspace();

  const revisionKey = detail?.updated_at ?? detail?.id ?? "empty";

  return (
    <ImpfstatusSectionForm
      key={revisionKey}
      rawValue={detail?.impfstatus ?? ""}
      title={t.cases_vaccination}
      statusLabel={t.cases_status}
      canEdit={permissions.canEdit}
      busy={sectionBusy === "impfstatus"}
      sectionError={sectionError}
      saveImpfstatus={saveImpfstatus}
      lang={lang}
    />
  );
}

type ImpfstatusSectionFormProps = {
  rawValue: string;
  title: string;
  statusLabel: string;
  canEdit: boolean;
  busy: boolean;
  sectionError: string;
  saveImpfstatus: (statusText: string) => Promise<boolean>;
  lang: string;
};

function ImpfstatusSectionForm({
  rawValue,
  title,
  statusLabel,
  canEdit,
  busy,
  sectionError,
  saveImpfstatus,
  lang,
}: ImpfstatusSectionFormProps) {
  const [statusText, setStatusText] = useState(rawValue);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    await saveImpfstatus(statusText);
  }

  return (
    <Panel
      title={title}
      description={tri(lang, "case_ws_impfstatus_description")}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {sectionError ? <Banner tone="error">{sectionError}</Banner> : null}

        <Field label={statusLabel}>
          <textarea
            value={statusText}
            onChange={(event) => setStatusText(event.target.value)}
            className={textareaBaseClassName}
            rows={4}
            disabled={!canEdit || busy}
          />
        </Field>

        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button
            type="submit"
            className="h-9 rounded-lg"
            disabled={busy || !canEdit}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {tri(lang, "case_ws_save_section")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
