import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  SERVICE_DETAILS_FIELDS,
  serviceDetailsLabel,
  type ServiceDetailsForm,
  type ServiceDetailsKey,
  type ServiceDetailsKind,
} from "./service-details";

type ServiceDetailsFieldsProps = {
  kind: ServiceDetailsKind;
  value: ServiceDetailsForm;
  lang: Lang;
  onChange: (key: ServiceDetailsKey, value: string) => void;
  inputClassName: string;
  textareaClassName: string;
  /** Prefix of the input ids, unique per form. */
  idPrefix: string;
  labelClassName?: string;
};

/**
 * The own fields of a service kind (restaurant, transfer, tickets), all
 * optional; used by the staff service form and the patient's request form.
 */
export function ServiceDetailsFields({
  kind,
  value,
  lang,
  onChange,
  inputClassName,
  textareaClassName,
  idPrefix,
  labelClassName = "text-xs font-medium text-muted-foreground",
}: ServiceDetailsFieldsProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2" data-testid={`service-details-${kind}`}>
      {SERVICE_DETAILS_FIELDS[kind].map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const label = serviceDetailsLabel(field.key, lang);
        return (
          <label
            key={field.key}
            htmlFor={id}
            className={cn("space-y-1.5 text-sm", field.type === "textarea" && "sm:col-span-2")}
          >
            <span className={cn("block", labelClassName)}>{label}</span>
            {field.type === "textarea" ? (
              <textarea
                id={id}
                value={value[field.key]}
                maxLength={field.max}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={cn(textareaClassName, "min-h-20")}
                rows={3}
              />
            ) : (
              <Input
                id={id}
                type={field.type === "count" ? "number" : field.type === "time" ? "time" : "text"}
                inputMode={field.type === "count" ? "numeric" : undefined}
                min={field.type === "count" ? 1 : undefined}
                max={field.type === "count" ? field.max : undefined}
                step={field.type === "count" ? 1 : undefined}
                maxLength={field.type === "text" ? field.max : undefined}
                value={value[field.key]}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={inputClassName}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
