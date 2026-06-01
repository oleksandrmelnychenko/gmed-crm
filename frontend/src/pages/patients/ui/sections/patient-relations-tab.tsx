import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  EmptyCell,
  TabLoader,
} from "@/components/ui-shell";

import type { RelationItem } from "../../model/detail-tab-types";
import { FormSection } from "../shared/patient-form-primitives";

type Localize = (key: string) => string;

type PatientRelationsTabProps = {
  canManageRelations: boolean;
  formatDateTime: (value?: string | null, fallback?: string) => string;
  l: Localize;
  onCreateRelation: () => void;
  onDeleteRelation: (relationId: string) => void;
  onEditRelation: (relation: RelationItem) => void;
  onOpenPatient: (patientId: string) => void;
  relationTypeLabel: (value: string) => string;
  relations: RelationItem[];
  tabLoading: boolean;
};

export function PatientRelationsTab({
  canManageRelations,
  formatDateTime,
  l,
  onCreateRelation,
  onDeleteRelation,
  onEditRelation,
  onOpenPatient,
  relationTypeLabel,
  relations,
  tabLoading,
}: PatientRelationsTabProps) {
  return (
    <TabsContent value="relations" className="mt-4 min-h-[400px]">
      <FormSection
        title={l("patients_relations_and_emergency_contacts")}
        accessory={
          canManageRelations ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={onCreateRelation}
            >
              <Plus className="size-3.5" />
              {l("patients_new_relation")}
            </Button>
          ) : null
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : relations.length === 0 ? (
          <EmptyCell>{l("patients_not_recorded_yet")}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {relations.map((relation) => (
              <div
                key={relation.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">
                    {relation.related_display_name || relation.related_name}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {relationTypeLabel(relation.relation_type)}
                    </Badge>
                    {relation.is_emergency_contact ? (
                      <Badge
                        variant="outline"
                        className="rounded-full bg-rose-50 border-rose-200 text-rose-700 text-[10px]"
                      >
                        {l("patients_emergency")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-0.5 text-sm text-muted-foreground">
                  {relation.related_patient_pid ? (
                    <p className="font-mono text-xs text-muted-foreground/80">
                      {relation.related_patient_pid}
                    </p>
                  ) : null}
                  {relation.phone ? <p>{relation.phone}</p> : null}
                  {relation.notes ? <p className="text-foreground">{relation.notes}</p> : null}
                  <p className="text-xs text-muted-foreground/80">
                    {formatDateTime(relation.created_at)}
                  </p>
                </div>
                {canManageRelations || relation.related_patient_id ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {relation.related_patient_id ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => onOpenPatient(relation.related_patient_id as string)}
                      >
                        {l("patients_open_patient")}
                      </Button>
                    ) : null}
                    {canManageRelations ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => onEditRelation(relation)}
                        >
                          {l("patients_edit")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                          onClick={() => onDeleteRelation(relation.id)}
                        >
                          {l("patients_delete")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
