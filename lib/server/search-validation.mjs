/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const allowedStates = new Set([
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
const allowedGenders = new Set(["female", "male", "other"]);

function validAdultDob(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    year < 1900
  ) {
    return false;
  }
  const now = new Date();
  const adultCutoff = new Date(
    Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
  );
  return parsed <= adultCutoff;
}

export function validateSearchInput(value) {
  if (!value || typeof value !== "object") return false;
  const input = value;
  const ageValid =
    input.age === undefined ||
    (typeof input.age === "number" &&
      Number.isInteger(input.age) &&
      input.age >= 18 &&
      input.age <= 120);
  const dobValid =
    input.dob === undefined || validAdultDob(input.dob);
  const exactlyOneBirthDetail =
    (input.age !== undefined) !== (input.dob !== undefined);

  return (
    allowedStates.has(String(input.state)) &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    input.name.length <= 80 &&
    typeof input.relativeName === "string" &&
    input.relativeName.trim().length > 0 &&
    input.relativeName.length <= 80 &&
    allowedGenders.has(String(input.gender)) &&
    ageValid &&
    dobValid &&
    exactlyOneBirthDetail &&
    (input.district === undefined ||
      (typeof input.district === "string" && input.district.length <= 80))
  );
}
