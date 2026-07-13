/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  "use strict";

  const CHANNEL = "matsetu-extension/v1";
  const APP_ORIGINS = Object.freeze([
    "https://matsetu-electoral-search-assistant.jukulda.workers.dev",
  ]);
  const ECI_ORIGIN = "https://electoralsearch.eci.gov.in";
  const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STATES = new Set(["karnataka", "west_bengal", "odisha"]);
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

  globalThis.MatsetuProtocol = Object.freeze({
    CHANNEL,
    APP_ORIGINS,
    ECI_ORIGIN,
    isPlainObject,
    isRequestId,
    validSearch,
    cleanText,
    ageBand,
    isCaptchaDataImage,
  });
})();
