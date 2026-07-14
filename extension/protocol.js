/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  "use strict";

  const CHANNEL = "sir-assist-extension/v1";
  const APP_ORIGINS = Object.freeze([
    "https://sir-electoral-search-assistant.jukulda.workers.dev",
  ]);
  const ECI_ORIGIN = "https://electoralsearch.eci.gov.in";
  const ECI_SEARCH_ORIGIN = "https://gateway-voters.eci.gov.in";
  const ECI_SEARCH_PATH = "/api/v1/elastic/search-by-details-from-state-display-v1";
  const API_OBSERVER_CONTROL_EVENT = "sir-assist-api-observer-control";
  const API_OBSERVATION_EVENT = "sir-assist-api-observation";
  const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STATES = new Set([
    "karnataka",
    "west_bengal",
    "odisha",
    "bihar",
    "chhattisgarh",
    "delhi",
    "jharkhand",
    "madhya_pradesh",
    "rajasthan",
    "uttar_pradesh",
    "uttarakhand",
  ]);
  const GENDERS = new Set(["female", "male", "other"]);
  const SEARCH_KEYS = new Set([
    "state",
    "name",
    "relativeName",
    "age",
    "dob",
    "gender",
    "district",
  ]);
  const OFFICIAL_REQUEST_ENVELOPE_KEYS = new Set([
    "encryptedPayload",
    "encryptedKey",
    "iv",
  ]);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isRequestId(value) {
    return typeof value === "string" && REQUEST_ID.test(value);
  }

  function isAdultDob(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const now = new Date();
    const adultCutoff = new Date(
      Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
    );
    return (
      year >= 1900 &&
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day &&
      parsed <= adultCutoff
    );
  }

  function validSearch(value) {
    if (!isPlainObject(value)) return false;
    if (Object.keys(value).some((key) => !SEARCH_KEYS.has(key))) return false;
    const hasAge = value.age !== undefined;
    const hasDob = value.dob !== undefined;
    return (
      STATES.has(value.state) &&
      typeof value.name === "string" &&
      value.name.trim().length > 0 &&
      value.name.length <= 80 &&
      typeof value.relativeName === "string" &&
      value.relativeName.trim().length > 0 &&
      value.relativeName.length <= 80 &&
      GENDERS.has(value.gender) &&
      hasAge !== hasDob &&
      (!hasAge || (Number.isInteger(value.age) && value.age >= 18 && value.age <= 120)) &&
      (!hasDob || isAdultDob(value.dob)) &&
      (value.district === undefined ||
        (typeof value.district === "string" && value.district.length <= 80))
    );
  }

  function cleanText(value, fallback = "Not stated", maxLength = 120) {
    if (typeof value !== "string") return fallback;
    const cleaned = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
    return cleaned || fallback;
  }

  function ageBand(value) {
    const age = Number.parseInt(String(value), 10);
    return Number.isFinite(age)
      ? `${Math.max(18, age - 2)}–${age + 2}`
      : "Not stated";
  }

  function isCaptchaDataImage(value) {
    return (
      typeof value === "string" &&
      /^data:image\/(?:jpe?g|png);base64,[A-Za-z0-9+/=]+$/i.test(value) &&
      value.length > 500 &&
      value.length < 200_000
    );
  }

  function exactKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every((key) => keys.includes(key));
  }

  function validKeyName(value) {
    return typeof value === "string" && /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/.test(value);
  }

  function validSchemaPath(value) {
    return (
      typeof value === "string" &&
      value.length <= 120 &&
      /^(?:\$|[A-Za-z_$][A-Za-z0-9_$-]{0,63})(?:\[\])?(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63})(?:\[\])?)*$/.test(value)
    );
  }

  function validStringArray(value, predicate, max = 64) {
    return (
      Array.isArray(value) &&
      value.length <= max &&
      new Set(value).size === value.length &&
      value.every(predicate)
    );
  }

  function isApiObservation(value) {
    if (
      !exactKeys(value, ["transport", "method", "endpoint", "status", "request", "response"]) ||
      !new Set(["fetch", "xhr"]).has(value.transport) ||
      value.method !== "POST" ||
      !Number.isInteger(value.status) ||
      value.status < 0 ||
      value.status > 599
    ) {
      return false;
    }
    if (
      !exactKeys(value.endpoint, ["origin", "path", "queryKeys"]) ||
      value.endpoint.origin !== ECI_SEARCH_ORIGIN ||
      value.endpoint.path !== ECI_SEARCH_PATH ||
      !validStringArray(value.endpoint.queryKeys, validKeyName, 16) ||
      value.endpoint.queryKeys.length !== 0
    ) {
      return false;
    }
    if (
      !exactKeys(value.request, ["topLevelKeys", "nestedKeys"]) ||
      !validStringArray(value.request.topLevelKeys, validKeyName, 32) ||
      !validStringArray(value.request.nestedKeys, validSchemaPath) ||
      value.request.nestedKeys.length !== 0 ||
      value.request.topLevelKeys.length !== OFFICIAL_REQUEST_ENVELOPE_KEYS.size ||
      !value.request.topLevelKeys.every((key) => OFFICIAL_REQUEST_ENVELOPE_KEYS.has(key))
    ) {
      return false;
    }
    if (
      !exactKeys(value.response, ["topLevelKeys", "schemaKeys", "arrayLengths"]) ||
      !Array.isArray(value.response.topLevelKeys) ||
      value.response.topLevelKeys.length !== 0 ||
      !Array.isArray(value.response.schemaKeys) ||
      value.response.schemaKeys.length !== 0 ||
      !Array.isArray(value.response.arrayLengths) ||
      value.response.arrayLengths.length !== 0
    ) {
      return false;
    }
    return true;
  }

  globalThis.SirAssistProtocol = Object.freeze({
    CHANNEL,
    APP_ORIGINS,
    ECI_ORIGIN,
    ECI_SEARCH_ORIGIN,
    ECI_SEARCH_PATH,
    API_OBSERVER_CONTROL_EVENT,
    API_OBSERVATION_EVENT,
    isPlainObject,
    isRequestId,
    validSearch,
    cleanText,
    ageBand,
    isCaptchaDataImage,
    isApiObservation,
  });
})();
