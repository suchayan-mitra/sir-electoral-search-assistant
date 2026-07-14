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

export const MAX_AGE_ALTERNATIVES = 7;

export function parseAgeAlternatives(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return [];

  const range = /^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/.exec(trimmed);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 18 ||
      end > 120 ||
      end < start ||
      end - start + 1 > MAX_AGE_ALTERNATIVES
    ) {
      return null;
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  const exactPattern = new RegExp(
    `^\\d{1,3}(?:\\s*[,;/]\\s*\\d{1,3}){0,${MAX_AGE_ALTERNATIVES - 1}}$`,
  );
  if (!exactPattern.test(trimmed)) return null;
  const ages = trimmed.split(/\s*[,;/]\s*/).map(Number);
  if (
    ages.some(
      (age) => !Number.isInteger(age) || age < 18 || age > 120,
    )
  ) {
    return null;
  }
  return [...new Set(ages)];
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

function indicScript(value) {
  if (/[\u0900-\u097f]/u.test(value)) return "devanagari";
  if (/[\u0980-\u09ff]/u.test(value)) return "bengali";
  if (/[\u0b00-\u0b7f]/u.test(value)) return "odia";
  if (/[\u0c80-\u0cff]/u.test(value)) return "kannada";
  return "";
}

function buildLegacyPositions(names, relatives) {
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
  return positions;
}

function buildSearchPositions(names, relatives) {
  const positions = [];
  const seen = new Set();
  const add = (nameIndex, relativeIndex) => {
    const key = `${nameIndex}:${relativeIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    positions.push([nameIndex, relativeIndex]);
  };

  add(0, 0);

  // Put the first matching state-script pair near the front of the queue. Variant
  // lists may contain several Latin spellings before a relative's local-script
  // spelling, so index-only traversal can otherwise miss the strongest combined
  // local-script search under the hard cap.
  for (const script of ["devanagari", "bengali", "odia", "kannada"]) {
    const nameIndex = names.findIndex(({ value }) => indicScript(value) === script);
    const relativeIndex = relatives.findIndex(
      ({ value }) => indicScript(value) === script,
    );
    if (nameIndex < 0 || relativeIndex < 0) continue;
    add(nameIndex, relativeIndex);
    add(nameIndex, 0);
    add(0, relativeIndex);
  }

  for (const [nameIndex, relativeIndex] of buildLegacyPositions(names, relatives)) {
    add(nameIndex, relativeIndex);
  }
  return positions;
}

function resolveRelativeIdentityIndices(relatives, values) {
  if (!Array.isArray(values)) return [];
  const relativeIndexByValue = new Map(
    relatives.map(({ value }, index) => [value.toLocaleLowerCase(), index]),
  );
  const seen = new Set();
  const indices = [];
  for (const raw of values) {
    const value = clean(raw, 80);
    const index = relativeIndexByValue.get(value.toLocaleLowerCase());
    if (!value || index === undefined || seen.has(index)) continue;
    seen.add(index);
    indices.push(index);
  }
  return indices;
}

export function formatBirthCriterion(criterion) {
  if (criterion?.kind === "dob") return `DOB ${criterion.value}`;
  if (criterion?.kind === "age") return `Age ${criterion.value}`;
  return "Birth detail";
}

export function shouldOfferOfficialFallback({
  candidateCount,
  attemptedCount,
  completedAttemptCount,
  plannedAttemptCount,
} = {}) {
  return (
    candidateCount === 0 &&
    Number.isInteger(plannedAttemptCount) &&
    plannedAttemptCount > 0 &&
    attemptedCount === plannedAttemptCount &&
    completedAttemptCount === plannedAttemptCount
  );
}

export function planSearchQueue(
  voterNameVariants,
  relativeNameVariants,
  birthCriteriaOrLimit = [],
  limit = 18,
  options = {},
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
  const positions = legacyMode
    ? buildLegacyPositions(names, relatives)
    : buildSearchPositions(names, relatives);

  const seen = new Set();
  const queue = [];
  const births = birthCriteria.length > 0 ? birthCriteria : [null];
  const addAttempt = (nameIndex, relativeIndex, birth) => {
    const name = names[nameIndex];
    const relative = relatives[relativeIndex];
    if (!name || !relative) return false;
    const birthKey = birth ? `${birth.kind}:${birth.value}` : "legacy";
    const key = `${name.value.toLocaleLowerCase()}\u0000${relative.value.toLocaleLowerCase()}\u0000${birthKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    queue.push({
      name: name.value,
      relativeName: relative.value,
      ...(birth ? { birth } : {}),
      nameVariantIndex: name.originalIndex,
      relativeNameVariantIndex: relative.originalIndex,
    });
    return queue.length >= boundedLimit;
  };

  if (!legacyMode) {
    const relativeIdentityIndices = resolveRelativeIdentityIndices(
      relatives,
      options?.relativeIdentityValues,
    );
    if (relativeIdentityIndices.length > 0) {
      // Give every entered relative identity one attempt before any full sweep.
      // Then complete remaining birth criteria in identity priority order, keeping
      // the primary relative first, before script/spelling variants consume space.
      for (const relativeIndex of relativeIdentityIndices) {
        if (addAttempt(0, relativeIndex, births[0])) return queue;
      }
      for (const relativeIndex of relativeIdentityIndices) {
        for (const birth of births.slice(1)) {
          if (addAttempt(0, relativeIndex, birth)) return queue;
        }
      }
    }
  }

  for (const [nameIndex, relativeIndex] of positions) {
    for (const birth of births) {
      if (addAttempt(nameIndex, relativeIndex, birth)) break;
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
