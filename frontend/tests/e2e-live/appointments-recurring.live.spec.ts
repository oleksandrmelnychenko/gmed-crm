import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  setGermanLanguage,
  type LiveApiClient,
} from "./support/live-helpers";

type SeriesOccurrence = {
  id: string;
  title: string;
  status: string;
  recurrence_series_id: string | null;
  recurrence_index: number;
  date: string;
};

function addDaysIso(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

async function fetchPatientAppointments(
  request: APIRequestContext,
  api: LiveApiClient,
  patientId: string,
): Promise<SeriesOccurrence[]> {
  const response = await request.get(
    `${api.backendUrl}/api/v1/appointments?patient_id=${patientId}`,
    { headers: api.headers },
  );
  if (!response.ok()) {
    throw new Error(
      `List appointments failed: ${response.status()} ${await response.text()}`,
    );
  }
  return (await response.json()) as SeriesOccurrence[];
}

async function fetchSeriesOccurrences(
  request: APIRequestContext,
  api: LiveApiClient,
  patientId: string,
  seriesId: string,
): Promise<SeriesOccurrence[]> {
  const items = await fetchPatientAppointments(request, api, patientId);
  return items
    .filter((item) => item.recurrence_series_id === seriesId)
    .sort((a, b) => a.recurrence_index - b.recurrence_index);
}

test.describe("appointments recurring live workflows", () => {
  test("patient manager can cancel a whole recurring series from the detail drawer", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await page.goto(`/appointments?appointment=${scenario.recurring_appointment.id}`);
    await expect(
      page.getByText(scenario.recurring_appointment.title).first(),
    ).toBeVisible();

    const statusScopeSelect = page.getByRole("combobox", {
      name: /Statusänderung anwenden auf/i,
    });
    await expect(statusScopeSelect).toBeVisible();
    await statusScopeSelect.selectOption("series");

    const cancelWholeSeriesButton = page
      .getByRole("button", { name: /Ganze Serie absagen/i })
      .last();
    await expect(cancelWholeSeriesButton).toBeVisible();
    await cancelWholeSeriesButton.click();

    await expect(page.getByText(/^cancelled$/i)).toHaveCount(4);

    await expect(async () => {
      const refreshed = await fetchSeriesOccurrences(
        request,
        api,
        scenario.patient.id,
        scenario.recurring_appointment.series_id,
      );
      expect(refreshed).toHaveLength(3);
      for (const item of refreshed) {
        expect(item.status).toBe("cancelled");
        expect(item.recurrence_series_id).toBe(
          scenario.recurring_appointment.series_id,
        );
      }
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager cancelling a single occurrence leaves the rest of the series active", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const initialSeries = await fetchSeriesOccurrences(
      request,
      api,
      scenario.patient.id,
      scenario.recurring_appointment.series_id,
    );
    expect(initialSeries).toHaveLength(3);
    expect(initialSeries.every((item) => item.status !== "cancelled")).toBe(
      true,
    );

    await page.goto(
      `/appointments?appointment=${scenario.recurring_appointment.id}`,
    );
    await expect(
      page.getByText(scenario.recurring_appointment.title).first(),
    ).toBeVisible();

    const statusScopeSelect = page.getByRole("combobox", {
      name: /Statusänderung anwenden auf/i,
    });
    await expect(statusScopeSelect).toBeVisible();
    await expect(statusScopeSelect).toHaveValue("single");

    const cancelSingleButton = page
      .getByRole("button", { name: "Cancel this occurrence", exact: true })
      .last();
    await expect(cancelSingleButton).toBeVisible();
    await cancelSingleButton.click();

    await expect(async () => {
      const refreshed = await fetchSeriesOccurrences(
        request,
        api,
        scenario.patient.id,
        scenario.recurring_appointment.series_id,
      );
      expect(refreshed).toHaveLength(3);

      const current = refreshed.find(
        (item) => item.id === scenario.recurring_appointment.id,
      );
      expect(current?.status).toBe("cancelled");

      const others = refreshed.filter(
        (item) => item.id !== scenario.recurring_appointment.id,
      );
      expect(others).toHaveLength(2);
      for (const item of others) {
        expect(item.status).not.toBe("cancelled");
        expect(item.status).not.toBe("completed");
      }
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager renames every occurrence when saving with series scope", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await page.goto(
      `/appointments?appointment=${scenario.recurring_appointment.id}`,
    );
    await expect(
      page.getByText(scenario.recurring_appointment.title).first(),
    ).toBeVisible();

    const renamedTitle = `${scenario.recurring_appointment.title} – renamed`;

    const scheduleScopeSelect = page.getByRole("combobox", {
      name: /Terminänderung anwenden auf/i,
    });
    await expect(scheduleScopeSelect).toBeVisible();

    const editForm = page
      .locator("form")
      .filter({ has: scheduleScopeSelect })
      .first();

    const titleInput = editForm.getByLabel(/^Titel$/i).first();
    await titleInput.fill(renamedTitle);

    await scheduleScopeSelect.selectOption("series");

    await editForm.getByRole("button", { name: /^Speichern$/ }).click();

    await expect(async () => {
      const refreshed = await fetchSeriesOccurrences(
        request,
        api,
        scenario.patient.id,
        scenario.recurring_appointment.series_id,
      );
      expect(refreshed).toHaveLength(3);
      for (const item of refreshed) {
        expect(item.title).toBe(renamedTitle);
      }
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager can reshape the recurrence rule for the whole series", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const initialSeries = await fetchSeriesOccurrences(
      request,
      api,
      scenario.patient.id,
      scenario.recurring_appointment.series_id,
    );
    expect(initialSeries).toHaveLength(3);
    const firstDate = initialSeries[0]?.date;
    expect(firstDate).toBeTruthy();

    await page.goto(
      `/appointments?appointment=${scenario.recurring_appointment.id}`,
    );
    await expect(
      page.getByText(scenario.recurring_appointment.title).first(),
    ).toBeVisible();

    const scheduleScopeSelect = page.getByRole("combobox", {
      name: /Terminänderung anwenden auf/i,
    });
    await expect(scheduleScopeSelect).toBeVisible();

    const editForm = page
      .locator("form")
      .filter({ has: scheduleScopeSelect })
      .first();

    await scheduleScopeSelect.selectOption("series");
    await editForm
      .getByRole("combobox", { name: /Repeat frequency/i })
      .selectOption("weekly");
    await editForm.getByLabel(/Repeat every/i).fill("2");
    await editForm.getByLabel(/Total occurrences/i).fill("4");
    await editForm.getByLabel(/Repeat until/i).fill("");
    const updateRequestPromise = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        candidate.url().includes(
          `/api/v1/appointments/${scenario.recurring_appointment.id}/update`,
        ),
    );
    const updateResponsePromise = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes(
          `/api/v1/appointments/${scenario.recurring_appointment.id}/update`,
        ),
    );

    await editForm.getByRole("button", { name: /^Speichern$/ }).click();

    const updateRequest = await updateRequestPromise;
    const updatePayload = updateRequest.postDataJSON() as {
      recurrence_scope?: string;
      recurrence_frequency?: string | null;
      recurrence_interval?: number | null;
      recurrence_count?: number | null;
      recurrence_until?: string | null;
    };
    expect(updatePayload.recurrence_scope).toBe("series");
    expect(updatePayload.recurrence_frequency).toBe("weekly");
    expect(updatePayload.recurrence_interval).toBe(2);
    expect(updatePayload.recurrence_count).toBe(4);
    expect(updatePayload.recurrence_until).toBeNull();

    const updateResponse = await updateResponsePromise;
    const updateResponseText = await updateResponse.text();
    expect(updateResponse.ok(), updateResponseText).toBeTruthy();

    await expect(async () => {
      const refreshed = await fetchSeriesOccurrences(
        request,
        api,
        scenario.patient.id,
        scenario.recurring_appointment.series_id,
      );
      expect(refreshed).toHaveLength(4);
      expect(refreshed.map((item) => item.recurrence_index)).toEqual([
        0, 1, 2, 3,
      ]);
      expect(refreshed.map((item) => item.date)).toEqual([
        firstDate!,
        addDaysIso(firstDate!, 14),
        addDaysIso(firstDate!, 28),
        addDaysIso(firstDate!, 42),
      ]);
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager cancelling 'this and following' from the middle splits the series", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const initialSeries = await fetchSeriesOccurrences(
      request,
      api,
      scenario.patient.id,
      scenario.recurring_appointment.series_id,
    );
    expect(initialSeries).toHaveLength(3);
    expect(initialSeries.every((item) => item.status !== "cancelled")).toBe(
      true,
    );

    const middleOccurrence = initialSeries.find(
      (item) => item.recurrence_index === 1,
    );
    const lastOccurrence = initialSeries.find(
      (item) => item.recurrence_index === 2,
    );
    expect(middleOccurrence).toBeDefined();
    expect(lastOccurrence).toBeDefined();
    const middleId = middleOccurrence!.id;
    const lastId = lastOccurrence!.id;
    expect(middleId).not.toBe(scenario.recurring_appointment.id);

    await page.goto(`/appointments?appointment=${middleId}`);
    await expect(
      page.getByText(scenario.recurring_appointment.title).first(),
    ).toBeVisible();

    const statusScopeSelect = page.getByRole("combobox", {
      name: /Statusänderung anwenden auf/i,
    });
    await expect(statusScopeSelect).toBeVisible();
    await statusScopeSelect.selectOption("following");

    const statusSection = page
      .locator("section")
      .filter({ has: statusScopeSelect })
      .first();
    const cancelFollowingButton = statusSection.getByRole("button", {
      name: /Diesen und folgende absagen/i,
    });
    await expect(cancelFollowingButton).toBeVisible();
    await cancelFollowingButton.click();

    await expect(async () => {
      const items = await fetchPatientAppointments(
        request,
        api,
        scenario.patient.id,
      );

      const first = items.find(
        (item) => item.id === scenario.recurring_appointment.id,
      );
      const middle = items.find((item) => item.id === middleId);
      const last = items.find((item) => item.id === lastId);

      expect(first).toBeDefined();
      expect(middle).toBeDefined();
      expect(last).toBeDefined();

      expect(first!.recurrence_series_id).toBe(
        scenario.recurring_appointment.series_id,
      );
      expect(first!.status).not.toBe("cancelled");
      expect(first!.status).not.toBe("completed");

      expect(middle!.recurrence_series_id).not.toBeNull();
      expect(middle!.recurrence_series_id).not.toBe(
        scenario.recurring_appointment.series_id,
      );
      expect(last!.recurrence_series_id).toBe(middle!.recurrence_series_id);
      expect(middle!.status).toBe("cancelled");
      expect(last!.status).toBe("cancelled");
    }).toPass({ timeout: 15_000 });
  });
});
