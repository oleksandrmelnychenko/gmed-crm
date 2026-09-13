import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/api";
import {
  discardOrderDraft,
  discardRepeatIntake,
  fetchRepeatIntakes,
} from "./repeat-intakes-api";

describe("repeat intake API", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("loads only current repeat-intake drafts without a cache", async () => {
    vi.mocked(apiFetch).mockResolvedValue([]);

    await fetchRepeatIntakes("patient-1");

    expect(apiFetch).toHaveBeenCalledWith("/patients/patient-1/repeat-intakes", {
      forceFresh: true,
    });
  });

  it("discards a draft through the audited archive workflow", async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await discardRepeatIntake("lead-1");

    expect(apiFetch).toHaveBeenCalledWith("/leads/lead-1/failed-flow", {
      method: "POST",
      body: JSON.stringify({
        resolution: "archive",
        reason: "draft_discarded",
      }),
    });
  });

  it("archives a linked repeat-intake draft", async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await discardOrderDraft("order-1", "lead-1");

    expect(apiFetch).toHaveBeenCalledWith("/leads/lead-1/failed-flow", {
      method: "POST",
      body: JSON.stringify({
        resolution: "archive",
        reason: "draft_discarded",
      }),
    });
  });

  it("cancels a legacy order draft without erasing its history", async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await discardOrderDraft("order-1");

    expect(apiFetch).toHaveBeenCalledWith("/orders/order-1/status", {
      method: "POST",
      body: JSON.stringify({
        status: "cancelled",
        note: "draft_discarded",
      }),
    });
  });
});
