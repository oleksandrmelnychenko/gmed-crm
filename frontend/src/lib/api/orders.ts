import { get, post } from "./client";
import type {
  Order,
  OrderDetail,
  CreateOrderBody,
  CreateResponse,
  AddLeistungBody,
  PatientOption,
} from "./types";

export interface OrderSearchParams {
  search?: string;
  phase?: string;
  status?: string;
  provider_id?: string;
  doctor_id?: string;
}

export function fetchOrders(params?: OrderSearchParams): Promise<Order[]> {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) q.set(k, v);
    }
  }
  const qs = q.toString();
  return get<Order[]>(`/orders${qs ? `?${qs}` : ""}`);
}

export function fetchOrderDetail(id: string): Promise<OrderDetail> {
  return get<OrderDetail>(`/orders/${id}`);
}

export function createOrder(body: CreateOrderBody): Promise<CreateResponse> {
  return post<CreateResponse>("/orders", body);
}

export function advancePhase(id: string, phase: string): Promise<unknown> {
  return post(`/orders/${id}/phase`, { phase });
}

export function addLeistung(orderId: string, body: AddLeistungBody): Promise<unknown> {
  return post(`/orders/${orderId}/leistungen`, body);
}

/** Fetch patients for order dropdowns */
export function fetchPatientOptions(): Promise<PatientOption[]> {
  return get<PatientOption[]>("/patients");
}
