/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CandidateSummary, SearchRequest } from "../server/official-api-adapter";

export const EXTENSION_CHANNEL = "sir-assist-extension/v1";
export const OFFICIAL_ECI_API_ORIGIN = "https://gateway-voters.eci.gov.in";
export const OFFICIAL_ECI_SEARCH_PATH =
  "/api/v1/elastic/search-by-details-from-state-display-v1";
const OFFICIAL_REQUEST_ENVELOPE_KEYS = [
  "encryptedPayload",
  "encryptedKey",
  "iv",
] as const;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METADATA_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/;
const SCHEMA_PATH_PATTERN =
  /^(?:\$|[A-Za-z_$][A-Za-z0-9_$-]{0,63})(?:\[\])?(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63})(?:\[\])?)*$/;

export type OfficialApiObservation = {
  transport: "fetch" | "xhr";
  method: "POST";
  endpoint: {
    origin: typeof OFFICIAL_ECI_API_ORIGIN;
    path: typeof OFFICIAL_ECI_SEARCH_PATH;
    queryKeys: string[];
  };
  status: number;
  request: {
    topLevelKeys: string[];
    nestedKeys: string[];
  };
  response: {
    topLevelKeys: string[];
    schemaKeys: string[];
    arrayLengths: Array<{ path: string; length: number }>;
  };
};

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
  | {
      type: "API_OBSERVATION";
      requestId: string;
      observation: OfficialApiObservation;
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

function parseMetadataKeys(
  value: unknown,
  maxItems: number,
  kind: "key" | "path" = "key",
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of value) {
    if (
      typeof key !== "string" ||
      key.length < 1 ||
      key.length > 120 ||
      !(kind === "path"
        ? SCHEMA_PATH_PATTERN.test(key)
        : METADATA_KEY_PATTERN.test(key)) ||
      seen.has(key)
    ) {
      return null;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function parseApiObservation(value: unknown): OfficialApiObservation | null {
  if (!isPlainRecord(value)) return null;
  if (
    !hasExactKeys(value, [
      "transport",
      "method",
      "endpoint",
      "status",
      "request",
      "response",
    ])
  ) {
    return null;
  }
  const transports = new Set(["fetch", "xhr"]);
  if (!transports.has(String(value.transport)) || value.method !== "POST") {
    return null;
  }
  if (
    !Number.isInteger(value.status) ||
    Number(value.status) < 0 ||
    Number(value.status) > 599
  ) {
    return null;
  }

  const endpoint = value.endpoint;
  if (
    !isPlainRecord(endpoint) ||
    !hasExactKeys(endpoint, ["origin", "path", "queryKeys"]) ||
    endpoint.origin !== OFFICIAL_ECI_API_ORIGIN ||
    endpoint.path !== OFFICIAL_ECI_SEARCH_PATH
  ) {
    return null;
  }
  const queryKeys = parseMetadataKeys(endpoint.queryKeys, 16);
  if (!queryKeys || queryKeys.length !== 0) return null;

  const request = value.request;
  if (
    !isPlainRecord(request) ||
    !hasExactKeys(request, ["topLevelKeys", "nestedKeys"])
  ) {
    return null;
  }
  const requestTopLevelKeys = parseMetadataKeys(request.topLevelKeys, 32);
  const requestNestedKeys = parseMetadataKeys(request.nestedKeys, 64, "path");
  if (
    !requestTopLevelKeys ||
    !requestNestedKeys ||
    requestNestedKeys.length !== 0 ||
    requestTopLevelKeys.length !== OFFICIAL_REQUEST_ENVELOPE_KEYS.length ||
    !OFFICIAL_REQUEST_ENVELOPE_KEYS.every((key) =>
      requestTopLevelKeys.includes(key),
    )
  ) {
    return null;
  }

  const response = value.response;
  if (
    !isPlainRecord(response) ||
    !hasExactKeys(response, ["topLevelKeys", "schemaKeys", "arrayLengths"]) ||
    !Array.isArray(response.arrayLengths) ||
    response.arrayLengths.length !== 0
  ) {
    return null;
  }
  const responseTopLevelKeys = parseMetadataKeys(response.topLevelKeys, 32);
  const responseSchemaKeys = parseMetadataKeys(response.schemaKeys, 64, "path");
  if (
    !responseTopLevelKeys ||
    !responseSchemaKeys ||
    responseTopLevelKeys.length !== 0 ||
    responseSchemaKeys.length !== 0
  ) return null;

  return {
    transport: value.transport as OfficialApiObservation["transport"],
    method: value.method as OfficialApiObservation["method"],
    endpoint: {
      origin: OFFICIAL_ECI_API_ORIGIN,
      path: OFFICIAL_ECI_SEARCH_PATH,
      queryKeys,
    },
    status: Number(value.status),
    request: {
      topLevelKeys: requestTopLevelKeys,
      nestedKeys: requestNestedKeys,
    },
    response: {
      topLevelKeys: responseTopLevelKeys,
      schemaKeys: responseSchemaKeys,
      arrayLengths: [],
    },
  };
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
  if (data.type === "API_OBSERVATION" && requestId) {
    if (
      !REQUEST_ID_PATTERN.test(requestId) ||
      !hasExactKeys(data, [
        "channel",
        "direction",
        "source",
        "type",
        "requestId",
        "observation",
      ]) ||
      data.source !== "sir-assist-extension"
    ) {
      return null;
    }
    const observation = parseApiObservation(data.observation);
    return observation
      ? { type: "API_OBSERVATION", requestId, observation }
      : null;
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
