import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCcw } from "lucide-react";

import {
  AdminTableCard,
  AdminToolbar,
} from "@/components/admin-page-patterns";
import {
  Banner,
  EmptyCell,
  PageHeader,
  TabLoader,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface CustomField {
  id: string;
  entity_type: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: unknown;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

const ENTITY_TYPES = ["lead", "patient", "order", "provider"] as const;
const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;

export function AdminCustomFieldsPage() {
  const { t } = useLang();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [fEntity, setFEntity] = useState("lead");
  const [fKey, setFKey] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fType, setFType] = useState("text");
  const [fSort, setFSort] = useState("0");
  const [fOptions, setFOptions] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filterEntity
        ? `/admin/custom-fields?entity_type=${filterEntity}`
        : "/admin/custom-fields";
      setFields(await apiFetch<CustomField[]>(url));
    } catch {
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, [filterEntity]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    let opts: unknown = undefined;
    if (fOptions.trim()) {
      try {
        opts = JSON.parse(fOptions);
      } catch {
        opts = null;
      }
    }
    try {
      await apiFetch("/admin/custom-fields", {
        method: "POST",
        body: JSON.stringify({
          entity_type: fEntity,
          field_key: fKey,
          field_label: fLabel,
          field_type: fType,
          options: opts ?? null,
          is_required: false,
          sort_order: parseInt(fSort, 10) || 0,
        }),
      });
      setShowCreate(false);
      setFKey("");
      setFLabel("");
      setFOptions("");
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (id: string) => {
    await apiFetch(`/admin/custom-fields/${id}/delete`, { method: "POST" });
    void load();
  };

  const activeFields = fields.filter((f) => f.is_active);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.cf_title}
        description={t.cf_subtitle}
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
              {t.cf_new}
            </Button>
          </>
        )}
      />

      {msg ? <Banner tone="error">{msg}</Banner> : null}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.cf_new}</DialogTitle>
            <DialogDescription>{t.cf_subtitle}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_entity_type}</Label>
                <Select value={fEntity} onValueChange={(value) => setFEntity(value ?? ENTITY_TYPES[0] ?? "patient")}>
                  <SelectTrigger className="h-9 rounded-lg bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map((et) => (
                      <SelectItem key={et} value={et}>
                        {et.charAt(0).toUpperCase() + et.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_key} *</Label>
                <Input
                  required
                  placeholder="my_field"
                  value={fKey}
                  onChange={(e) => setFKey(e.target.value)}
                  className="h-9 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_label} *</Label>
                <Input
                  required
                  value={fLabel}
                  onChange={(e) => setFLabel(e.target.value)}
                  className="h-9 rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_field_type}</Label>
                <Select value={fType} onValueChange={(value) => setFType(value ?? FIELD_TYPES[0] ?? "text")}>
                  <SelectTrigger className="h-9 rounded-lg bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft} value={ft}>
                        {ft.charAt(0).toUpperCase() + ft.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_sort}</Label>
                <Input
                  type="number"
                  value={fSort}
                  onChange={(e) => setFSort(e.target.value)}
                  className="h-9 rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight">{t.cf_options}</Label>
                <Input
                  placeholder='["opt1","opt2"]'
                  value={fOptions}
                  onChange={(e) => setFOptions(e.target.value)}
                  className="h-9 rounded-lg"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setShowCreate(false)}
              >
                {t.common_cancel}
              </Button>
              <Button type="submit" className="h-9 rounded-lg">{t.common_save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? <TabLoader /> : null}

      {!loading ? (
        <AdminTableCard
          title={t.cf_title}
          description={t.cf_subtitle}
          count={activeFields.length}
        >
          <div className="border-b border-border px-4 py-3">
            <AdminToolbar>
              <Select value={filterEntity} onValueChange={(value) => setFilterEntity(value ?? "")}>
                <SelectTrigger className="h-8 w-[180px] rounded-lg bg-card text-[13px]">
                  <SelectValue placeholder={t.providers_all} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t.providers_all}</SelectItem>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>
                      {et.charAt(0).toUpperCase() + et.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </AdminToolbar>
          </div>

          {activeFields.length === 0 ? (
            <div className="p-4">
              <EmptyCell>{t.cf_no_fields}</EmptyCell>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.cf_entity_type}</TableHead>
                  <TableHead>{t.cf_field_key}</TableHead>
                  <TableHead>{t.cf_field_label}</TableHead>
                  <TableHead>{t.cf_field_type}</TableHead>
                  <TableHead>{t.cf_required}</TableHead>
                  <TableHead>{t.users_actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeFields.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">
                        {f.entity_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {f.field_key}
                    </TableCell>
                    <TableCell className="font-medium">
                      {f.field_label}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-neutral-500/15 text-neutral-700 dark:text-neutral-400">
                        {f.field_type}
                      </Badge>
                    </TableCell>
                    <TableCell>{f.is_required ? "\u2713" : ""}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onDelete(f.id)}
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
  );
}
