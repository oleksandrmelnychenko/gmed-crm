import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  if (!dt) return "\u2014";
  return dt.split("T")[0] ?? dt;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminAnnouncementsPage() {
  const { t } = useLang();

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [fTitle, setFTitle] = useState("");
  const [fMsg, setFMsg] = useState("");
  const [fVariant, setFVariant] = useState("info");
  const [fEnds, setFEnds] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await apiFetch<Announcement[]>("/admin/announcements"));
    } catch {
      /* keep empty */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
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
    void load();
  };

  const onDelete = async (id: string) => {
    await apiFetch(`/admin/announcements/${id}/delete`, { method: "POST" });
    void load();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.ann_title}</h1>
          <p className="text-muted-foreground text-sm">{t.ann_subtitle}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 size-4" />
          {t.ann_new}
        </Button>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.ann_new}</DialogTitle>
            <DialogDescription>{t.ann_subtitle}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{t.field_name} *</Label>
                <Input
                  required
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t.ann_variant}</Label>
                <Select value={fVariant} onValueChange={(value) => setFVariant(value ?? "info")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">{t.ann_info}</SelectItem>
                    <SelectItem value="warning">{t.ann_warning}</SelectItem>
                    <SelectItem value="error">{t.common_error}</SelectItem>
                    <SelectItem value="success">{t.ann_success}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.ann_message} *</Label>
              <Input
                required
                value={fMsg}
                onChange={(e) => setFMsg(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t.ann_ends}</Label>
              <Input
                type="datetime-local"
                value={fEnds}
                onChange={(e) => setFEnds(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreate(false)}
              >
                {t.common_cancel}
              </Button>
              <Button type="submit">{t.common_save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Table */}
      {loading ? (
        <p className="text-muted-foreground py-10 text-center">
          {t.common_loading}
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-neutral-900">
          <p className="text-muted-foreground px-6 py-10 text-center text-sm">
            {t.ann_no_announcements}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-neutral-900">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-semibold">
              {t.ann_title} ({items.length})
            </h2>
          </div>
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
        </div>
      )}
    </div>
  );
}
