import { apiFetch } from "@/lib/api";

export type WorkTypeDescription = {
  id?: string;
  language_code: string;
  body: string;
  sort_order: number;
  is_active: boolean;
};

export type SpecializationWorkType = {
  id: string;
  specialization_id: string;
  code: string;
  name_de: string;
  name_ru: string;
  min_price_eur: number;
  max_price_eur: number;
  sort_order: number;
  is_active: boolean;
  descriptions: WorkTypeDescription[];
};

export type WorkTypeUpsertPayload = Omit<
  SpecializationWorkType,
  "id" | "specialization_id"
>;

type CreateResponse = {
  id: string;
};

type WorkTypesResponse =
  | SpecializationWorkType[]
  | {
      items?: SpecializationWorkType[];
      work_types?: SpecializationWorkType[];
      data?: SpecializationWorkType[];
    };

function workTypesPath(specializationId: string, includeInactive = false) {
  const basePath = `/providers/specializations/${specializationId}/work-types`;
  return includeInactive ? `${basePath}?include_inactive=true` : basePath;
}

function workTypePath(specializationId: string, workTypeId: string) {
  return `${workTypesPath(specializationId)}/${workTypeId}`;
}

function numberOrZero(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeDescription(
  description: WorkTypeDescription,
  index: number,
): WorkTypeDescription {
  return {
    ...description,
    language_code: description.language_code || "de",
    body: description.body ?? "",
    sort_order: numberOrZero(description.sort_order) || (index + 1) * 10,
    is_active: description.is_active ?? true,
  };
}

function normalizeWorkType(item: SpecializationWorkType): SpecializationWorkType {
  return {
    ...item,
    code: item.code ?? "",
    name_de: item.name_de ?? "",
    name_ru: item.name_ru ?? "",
    min_price_eur: numberOrZero(item.min_price_eur),
    max_price_eur: numberOrZero(item.max_price_eur),
    sort_order: numberOrZero(item.sort_order) || 1000,
    is_active: item.is_active ?? true,
    descriptions: Array.isArray(item.descriptions)
      ? item.descriptions.map(normalizeDescription)
      : [],
  };
}

function responseItems(response: WorkTypesResponse) {
  if (Array.isArray(response)) {
    return response;
  }
  return response.items ?? response.work_types ?? response.data ?? [];
}

export function fetchSpecializationWorkTypes(
  specializationId: string,
  includeInactive = false,
) {
  return apiFetch<WorkTypesResponse>(
    workTypesPath(specializationId, includeInactive),
    {
      forceFresh: true,
    },
  ).then((response) => responseItems(response).map(normalizeWorkType));
}

export function createSpecializationWorkType(
  specializationId: string,
  payload: WorkTypeUpsertPayload,
) {
  return apiFetch<CreateResponse>(workTypesPath(specializationId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSpecializationWorkType(
  specializationId: string,
  workTypeId: string,
  payload: WorkTypeUpsertPayload,
) {
  return apiFetch<void>(workTypePath(specializationId, workTypeId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSpecializationWorkType(
  specializationId: string,
  workTypeId: string,
) {
  return apiFetch<void>(workTypePath(specializationId, workTypeId), {
    method: "DELETE",
  });
}
