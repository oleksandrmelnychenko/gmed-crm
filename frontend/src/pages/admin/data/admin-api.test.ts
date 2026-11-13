import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  downloadApiFile: vi.fn(),
}));

import { fetchAdminSessionsPage, normalizeAdminSessionsPage } from "./admin-api";

describe("active sessions list (server pages, final-D S3-4)", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("asks the server for one page by offset", async () => {
    apiFetchMock.mockResolvedValue({ items: [{ id: "a" }], total: 120, offset: 100, limit: 50 });
    const page = await fetchAdminSessionsPage<{ id: string }>(2);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/admin/sessions?offset=100&limit=50",
      expect.any(Object),
    );
    expect(page).toEqual({ items: [{ id: "a" }], total: 120, offset: 100, limit: 50 });
  });

  it("reads an older server's bare list as one page", () => {
    expect(normalizeAdminSessionsPage([{ id: "a" }, { id: "b" }], 0)).toEqual({
      items: [{ id: "a" }, { id: "b" }],
      total: 2,
      offset: 0,
      limit: 2,
    });
    expect(normalizeAdminSessionsPage(null, 50)).toEqual({
      items: [],
      total: 50,
      offset: 50,
      limit: 50,
    });
  });
});
