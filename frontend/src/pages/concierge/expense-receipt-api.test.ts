import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());
const downloadApiFileMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  apiFetch: apiFetchMock,
  buildApiUrl: vi.fn(),
  downloadApiFile: downloadApiFileMock,
  getAccessToken: vi.fn(),
  refreshAuthSession: vi.fn(),
}));

import {
  downloadTaskExpenseReceipt,
  getTaskExpenseContext,
  getTaskExpenses,
} from "./expense-receipt-api";

describe("task expense API", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    downloadApiFileMock.mockReset();
  });

  it("loads context and expenses by task id", async () => {
    apiFetchMock.mockResolvedValue({});

    await getTaskExpenseContext("task-1");
    await getTaskExpenses("task-1");

    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      "/tasks/task-1/expense-context",
      { forceFresh: true },
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      "/tasks/task-1/expenses",
      { forceFresh: true },
    );
  });

  it("downloads a receipt through the task endpoint", async () => {
    downloadApiFileMock.mockResolvedValue(undefined);

    await downloadTaskExpenseReceipt("task-1", "expense-1", "receipt.pdf");

    expect(downloadApiFileMock).toHaveBeenCalledWith(
      "/tasks/task-1/expenses/expense-1/receipt",
      "receipt.pdf",
    );
  });
});
