import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Plus, RefreshCcw } from "lucide-react";

import {
  AdminSheetScaffold,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  TabLoader,
  tokens,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Announcement {
  id: string;
  title: string;
  message: string;
  variant: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  creator: string;
}

const VARIANT_COLORS: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  error: "bg-red-500/15 text-red-700 dark:text-red-400",
  success: "bg-green-500/15 text-green-700 dark:text-green-400",
};

function compactDt(dt: string | null | undefined): string {
  if (!dt) return "-";
  return dt.split("T")[0] ?? dt;
}

export function AdminAnnouncementsPage() {
  const { t } = useLang();

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fMsg, setFMsg] = useState("");
  const [fVariant, setFVariant] = useState("info");
  const [fEnds, setFEnds] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await apiFetch<Announcement[]>("/admin/announcements"));
    } catch (loadError) {
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : t.common_error);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      await apiFetch("/admin/announcements", {
        method: "POST",
        body: JSON.stringify({
          title: fTitle,
          message: fMsg,
          variant: fVariant,
          is_active: true,
          starts_at: null,
          ends_at: fEnds.trim() || null,
        }),
      });
      setShowCreate(false);
      setFTitle("");
      setFMsg("");
      setFEnds("");
      setFVariant("info");
      void load();
    } catch (submitError) {
      setCreateError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id: string) => {
    await apiFetch(`/admin/announcements/${id}/delete`, { method: "POST" });
    void load();
  };

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.ann_title}
          description={t.ann_subtitle}
          actions={(
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="size-3.5" />
                {t.ann_new}
              </Button>
            </>
          )}
        />

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminTableCard
            title={t.ann_title}
            description={t.ann_subtitle}
            count={items.length}
          >
            {items.length === 0 ? (
              <div className="p-4">
                <EmptyCell>{t.ann_no_announcements}</EmptyCell>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.field_name}</TableHead>
                    <TableHead>{t.ann_message}</TableHead>
                    <TableHead>{t.ann_variant}</TableHead>
                    <TableHead>{t.users_status}</TableHead>
                    <TableHead>{t.ann_starts}</TableHead>
                    <TableHead>{t.ann_ends}</TableHead>
                    <TableHead>{t.users_actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell
                        className="text-muted-foreground max-w-[250px] truncate"
                        title={a.message}
                      >
                        {a.message}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            VARIANT_COLORS[a.variant] ??
                            "bg-neutral-500/15 text-neutral-700 dark:text-neutral-400"
                          }
                        >
                          {a.variant}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {a.is_active ? (
                          <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                            {t.ann_active}
                          </Badge>
                        ) : (
                          <Badge className="bg-neutral-500/15 text-neutral-700 dark:text-neutral-400">
                            {t.providers_inactive}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {compactDt(a.starts_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {compactDt(a.ends_at)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(a.id)}
                        >
                          {t.common_delete}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </AdminTableCard>
        ) : null}
      </div>

      <Sheet open={showCreate} onOpenChange={setShowCreate}>
        <SheetContent side="right" className="w-full sm:max-w-[720px]">
          <form onSubmit={onCreate} className="flex flex-1 min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.ann_new}
              description={t.ann_subtitle}
              footer={(
                <div className="shrink-0 flex justify-end gap-2 bg-popover px-4 py-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    onClick={() => setShowCreate(false)}
                  >
                    {t.common_cancel}
                  </Button>
                  <Button type="submit" className="h-9 rounded-lg" disabled={creating}>
                    {creating ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t.common_save}
                  </Button>
                </div>
              )}
            >
              {createError ? <Banner tone="error">{createError}</Banner> : null}

              <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={`${t.field_name} *`} htmlFor="announcement-title">
                    <Input
                      id="announcement-title"
                      required
                      value={fTitle}
                      onChange={(e) => setFTitle(e.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                  </Field>
                  <Field label={t.ann_variant} htmlFor="announcement-variant">
                    <Select value={fVariant} onValueChange={(value) => setFVariant(value ?? "info")}>
                      <SelectTrigger id="announcement-variant" className="h-9 rounded-lg bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">{t.ann_info}</SelectItem>
                        <SelectItem value="warning">{t.ann_warning}</SelectItem>
                        <SelectItem value="error">{t.common_error}</SelectItem>
                        <SelectItem value="success">{t.ann_success}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field label={`${t.ann_message} *`} htmlFor="announcement-message">
                  <Input
                    id="announcement-message"
                    required
                    value={fMsg}
                    onChange={(e) => setFMsg(e.target.value)}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
                <Field label={t.ann_ends} htmlFor="announcement-ends">
                  <Input
                    id="announcement-ends"
                    type="datetime-local"
                    value={fEnds}
                    onChange={(e) => setFEnds(e.target.value)}
                    className="h-9 rounded-lg bg-card"
                  />
                </Field>
              </section>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
