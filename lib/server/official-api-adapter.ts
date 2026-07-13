/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SupportedState = "karnataka" | "west_bengal" | "odisha";

export type SearchRequest = {
  state: SupportedState;
  name: string;
  relativeName: string;
  age?: number;
  dob?: string;
  gender: "female" | "male" | "other";
  district?: string;
};

export type CandidateSummary = {
  id: string;
  displayName: string;
  match: "possible";
  ageBand: string;
  district: string;
  constituency: string;
  matchedOn: string[];
};

export type StartedSearch = {
  caseId: string;
  captchaImage: string;
  expiresAt: string;
};

export interface OfficialApiAdapter {
  startSearch(input: SearchRequest): Promise<StartedSearch>;
  submitSearch(caseId: string, captchaAnswer: string): Promise<CandidateSummary[]>;
  cancelSearch(caseId: string): Promise<void>;
}
