/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  CandidateSummary,
  OfficialApiAdapter,
  SearchRequest,
  StartedSearch,
} from "../lib/server/official-api-adapter";

export class OfficialApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OfficialApiError";
  }
}

export function isOfficialApiError(value: unknown): value is OfficialApiError {
  return (
    value instanceof Error &&
    value.name === "OfficialApiError" &&
    typeof (value as { status?: unknown }).status === "number"
  );
}

async function checkedJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new OfficialApiError(
      payload?.error ?? "The controlled official search could not be completed.",
      response.status >= 400 ? response.status : 502,
    );
  }
  return payload;
}

export class BrowserRunOfficialApiAdapter implements OfficialApiAdapter {
  constructor(private readonly sessions: DurableObjectNamespace) {}

  async startSearch(input: SearchRequest): Promise<StartedSearch> {
    const caseId = crypto.randomUUID();
    const admission = this.sessions.getByName("global-browser-admission");
    await checkedJson<{ admitted: true }>(
      await admission.fetch(
        new Request("https://case.internal/admit", {
          method: "POST",
          body: JSON.stringify({ action: "admit", caseId }),
        }),
      ),
    );
    try {
      const response = await this.sessions.getByName(caseId).fetch(
        new Request("https://case.internal/start", {
          method: "POST",
          body: JSON.stringify({ action: "start", search: input }),
        }),
      );
      const started = await checkedJson<Omit<StartedSearch, "caseId">>(response);
      return { ...started, caseId };
    } catch (error) {
      await this.releaseAdmission(caseId);
      throw error;
    }
  }

  async submitSearch(
    caseId: string,
    captchaAnswer: string,
  ): Promise<CandidateSummary[]> {
    try {
      const response = await this.sessions.getByName(caseId).fetch(
        new Request("https://case.internal/submit", {
          method: "POST",
          body: JSON.stringify({ action: "submit", captchaAnswer }),
        }),
      );
      const submitted = await checkedJson<{ candidates: CandidateSummary[] }>(
        response,
      );
      return submitted.candidates;
    } finally {
      await this.releaseAdmission(caseId);
    }
  }

  async cancelSearch(caseId: string): Promise<void> {
    try {
      const response = await this.sessions.getByName(caseId).fetch(
        new Request("https://case.internal/cancel", {
          method: "POST",
          body: JSON.stringify({ action: "cancel" }),
        }),
      );
      await checkedJson<{ cancelled: true }>(response);
    } finally {
      await this.releaseAdmission(caseId);
    }
  }

  private async releaseAdmission(caseId: string): Promise<void> {
    await this.sessions
      .getByName("global-browser-admission")
      .fetch(
        new Request("https://case.internal/release", {
          method: "POST",
          body: JSON.stringify({ action: "release", caseId }),
        }),
      )
      .catch(() => undefined);
  }
}
