import { expect, test } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  ensureLiveBackendHealthy,
} from "./support/live-helpers";

test.describe("auth sessions live API", () => {
  test("login rejects wrong password against live backend", async ({
    request,
  }) => {
    const [scenario, state] = await Promise.all([
      bootstrapFullSmokeScenario(request),
      ensureLiveBackendHealthy(),
    ]);
    const response = await request.post(
      `${state.backendUrl}/api/v1/auth/login`,
      {
        data: {
          email: scenario.credentials.pm.email,
          password: "definitely-not-the-bootstrap-password",
        },
      },
    );
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("unauthorized");
  });

  test("login succeeds and refresh rotates tokens on live backend", async ({
    request,
  }) => {
    const [scenario, state] = await Promise.all([
      bootstrapFullSmokeScenario(request),
      ensureLiveBackendHealthy(),
    ]);
    const loginResponse = await request.post(
      `${state.backendUrl}/api/v1/auth/login`,
      {
        data: {
          email: scenario.credentials.pm.email,
          password: scenario.credentials.password,
        },
      },
    );
    expect(loginResponse.status()).toBe(200);
    const loginJson = (await loginResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(loginJson.access_token.length).toBeGreaterThan(20);
    const refresh0 = loginJson.refresh_token;

    const refreshResponse = await request.post(
      `${state.backendUrl}/api/v1/auth/refresh`,
      {
        data: { refresh_token: refresh0 },
      },
    );
    expect(refreshResponse.status()).toBe(200);
    const refreshJson = (await refreshResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(refreshJson.refresh_token).not.toBe(refresh0);

    const reuseResponse = await request.post(
      `${state.backendUrl}/api/v1/auth/refresh`,
      {
        data: { refresh_token: refresh0 },
      },
    );
    expect(reuseResponse.status()).toBe(401);
    const reuseBody = await reuseResponse.json();
    expect(reuseBody.error).toBe("token_theft_detected");

    const afterTheftResponse = await request.post(
      `${state.backendUrl}/api/v1/auth/refresh`,
      {
        data: { refresh_token: refreshJson.refresh_token },
      },
    );
    expect(afterTheftResponse.status()).toBe(401);
    const afterTheftBody = await afterTheftResponse.json();
    expect(afterTheftBody.error).toBe("session_revoked");
  });
});
