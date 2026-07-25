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
  specialization_ids: string[];
  code: string;
  name_de: string;
  name_ru: string;
  name_en: string;
  name_es: string;
  min_price_eur: number;
  max_price_eur: number;
  duration_hours: number;
  sort_order: number;
  is_active: boolean;
  descriptions: WorkTypeDescription[];
};

export type SpecializationLinkedProvider = {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
  is_active: boolean;
  specialization_ids: string[];
};

export type WorkTypeUpsertPayload = Omit<
  SpecializationWorkType,
  "id" | "specialization_id" | "specialization_ids" | "code"
> & {
  code?: string;
  specialization_ids?: string[];
};

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
    specialization_ids:
      Array.isArray(item.specialization_ids) && item.specialization_ids.length > 0
        ? item.specialization_ids
        : [item.specialization_id].filter(Boolean),
    code: item.code ?? "",
    name_de: item.name_de ?? "",
    name_ru: item.name_ru ?? "",
    name_en: item.name_en ?? "",
    name_es: item.name_es ?? "",
    min_price_eur: numberOrZero(item.min_price_eur),
    max_price_eur: numberOrZero(item.max_price_eur),
    duration_hours: Math.min(
      50,
      Math.max(1, Math.trunc(numberOrZero(item.duration_hours) || 1)),
    ),
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

export function fetchProvidersBySpecializations(specializationIds: string[]) {
  const uniqueIds = [...new Set(specializationIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return Promise.resolve([] as SpecializationLinkedProvider[]);
  }
  const query = new URLSearchParams({
    specialization_ids: uniqueIds.join(","),
  });
  return apiFetch<SpecializationLinkedProvider[]>(
    `/providers/by-specializations?${query.toString()}`,
    { forceFresh: true },
  ).then((items) =>
    items.map((item) => ({
      ...item,
      name: item.name ?? "",
      provider_type: item.provider_type ?? "",
      address_city: item.address_city ?? null,
      is_active: item.is_active ?? true,
      specialization_ids: Array.isArray(item.specialization_ids)
        ? item.specialization_ids
        : [],
    })),
  );
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
