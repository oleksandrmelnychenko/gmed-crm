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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminCustomFieldsPage() {
  const { t } = useLang();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // create dialog
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
      /* keep empty */
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
        /* ignore */
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.cf_title}</h1>
          <p className="text-muted-foreground text-sm">{t.cf_subtitle}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 size-4" />
          {t.cf_new}
        </Button>
      </div>

      {msg && <p className="text-destructive text-sm">{msg}</p>}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.cf_new}</DialogTitle>
            <DialogDescription>{t.cf_subtitle}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{t.cf_entity_type}</Label>
                <Select value={fEntity} onValueChange={(value) => setFEntity(value ?? ENTITY_TYPES[0] ?? "patient")}>
                  <SelectTrigger>
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
              <div className="space-y-1">
                <Label>{t.cf_field_key} *</Label>
                <Input
                  required
                  placeholder="my_field"
                  value={fKey}
                  onChange={(e) => setFKey(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{t.cf_field_label} *</Label>
                <Input
                  required
                  value={fLabel}
                  onChange={(e) => setFLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t.cf_field_type}</Label>
                <Select value={fType} onValueChange={(value) => setFType(value ?? FIELD_TYPES[0] ?? "text")}>
                  <SelectTrigger>
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
              <div className="space-y-1">
                <Label>{t.cf_sort}</Label>
                <Input
                  type="number"
                  value={fSort}
                  onChange={(e) => setFSort(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t.cf_options}</Label>
                <Input
                  placeholder='["opt1","opt2"]'
                  value={fOptions}
                  onChange={(e) => setFOptions(e.target.value)}
                />
              </div>
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
      ) : (
        <div className="rounded-xl border bg-white dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-semibold">
              {t.cf_title} ({activeFields.length})
            </h2>
            <Select value={filterEntity} onValueChange={(value) => setFilterEntity(value ?? "")}>
              <SelectTrigger className="w-[160px]">
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
          </div>
          {activeFields.length === 0 ? (
            <p className="text-muted-foreground px-6 py-10 text-center text-sm">
              {t.cf_no_fields}
            </p>
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
        </div>
      )}
    </div>
  );
}
