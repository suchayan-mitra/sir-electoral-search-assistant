/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CandidateSummary, SearchRequest } from "../server/official-api-adapter";

export const EXTENSION_CHANNEL = "matsetu-extension/v1";

export type ExtensionState = "checking" | "available" | "missing";

export type ExtensionToPageMessage =
  | { type: "READY"; version: string }
  | { type: "STARTED"; requestId: string }
  | {
      type: "CAPTCHA_READY";
      requestId: string;
      captchaImage: string;
      expiresAt?: string;
    }
  | { type: "RESULTS"; requestId: string; candidates: CandidateSummary[] }
  | { type: "ERROR"; requestId?: string; error: string };

type PageToExtensionMessage =
  | { type: "PING" }
  | { type: "START"; requestId: string; search: SearchRequest }
  | { type: "SUBMIT"; requestId: string; captchaAnswer: string }
  | { type: "CANCEL"; requestId: string };

function cleanText(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function parseCandidates(value: unknown): CandidateSummary[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const candidates: CandidateSummary[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const displayName = cleanText(row.displayName);
    const ageBand = cleanText(row.ageBand, 40);
    const district = cleanText(row.district);
    const constituency = cleanText(row.constituency);
    if (!displayName || !ageBand || !district || !constituency) return null;
    const matchedOn = Array.isArray(row.matchedOn)
      ? row.matchedOn.map((item) => cleanText(item, 40)).filter(Boolean)
      : [];
    if (matchedOn.length === 0 || matchedOn.length > 5) return null;
    candidates.push({
      id: `candidate-${String(index + 1).padStart(2, "0")}`,
      displayName,
      match: "possible",
      ageBand,
      district,
      constituency,
      matchedOn: matchedOn as string[],
    });
  }
  return candidates;
}

export function parseExtensionMessage(
  event: MessageEvent,
): ExtensionToPageMessage | null {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return null;
  }
  const data = event.data as Record<string, unknown>;
  if (
    data.channel !== EXTENSION_CHANNEL ||
    data.direction !== "to-page" ||
    typeof data.type !== "string"
  ) {
    return null;
  }
  if (data.type === "READY") {
    const version = cleanText(data.version, 24);
    return version ? { type: "READY", version } : null;
  }
  const requestId = cleanText(data.requestId, 64);
  if (data.type === "STARTED" && requestId) {
    return { type: "STARTED", requestId };
  }
  if (data.type === "CAPTCHA_READY" && requestId) {
    const captchaImage =
      typeof data.captchaImage === "string" ? data.captchaImage : "";
    if (
      !/^data:image\/(?:jpe?g|png);base64,/i.test(captchaImage) ||
      captchaImage.length < 200 ||
      captchaImage.length > 200_000
    ) {
      return null;
    }
    return {
      type: "CAPTCHA_READY",
      requestId,
      captchaImage,
      ...(typeof data.expiresAt === "string"
        ? { expiresAt: data.expiresAt }
        : {}),
    };
  }
  if (data.type === "RESULTS" && requestId) {
    const candidates = parseCandidates(data.candidates);
    return candidates ? { type: "RESULTS", requestId, candidates } : null;
  }
  if (data.type === "ERROR") {
    const error = cleanText(data.error, 240);
    return error
      ? {
          type: "ERROR",
          error,
          ...(requestId ? { requestId } : {}),
        }
      : null;
  }
  return null;
}

export function sendExtensionMessage(message: PageToExtensionMessage): void {
  window.postMessage(
    {
      channel: EXTENSION_CHANNEL,
      direction: "to-extension",
      ...message,
    },
    window.location.origin,
  );
}
