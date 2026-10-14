import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@/lib/realtime";
import { useLeadPortalIntake } from "./lead-portal-intake";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("../data/lead-portal-intake-api", () => ({ fetchLeadPortalIntake: mocks.fetch }));
vi.mock("@/lib/realtime", () => ({ useRealtimeSubscription: mocks.subscribe }));

function subscribe(enabled = true) {
  const onPatientEvent = vi.fn();
  function Harness() {
    useLeadPortalIntake("lead-current", enabled, onPatientEvent);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const [types, callback] = mocks.subscribe.mock.calls.at(-1) as [string[], (event: RealtimeEvent) => void];
  const emit = (type: string, entityId = "lead-current", payload: Record<string, unknown> = {}) => {
    if (types.includes(type)) callback({ type, entity_type: "lead", entity_id: entityId, payload });
  };
  return { emit, onPatientEvent };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(null);
});

describe("staff wizard portal intake realtime refresh", () => {
  it("reloads after a staff country edit without treating it as a patient edit", async () => {
    const { emit, onPatientEvent } = subscribe();
    emit("lead.updated", "lead-current", { country: "RU" });
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("lead-current");
    expect(onPatientEvent).not.toHaveBeenCalled();
    await Promise.resolve();
  });

  it("keeps patient notifications for portal edits and excludes staff review events", async () => {
    const { emit, onPatientEvent } = subscribe();
    emit("lead.portal_updated", "lead-current", { access_kind: "guardian", change: "personal_data" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(onPatientEvent).toHaveBeenCalledTimes(1);
    emit("lead.portal_updated", "lead-current", { change: "document_reviewed" });
    emit("lead.updated", "lead-current", { access_kind: "self" });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(onPatientEvent).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it("ignores other leads and a closed wizard", () => {
    const active = subscribe();
    active.emit("lead.updated", "lead-other", { country: "RU" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    const closed = subscribe(false);
    closed.emit("lead.updated");
    closed.emit("lead.portal_updated", "lead-current", { access_kind: "self" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(closed.onPatientEvent).not.toHaveBeenCalled();
  });
});
