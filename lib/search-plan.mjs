/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function clean(value, maxLength = 120) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function uniqueVariants(values) {
  const seen = new Set();
  const unique = [];
  for (const [index, raw] of values.entries()) {
    const value = clean(raw, 80);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    unique.push({ value, originalIndex: index });
  }
  return unique;
}

export function isAdultDob(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
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

function uniqueBirthCriteria(values) {
  const seen = new Set();
  const unique = [];
  for (const raw of Array.isArray(values) ? values : []) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.kind === "dob" && isAdultDob(raw.value)) {
      const key = `dob:${raw.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({ kind: "dob", value: raw.value });
      }
      continue;
    }
    const age = Number(raw.value);
    if (raw.kind === "age" && Number.isInteger(age) && age >= 18 && age <= 120) {
      const key = `age:${age}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({ kind: "age", value: age });
      }
    }
  }
  return unique;
}

export function formatBirthCriterion(criterion) {
  if (criterion?.kind === "dob") return `DOB ${criterion.value}`;
  if (criterion?.kind === "age") return `Age ${criterion.value}`;
  return "Birth detail";
}

export function planSearchQueue(
  voterNameVariants,
  relativeNameVariants,
  birthCriteriaOrLimit = [],
  limit = 18,
) {
  const names = uniqueVariants(Array.isArray(voterNameVariants) ? voterNameVariants : []);
  const relatives = uniqueVariants(
    Array.isArray(relativeNameVariants) ? relativeNameVariants : [],
  );
  if (names.length === 0 || relatives.length === 0) return [];
  const legacyCall = typeof birthCriteriaOrLimit === "number";
  const legacyMode = legacyCall || arguments.length < 3;
  const birthCriteria = legacyCall
    ? []
    : uniqueBirthCriteria(birthCriteriaOrLimit);
  if (!legacyCall && arguments.length >= 3 && birthCriteria.length === 0) {
    return [];
  }
  const requestedLimit = legacyCall
    ? birthCriteriaOrLimit
    : legacyMode
      ? 6
      : limit;
  const boundedLimit = Math.max(
    1,
    Math.min(18, Number(requestedLimit) || (legacyMode ? 6 : 18)),
  );
  const positions = [[0, 0]];

  const oneSideMax = Math.max(names.length, relatives.length);
  for (let index = 1; index < oneSideMax; index += 1) {
    if (index < names.length) positions.push([index, 0]);
    if (index < relatives.length) positions.push([0, index]);
  }
  for (let diagonal = 2; diagonal < names.length + relatives.length; diagonal += 1) {
    for (let nameIndex = 1; nameIndex < names.length; nameIndex += 1) {
      const relativeIndex = diagonal - nameIndex;
      if (relativeIndex > 0 && relativeIndex < relatives.length) {
        positions.push([nameIndex, relativeIndex]);
      }
    }
  }

  const seen = new Set();
  const queue = [];
  const births = birthCriteria.length > 0 ? birthCriteria : [null];
  for (const [nameIndex, relativeIndex] of positions) {
    for (const birth of births) {
      const name = names[nameIndex];
      const relative = relatives[relativeIndex];
      if (!name || !relative) continue;
      const birthKey = birth ? `${birth.kind}:${birth.value}` : "legacy";
      const key = `${name.value.toLocaleLowerCase()}\u0000${relative.value.toLocaleLowerCase()}\u0000${birthKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        name: name.value,
        relativeName: relative.value,
        ...(birth ? { birth } : {}),
        nameVariantIndex: name.originalIndex,
        relativeNameVariantIndex: relative.originalIndex,
      });
      if (queue.length >= boundedLimit) break;
    }
    if (queue.length >= boundedLimit) break;
  }
  return queue;
}

export function deduplicateCandidates(batches, limit = 10) {
  const boundedLimit = Math.max(1, Math.min(10, Number(limit) || 10));
  const byKey = new Map();
  for (const batch of Array.isArray(batches) ? batches : []) {
    for (const candidate of Array.isArray(batch) ? batch : []) {
      if (!candidate || typeof candidate !== "object") continue;
      const displayName = clean(candidate.displayName);
      const ageBand = clean(candidate.ageBand, 40) || "Not stated";
      const district = clean(candidate.district) || "Not stated";
      const constituency = clean(candidate.constituency) || "Not stated";
      if (!displayName) continue;
      const key = [displayName, ageBand, district, constituency]
        .map((value) => value.toLocaleLowerCase())
        .join("\u0000");
      const matchedOn = Array.isArray(candidate.matchedOn)
        ? candidate.matchedOn.map((item) => clean(item, 40)).filter(Boolean)
        : [];
      const existing = byKey.get(key);
      if (existing) {
        existing.matchedOn = [...new Set([...existing.matchedOn, ...matchedOn])].slice(
          0,
          8,
        );
        continue;
      }
      byKey.set(key, {
        id: "",
        displayName,
        match: "possible",
        ageBand,
        district,
        constituency,
        matchedOn: [...new Set(matchedOn)].slice(0, 8),
      });
      if (byKey.size >= boundedLimit) break;
    }
    if (byKey.size >= boundedLimit) break;
  }
  return [...byKey.values()].map((candidate, index) => ({
    ...candidate,
    id: `candidate-${String(index + 1).padStart(2, "0")}`,
  }));
}
