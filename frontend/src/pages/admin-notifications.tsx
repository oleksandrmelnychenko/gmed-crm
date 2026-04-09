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

interface Channel {
  id: string;
  channel_type: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
}

function compactConfig(cfg: Record<string, unknown>): string {
  return Object.entries(cfg)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminNotificationsPage() {
  const { t } = useLang();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState("smtp");
  const [fConfig, setFConfig] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await apiFetch<Channel[]>("/admin/notifications"));
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
    setMsg(null);
    let config: Record<string, unknown>;
    try {
      config = fConfig.trim() ? JSON.parse(fConfig) : {};
    } catch {
      config = {};
    }
    try {
      await apiFetch("/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          channel_type: fType,
          name: fName,
          config,
          is_active: true,
        }),
      });
      setShowCreate(false);
      setFName("");
      setFConfig("");
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (id: string) => {
    await apiFetch(`/admin/notifications/${id}/delete`, { method: "POST" });
    void load();
  };

  const onTest = async (id: string) => {
    try {
      await apiFetch(`/admin/notifications/${id}/test`, { method: "POST" });
      setMsg("OK");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.notif_title}</h1>
          <p className="text-muted-foreground text-sm">{t.notif_subtitle}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 size-4" />
          {t.notif_new}
        </Button>
      </div>

      {msg && (
        <p className="text-destructive text-sm">{msg}</p>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.notif_new}</DialogTitle>
            <DialogDescription>{t.notif_subtitle}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{t.notif_name} *</Label>
                <Input
                  required
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t.notif_type}</Label>
                <Select value={fType} onValueChange={(value) => setFType(value ?? "smtp")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smtp">{t.notif_smtp}</SelectItem>
                    <SelectItem value="webhook">{t.notif_webhook}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.notif_config}</Label>
              <Input
                value={fConfig}
                onChange={(e) => setFConfig(e.target.value)}
                placeholder='{"host":"smtp.example.com","port":587,"user":"..."}'
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
      ) : channels.length === 0 ? (
        <div className="rounded-xl border bg-white dark:bg-neutral-900">
          <p className="text-muted-foreground px-6 py-10 text-center text-sm">
            {t.notif_no_channels}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white dark:bg-neutral-900">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-semibold">
              {t.notif_title} ({channels.length})
            </h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.notif_name}</TableHead>
                <TableHead>{t.notif_type}</TableHead>
                <TableHead>{t.notif_config}</TableHead>
                <TableHead>{t.users_status}</TableHead>
                <TableHead>{t.users_actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((ch) => (
                <TableRow key={ch.id}>
                  <TableCell className="font-medium">{ch.name}</TableCell>
                  <TableCell>
                    <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">
                      {ch.channel_type}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground max-w-[300px] truncate font-mono text-sm"
                    title={JSON.stringify(ch.config)}
                  >
                    {compactConfig(ch.config)}
                  </TableCell>
                  <TableCell>
                    {ch.is_active ? (
                      <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                        {t.providers_active}
                      </Badge>
                    ) : (
                      <Badge className="bg-neutral-500/15 text-neutral-700 dark:text-neutral-400">
                        {t.providers_inactive}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onTest(ch.id)}
                    >
                      {t.notif_test}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => onDelete(ch.id)}
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
