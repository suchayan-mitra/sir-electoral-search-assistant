/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { generateVariants } from "@/lib/variants.mjs";
import {
  deduplicateCandidates,
  formatBirthCriterion,
  isAdultDob,
  MAX_AGE_ALTERNATIVES,
  parseAgeAlternatives,
  planSearchQueue,
  shouldOfferOfficialFallback,
} from "@/lib/search-plan.mjs";
import {
  parseExtensionMessage,
  sendExtensionMessage,
  type OfficialApiObservation,
  type ExtensionState,
} from "@/lib/client/extension-transport";
import type {
  CandidateSummary,
  SearchRequest,
  SupportedState,
} from "@/lib/server/official-api-adapter";

type Locale = "en" | "kn" | "bn" | "or";
type Step = "details" | "variants" | "captcha" | "results";
type SearchAttempt = ReturnType<typeof planSearchQueue>[number];
type AttemptRecord = {
  attempt: SearchAttempt;
  status: "completed" | "failed";
  candidateCount: number;
  apiStatus?: number;
  message?: string;
};

type FormData = {
  state: SupportedState;
  name: string;
  relativeName: string;
  additionalRelativeNames: string;
  age: string;
  dob: string;
  gender: SearchRequest["gender"] | "";
  district: string;
};

type BirthCriterion =
  | { kind: "dob"; value: string }
  | { kind: "age"; value: number };

type AiVariantStatus =
  | "idle"
  | "loading"
  | "generated"
  | "fallback"
  | "not_configured"
  | "offline";

type VariantSuggestionResponse = {
  voterNameVariants?: unknown;
  relativeNameVariants?: unknown;
  voterCandidates?: unknown;
  relativeGroups?: unknown;
  ai?: { status?: unknown };
  error?: unknown;
};

type VariantSource =
  | "entered"
  | "local-transliteration"
  | "local-spelling"
  | "ai";

type VariantCandidate = { value: string; source: VariantSource };
type RelativeVariantGroup = {
  relativeId: string;
  enteredValue: string;
  candidates: VariantCandidate[];
};

const hindiScript = {
  label: "Hindi",
  letters: /[\u0904-\u0939\u0958-\u0961\u0972-\u097f]/,
};
const stateScript = {
  karnataka: { label: "Kannada", letters: /[\u0c85-\u0cb9\u0cde\u0ce0-\u0ce1]/ },
  west_bengal: { label: "Bengali", letters: /[\u0985-\u09b9\u09ce\u09dc-\u09df\u09f0-\u09f1]/ },
  odisha: { label: "Odia", letters: /[\u0b05-\u0b39\u0b5c-\u0b61\u0b71]/ },
  bihar: hindiScript,
  chhattisgarh: hindiScript,
  delhi: hindiScript,
  jharkhand: hindiScript,
  madhya_pradesh: hindiScript,
  rajasthan: hindiScript,
  uttar_pradesh: hindiScript,
  uttarakhand: hindiScript,
} satisfies Record<SupportedState, { label: string; letters: RegExp }>;

function variantScript(value: string, state: SupportedState): string {
  const target = stateScript[state];
  const hasLatin = /[A-Za-z]/.test(value);
  const hasTarget = target.letters.test(value);
  const hasOtherLetters = [...value].some(
    (character) =>
      /\p{L}/u.test(character) &&
      !/[A-Za-z]/.test(character) &&
      !target.letters.test(character),
  );
  if (hasTarget && !hasLatin && !hasOtherLetters) return target.label;
  if (hasLatin && !hasTarget && !hasOtherLetters) return "Roman";
  return "Mixed / other";
}

const sourceLabel: Record<VariantSource, string> = {
  entered: "Entered by you",
  "local-transliteration": "Local transliteration",
  "local-spelling": "Local spelling rule",
  ai: "AI suggestion",
};

function parseAdditionalRelativeNames(value: string): string[] {
  return value
    .split(/\n|;/)
    .map((item) =>
      item.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 80),
    )
    .filter(Boolean)
    .slice(0, 5);
}

function uniqueValues(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  return values.filter((raw) => {
    const key = raw.normalize("NFC").toLocaleLowerCase();
    if (!raw || seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  });
}

function relativeBaseNames(form: FormData): string[] {
  return uniqueValues(
    [form.relativeName.trim(), ...parseAdditionalRelativeNames(form.additionalRelativeNames)],
    6,
  );
}

function localCandidates(
  enteredValue: string,
  state: SupportedState,
  limit: number,
): VariantCandidate[] {
  const entered = enteredValue.normalize("NFC").trim().replace(/\s+/g, " ");
  const variants = generateVariants(entered, state, limit);
  return variants.slice(0, limit).map((value, index) => ({
    value,
    source:
      index === 0
        ? "entered"
        : variantScript(value, state) === "Roman"
          ? "local-spelling"
          : "local-transliteration",
  }));
}

function normalizeCandidateList(
  raw: unknown,
  enteredValue: string,
  state: SupportedState,
  limit: number,
): VariantCandidate[] {
  const local = localCandidates(enteredValue, state, limit);
  const values = Array.isArray(raw) ? raw : [];
  const candidates = values.length > 0 ? [local[0], ...values] : local;
  const enteredKey = local[0]?.value.toLocaleLowerCase();
  const allowedSources = new Set<VariantSource>([
    "ai",
    "local-spelling",
    "local-transliteration",
  ]);
  const merged = new Map<string, VariantCandidate>();
  for (const candidate of candidates) {
    const rawValue =
      candidate && typeof candidate === "object" && "value" in candidate
        ? candidate.value
        : "";
    if (typeof rawValue !== "string") continue;
    const value = rawValue
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    const key = value.toLocaleLowerCase();
    if (!value || merged.has(key)) continue;
    const rawSource =
      candidate && typeof candidate === "object" && "source" in candidate
        ? candidate.source
        : undefined;
    const source: VariantSource =
      key === enteredKey
        ? "entered"
        : typeof rawSource === "string" &&
            allowedSources.has(rawSource as VariantSource)
          ? (rawSource as VariantSource)
          : "ai";
    merged.set(key, { value, source });
    if (merged.size >= limit) break;
  }
  return [...merged.values()];
}

function normalizeRelativeGroups(
  raw: unknown,
  relativeNames: string[],
  state: SupportedState,
): RelativeVariantGroup[] {
  const groups = Array.isArray(raw) ? raw : [];
  return relativeNames.map((enteredValue, index) => {
    const relativeId = `r${index + 1}`;
    const rawGroup = groups.find(
      (group) =>
        group &&
        typeof group === "object" &&
        "relativeId" in group &&
        group.relativeId === relativeId,
    );
    const rawCandidates =
      rawGroup && typeof rawGroup === "object" && "candidates" in rawGroup
        ? rawGroup.candidates
        : [];
    return {
      relativeId,
      enteredValue,
      candidates: normalizeCandidateList(
        rawCandidates,
        enteredValue,
        state,
        4,
      ),
    };
  });
}

function birthCriteriaFor(form: FormData): BirthCriterion[] {
  const criteria: BirthCriterion[] = [];
  // A known DOB is the strongest birth criterion, so it must consume the first
  // CAPTCHA-backed attempt; guessed ages only run after it.
  if (isAdultDob(form.dob)) {
    criteria.push({ kind: "dob", value: form.dob });
  }
  for (const age of parseAgeAlternatives(form.age) ?? []) {
    criteria.push({ kind: "age", value: age });
  }
  return criteria;
}

function adultDobMaxValue(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

const stateOptions: Array<{
  value: SupportedState;
  native: string;
  english: string;
  language: string;
}> = [
  { value: "karnataka", native: "ಕರ್ನಾಟಕ", english: "Karnataka", language: "ಕನ್ನಡ" },
  { value: "west_bengal", native: "পশ্চিমবঙ্গ", english: "West Bengal", language: "বাংলা" },
  { value: "odisha", native: "ଓଡ଼ିଶା", english: "Odisha", language: "ଓଡ଼ିଆ" },
  { value: "bihar", native: "बिहार", english: "Bihar", language: "हिन्दी" },
  { value: "uttar_pradesh", native: "उत्तर प्रदेश", english: "Uttar Pradesh", language: "हिन्दी" },
  { value: "madhya_pradesh", native: "मध्य प्रदेश", english: "Madhya Pradesh", language: "हिन्दी" },
  { value: "rajasthan", native: "राजस्थान", english: "Rajasthan", language: "हिन्दी" },
  { value: "jharkhand", native: "झारखण्ड", english: "Jharkhand", language: "हिन्दी" },
  { value: "chhattisgarh", native: "छत्तीसगढ़", english: "Chhattisgarh", language: "हिन्दी" },
  { value: "uttarakhand", native: "उत्तराखण्ड", english: "Uttarakhand", language: "हिन्दी" },
  { value: "delhi", native: "दिल्ली", english: "Delhi (NCT)", language: "हिन्दी" },
];

const copy = {
  en: {
    eyebrow: "Multilingual electoral search assistance",
    title: "Find the spelling that finds the record.",
    intro:
      "Prepare careful name variants across Kannada, Bengali, Odia and Hindi, then try a bounded queue of human-controlled searches with the official service.",
    steps: ["Details", "Variants", "CAPTCHA", "Matches"],
    trust: [
      "You—not automation—read and type every CAPTCHA.",
      "Up to eighteen approved combinations can be tried, one controlled search at a time.",
      "Results are minimized: no full voter record, email or export.",
    ],
    section: "Step 1 of 4",
    formTitle: "Tell us who to look for",
    formCopy: "Use the details you know. We only need enough to prepare a focused query.",
    name: "Voter name",
    relative: "Relative’s name",
    age: "Age",
    dob: "or date of birth",
    gender: "Gender",
    district: "District",
    optional: "optional",
    continue: "Generate AI spelling variants",
    offline: "Use offline transliteration",
    privacy: "This sends only the selected state and entered names to SIR Assist AI. DOB, age, gender, district, CAPTCHA and ECI results are not sent to AI.",
    reviewTitle: "Review spelling variants",
    reviewCopy: "Select the useful spellings. SIR Assist will combine names, relatives and birth details into at most eighteen searches; every official submission pauses for a fresh human CAPTCHA.",
    nameVariants: "Voter name variants",
    relativeVariants: "Relative-name variants",
    start: "Start controlled search",
    back: "Back",
    captchaTitle: "Complete the human check",
    captchaCopy: "Read the image below and type it yourself. We never use a model or service to solve a CAPTCHA.",
    captchaLabel: "Characters shown",
    submit: "Submit one search",
    human: "Human input required",
    resultsTitle: "Possible matches",
    resultsCopy: "These minimized matches came from the official ECI search. Open the official service if you need to verify more detail.",
    newSearch: "Start a new case",
    how: {
      title: "Who does what",
      roles: [
        {
          title: "SIR Assist cloud (Cloudflare Worker)",
          body: "Hosts this page and the extension download, and generates bounded AI spelling suggestions from only the selected state and entered names. It never receives DOB, age, gender, district, CAPTCHA data or ECI results, and it never searches ECI itself.",
        },
        {
          title: "Browser companion (extension)",
          body: "Opens the official ECI page in your browser, fills one approved combination, relays the untouched CAPTCHA image, submits exactly once, and returns a minimized possible-match summary. Search details travel locally from this page to the ECI tab—never through SIR Assist servers.",
        },
        {
          title: "You (human)",
          body: "Read and type every CAPTCHA, approve every combination before it runs, and verify any possible match on the official ECI service.",
        },
      ],
      limitsTitle: "What cannot be bypassed",
      limits: [
        "Every submitted combination requires a fresh human-entered CAPTCHA. AI cannot solve, reuse or remove it.",
        "ECI rate limits, outages, and inaccurate or missing electoral data remain outside SIR Assist's control.",
        "A possible match is not identity confirmation—verify it on the official service.",
        "A zero result only covers the exact combinations tried; it does not prove the person is absent from the roll.",
      ],
    },
  },
  kn: {
    eyebrow: "ಬಹುಭಾಷಾ ಮತದಾರರ ಹುಡುಕಾಟ ಸಹಾಯ",
    title: "ಸರಿಯಾದ ಕಾಗುಣಿತದಿಂದ ದಾಖಲೆಯನ್ನು ಹುಡುಕಿ.",
    intro: "ಕನ್ನಡ, বাংলা, ଓଡ଼ିଆ ಮತ್ತು हिन्दी ಹೆಸರು ರೂಪಗಳನ್ನು ಸಿದ್ಧಪಡಿಸಿ, ನಂತರ ಹದಿನೆಂಟು ಮಾನವ-ನಿಯಂತ್ರಿತ ಹುಡುಕಾಟಗಳವರೆಗೆ ಪ್ರಯತ್ನಿಸಿ.",
    steps: ["ವಿವರ", "ರೂಪಗಳು", "CAPTCHA", "ಫಲಿತಾಂಶ"],
    trust: ["ಪ್ರತಿ CAPTCHA ಅನ್ನು ನೀವೇ ಓದಿ ನಮೂದಿಸುತ್ತೀರಿ.", "ಪ್ರತಿ ಪ್ರಕರಣಕ್ಕೆ ಹದಿನೆಂಟು ನಿಯಂತ್ರಿತ ಹುಡುಕಾಟಗಳವರೆಗೆ.", "ಪೂರ್ಣ ಮತದಾರರ ದಾಖಲೆ ಅಥವಾ ಇಮೇಲ್ ಇಲ್ಲ."],
    section: "ಹಂತ 1 / 4",
    formTitle: "ಯಾರನ್ನು ಹುಡುಕಬೇಕು?",
    formCopy: "ಕೇಂದ್ರೀಕೃತ ಹುಡುಕಾಟಕ್ಕೆ ನಿಮಗೆ ತಿಳಿದಿರುವ ವಿವರಗಳನ್ನು ನೀಡಿ.",
    name: "ಮತದಾರರ ಹೆಸರು",
    relative: "ಸಂಬಂಧಿಯ ಹೆಸರು",
    age: "ವಯಸ್ಸು",
    dob: "ಅಥವಾ ಜನ್ಮ ದಿನಾಂಕ",
    gender: "ಲಿಂಗ",
    district: "ಜಿಲ್ಲೆ",
    optional: "ಐಚ್ಛಿಕ",
    continue: "AI ಹೆಸರು ರೂಪಗಳನ್ನು ರಚಿಸಿ",
    offline: "ಆಫ್‌ಲೈನ್ ಲಿಪ್ಯಂತರ ಬಳಸಿ",
    privacy: "ಕಾಗುಣಿತ ರೂಪಗಳನ್ನು ರಚಿಸಲು ಆಯ್ದ ರಾಜ್ಯ ಮತ್ತು ನಮೂದಿಸಿದ ಹೆಸರುಗಳನ್ನು ಮಾತ್ರ SIR Assist AI ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ. ಜನ್ಮ ದಿನಾಂಕ, ವಯಸ್ಸು, ಲಿಂಗ, ಜಿಲ್ಲೆ, CAPTCHA ಮತ್ತು ECI ಫಲಿತಾಂಶಗಳನ್ನು AI ಗೆ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ.",
    reviewTitle: "ಕಾಗುಣಿತ ರೂಪಗಳನ್ನು ಪರಿಶೀಲಿಸಿ",
    reviewCopy: "ಉಪಯುಕ್ತ ಕಾಗುಣಿತಗಳನ್ನು ಆರಿಸಿ. SIR Assist ಹದಿನೆಂಟು ಹುಡುಕಾಟ ಸಂಯೋಜನೆಗಳವರೆಗೆ ಸಿದ್ಧಪಡಿಸುತ್ತದೆ; ಪ್ರತಿಯೊಂದಕ್ಕೂ ಹೊಸ CAPTCHA ಅಗತ್ಯ.",
    nameVariants: "ಮತದಾರರ ಹೆಸರು ರೂಪಗಳು",
    relativeVariants: "ಸಂಬಂಧಿಯ ಹೆಸರು ರೂಪಗಳು",
    start: "ನಿಯಂತ್ರಿತ ಹುಡುಕಾಟ ಪ್ರಾರಂಭಿಸಿ",
    back: "ಹಿಂದೆ",
    captchaTitle: "ಮಾನವ ಪರಿಶೀಲನೆಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಿ",
    captchaCopy: "ಚಿತ್ರವನ್ನು ಓದಿ ನೀವೇ ನಮೂದಿಸಿ. CAPTCHA ಪರಿಹರಿಸಲು ನಾವು ಮಾದರಿಯನ್ನು ಬಳಸುವುದಿಲ್ಲ.",
    captchaLabel: "ಚಿತ್ರದಲ್ಲಿರುವ ಅಕ್ಷರಗಳು",
    submit: "ಒಂದು ಹುಡುಕಾಟ ಸಲ್ಲಿಸಿ",
    human: "ಮಾನವ ನಮೂದು ಅಗತ್ಯ",
    resultsTitle: "ಸಂಭಾವ್ಯ ಹೊಂದಾಣಿಕೆಗಳು",
    resultsCopy: "ಈ ಕನಿಷ್ಠ ಹೊಂದಾಣಿಕೆಗಳು ಅಧಿಕೃತ ECI ಹುಡುಕಾಟದಿಂದ ಬಂದಿವೆ.",
    newSearch: "ಹೊಸ ಪ್ರಕರಣ",
    how: {
      title: "ಯಾರು ಏನು ಮಾಡುತ್ತಾರೆ",
      roles: [
        {
          title: "SIR Assist ಕ್ಲೌಡ್ (Cloudflare Worker)",
          body: "ಈ ಪುಟ ಮತ್ತು ಎಕ್ಸ್‌ಟೆನ್ಶನ್ ಡೌನ್‌ಲೋಡ್ ಅನ್ನು ಒದಗಿಸುತ್ತದೆ; ಆಯ್ದ ರಾಜ್ಯ ಮತ್ತು ನಮೂದಿಸಿದ ಹೆಸರುಗಳಿಂದ ಮಾತ್ರ ಸೀಮಿತ AI ಕಾಗುಣಿತ ಸಲಹೆಗಳನ್ನು ರಚಿಸುತ್ತದೆ. ಜನ್ಮ ದಿನಾಂಕ, ವಯಸ್ಸು, ಲಿಂಗ, ಜಿಲ್ಲೆ, CAPTCHA ಅಥವಾ ECI ಫಲಿತಾಂಶಗಳನ್ನು ಇದು ಎಂದಿಗೂ ಪಡೆಯುವುದಿಲ್ಲ; ತಾನೇ ECI ಹುಡುಕಾಟ ನಡೆಸುವುದಿಲ್ಲ.",
        },
        {
          title: "ಬ್ರೌಸರ್ ಸಹಾಯಕ (ಎಕ್ಸ್‌ಟೆನ್ಶನ್)",
          body: "ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಅಧಿಕೃತ ECI ಪುಟವನ್ನು ತೆರೆದು, ಅನುಮೋದಿತ ಒಂದು ಸಂಯೋಜನೆಯನ್ನು ಭರ್ತಿ ಮಾಡಿ, CAPTCHA ಚಿತ್ರವನ್ನು ಬದಲಾಯಿಸದೆ ತೋರಿಸಿ, ಒಮ್ಮೆ ಮಾತ್ರ ಸಲ್ಲಿಸಿ, ಕನಿಷ್ಠಗೊಳಿಸಿದ ಸಂಭಾವ್ಯ-ಹೊಂದಾಣಿಕೆ ಸಾರಾಂಶವನ್ನು ಹಿಂತಿರುಗಿಸುತ್ತದೆ. ಹುಡುಕಾಟದ ವಿವರಗಳು ಈ ಪುಟ ಮತ್ತು ECI ಟ್ಯಾಬ್ ನಡುವೆ ಸ್ಥಳೀಯವಾಗಿ ಇರುತ್ತವೆ.",
        },
        {
          title: "ನೀವು",
          body: "ಪ್ರತಿ CAPTCHA ಅನ್ನು ನೀವೇ ಓದಿ ನಮೂದಿಸುತ್ತೀರಿ, ಪ್ರತಿ ಸಂಯೋಜನೆಯನ್ನು ಮೊದಲೇ ಅನುಮೋದಿಸುತ್ತೀರಿ ಮತ್ತು ಸಂಭಾವ್ಯ ಹೊಂದಾಣಿಕೆಯನ್ನು ಅಧಿಕೃತ ECI ಸೇವೆಯಲ್ಲಿ ಪರಿಶೀಲಿಸುತ್ತೀರಿ.",
        },
      ],
      limitsTitle: "ಬೈಪಾಸ್ ಮಾಡಲಾಗದವು",
      limits: [
        "ಪ್ರತಿ ಸಲ್ಲಿಕೆಗೂ ಹೊಸ ಮಾನವ-ನಮೂದಿತ CAPTCHA ಬೇಕು; AI ಅದನ್ನು ಎಂದಿಗೂ ಪರಿಹರಿಸುವುದಿಲ್ಲ.",
        "ECI ದರ-ಮಿತಿ, ಸೇವಾ ವ್ಯತ್ಯಯ ಮತ್ತು ದತ್ತಾಂಶ ದೋಷಗಳು SIR Assist ನಿಯಂತ್ರಣದ ಹೊರಗಿವೆ.",
        "ಸಂಭಾವ್ಯ ಹೊಂದಾಣಿಕೆ ಗುರುತಿನ ದೃಢೀಕರಣವಲ್ಲ — ಅಧಿಕೃತ ಸೇವೆಯಲ್ಲಿ ಪರಿಶೀಲಿಸಿ.",
        "ಶೂನ್ಯ ಫಲಿತಾಂಶವು ಪ್ರಯತ್ನಿಸಿದ ನಿಖರ ಸಂಯೋಜನೆಗಳಿಗೆ ಮಾತ್ರ; ವ್ಯಕ್ತಿ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ ಎಂದು ಸಾಬೀತುಪಡಿಸುವುದಿಲ್ಲ.",
      ],
    },
  },
  bn: {
    eyebrow: "বহুভাষিক ভোটার অনুসন্ধান সহায়তা",
    title: "সঠিক বানানে সঠিক রেকর্ড খুঁজুন।",
    intro: "কন্নড়, বাংলা, ওড়িয়া ও হিন্দি নামের সীমিত রূপ তৈরি করে আঠারোটি পর্যন্ত মানব-নিয়ন্ত্রিত অনুসন্ধান চেষ্টা করুন।",
    steps: ["বিবরণ", "বানান", "CAPTCHA", "মিল"],
    trust: ["প্রতিটি CAPTCHA আপনি নিজে পড়ে লিখবেন।", "প্রতি কেসে আঠারোটি পর্যন্ত নিয়ন্ত্রিত অনুসন্ধান।", "সম্পূর্ণ ভোটার রেকর্ড, ইমেল বা এক্সপোর্ট নেই।"],
    section: "ধাপ ১ / ৪",
    formTitle: "কাকে খুঁজছেন?",
    formCopy: "কেন্দ্রিত অনুসন্ধানের জন্য জানা তথ্য দিন।",
    name: "ভোটারের নাম",
    relative: "আত্মীয়ের নাম",
    age: "বয়স",
    dob: "অথবা জন্মতারিখ",
    gender: "লিঙ্গ",
    district: "জেলা",
    optional: "ঐচ্ছিক",
    continue: "AI বানানের পরামর্শ তৈরি করুন",
    offline: "অফলাইন প্রতিবর্ণীকরণ ব্যবহার করুন",
    privacy: "বানানের রূপ তৈরি করতে নির্বাচিত রাজ্য ও লেখা নামগুলিই SIR Assist AI-তে পাঠানো হয়। জন্মতারিখ, বয়স, লিঙ্গ, জেলা, CAPTCHA এবং ECI ফলাফল AI-তে পাঠানো হয় না।",
    reviewTitle: "বানানের রূপ যাচাই করুন",
    reviewCopy: "উপযোগী বানানগুলি বাছুন। SIR Assist আঠারোটি পর্যন্ত অনুসন্ধান-সমন্বয় তৈরি করবে; প্রতিটির জন্য নতুন CAPTCHA লাগবে।",
    nameVariants: "ভোটারের নামের রূপ",
    relativeVariants: "আত্মীয়ের নামের রূপ",
    start: "নিয়ন্ত্রিত অনুসন্ধান শুরু করুন",
    back: "ফিরুন",
    captchaTitle: "মানব যাচাই সম্পূর্ণ করুন",
    captchaCopy: "ছবিটি পড়ে নিজে লিখুন। CAPTCHA সমাধানে আমরা কোনো মডেল ব্যবহার করি না।",
    captchaLabel: "ছবিতে দেখানো অক্ষর",
    submit: "একটি অনুসন্ধান জমা দিন",
    human: "মানব ইনপুট প্রয়োজন",
    resultsTitle: "সম্ভাব্য মিল",
    resultsCopy: "এই সীমিত মিলগুলি সরকারি ECI অনুসন্ধান থেকে এসেছে।",
    newSearch: "নতুন কেস",
    how: {
      title: "কে কী করে",
      roles: [
        {
          title: "SIR Assist ক্লাউড (Cloudflare Worker)",
          body: "এই পেজ ও এক্সটেনশন ডাউনলোড পরিবেশন করে এবং শুধু নির্বাচিত রাজ্য ও লেখা নামগুলি থেকে সীমিত AI বানান-পরামর্শ তৈরি করে। জন্মতারিখ, বয়স, লিঙ্গ, জেলা, CAPTCHA বা ECI ফলাফল এটি কখনও পায় না এবং নিজে ECI-তে অনুসন্ধানও করে না।",
        },
        {
          title: "ব্রাউজার সহযোগী (এক্সটেনশন)",
          body: "আপনার ব্রাউজারে সরকারি ECI পেজ খোলে, অনুমোদিত একটি সমন্বয় পূরণ করে, CAPTCHA ছবি অপরিবর্তিত দেখায়, একবারই জমা দেয় এবং সীমিত সম্ভাব্য-মিল সারাংশ ফেরত দেয়। অনুসন্ধানের তথ্য এই পেজ ও ECI ট্যাবের মধ্যেই স্থানীয়ভাবে থাকে।",
        },
        {
          title: "আপনি",
          body: "প্রতিটি CAPTCHA নিজে পড়ে লেখেন, প্রতিটি সমন্বয় চালানোর আগে অনুমোদন করেন এবং সম্ভাব্য মিল সরকারি ECI পরিষেবায় যাচাই করেন।",
        },
      ],
      limitsTitle: "যা এড়ানো যায় না",
      limits: [
        "প্রতিটি জমা দেওয়া অনুসন্ধানে নতুন মানব-লিখিত CAPTCHA লাগে; AI তা কখনও সমাধান করে না।",
        "ECI-র রেট-লিমিট, বিভ্রাট ও তথ্যের ভুল SIR Assist-এর নিয়ন্ত্রণের বাইরে।",
        "সম্ভাব্য মিল পরিচয়ের নিশ্চিতকরণ নয় — সরকারি পরিষেবায় যাচাই করুন।",
        "শূন্য ফলাফল শুধু চেষ্টা-করা নির্দিষ্ট সমন্বয়গুলিকে বোঝায়; কেউ তালিকায় নেই তা প্রমাণ করে না।",
      ],
    },
  },
  or: {
    eyebrow: "ବହୁଭାଷୀ ଭୋଟର ସନ୍ଧାନ ସହାୟତା",
    title: "ଠିକ୍ ବନାନରେ ଠିକ୍ ରେକର୍ଡ ଖୋଜନ୍ତୁ।",
    intro: "କନ୍ନଡ଼, বাংলা, ଓଡ଼ିଆ ଓ ହିନ୍ଦୀ ନାମର ସୀମିତ ରୂପ ପ୍ରସ୍ତୁତ କରି ଅଠରଟି ପର୍ଯ୍ୟନ୍ତ ମାନବ-ନିୟନ୍ତ୍ରିତ ସନ୍ଧାନ ଚେଷ୍ଟା କରନ୍ତୁ।",
    steps: ["ବିବରଣୀ", "ବନାନ", "CAPTCHA", "ମେଳ"],
    trust: ["ପ୍ରତ୍ୟେକ CAPTCHA ଆପଣ ନିଜେ ପଢ଼ିବେ।", "ପ୍ରତି କେସରେ ଅଠରଟି ପର୍ଯ୍ୟନ୍ତ ନିୟନ୍ତ୍ରିତ ସନ୍ଧାନ।", "ସମ୍ପୂର୍ଣ୍ଣ ଭୋଟର ରେକର୍ଡ କିମ୍ବା ଇମେଲ ନାହିଁ।"],
    section: "ପଦକ୍ରମ 1 / 4",
    formTitle: "କାହାକୁ ଖୋଜୁଛନ୍ତି?",
    formCopy: "କେନ୍ଦ୍ରିତ ସନ୍ଧାନ ପାଇଁ ଜଣା ବିବରଣୀ ଦିଅନ୍ତୁ।",
    name: "ଭୋଟରଙ୍କ ନାମ",
    relative: "ସମ୍ପର୍କୀୟଙ୍କ ନାମ",
    age: "ବୟସ",
    dob: "କିମ୍ବା ଜନ୍ମ ତାରିଖ",
    gender: "ଲିଙ୍ଗ",
    district: "ଜିଲ୍ଲା",
    optional: "ଇଚ୍ଛାଧୀନ",
    continue: "AI ବନାନ ପରାମର୍ଶ ତିଆରି କରନ୍ତୁ",
    offline: "ଅଫଲାଇନ୍ ଲିପ୍ୟନ୍ତରଣ ବ୍ୟବହାର କରନ୍ତୁ",
    privacy: "ବନାନ ରୂପ ତିଆରି କରିବାକୁ ବାଛିଥିବା ରାଜ୍ୟ ଓ ଲେଖା ନାମଗୁଡ଼ିକୁ ମାତ୍ର SIR Assist AI କୁ ପଠାଯାଏ। ଜନ୍ମତାରିଖ, ବୟସ, ଲିଙ୍ଗ, ଜିଲ୍ଲା, CAPTCHA ଓ ECI ଫଳାଫଳ AI କୁ ପଠାଯାଏ ନାହିଁ।",
    reviewTitle: "ବନାନ ରୂପ ଯାଞ୍ଚ କରନ୍ତୁ",
    reviewCopy: "ଉପଯୋଗୀ ବନାନଗୁଡ଼ିକ ବାଛନ୍ତୁ। SIR Assist ଅଠରଟି ପର୍ଯ୍ୟନ୍ତ ସନ୍ଧାନ ସଂଯୋଜନ ପ୍ରସ୍ତୁତ କରିବ; ପ୍ରତ୍ୟେକ ପାଇଁ ନୂଆ CAPTCHA ଆବଶ୍ୟକ।",
    nameVariants: "ଭୋଟର ନାମ ରୂପ",
    relativeVariants: "ସମ୍ପର୍କୀୟ ନାମ ରୂପ",
    start: "ନିୟନ୍ତ୍ରିତ ସନ୍ଧାନ ଆରମ୍ଭ କରନ୍ତୁ",
    back: "ପଛକୁ",
    captchaTitle: "ମାନବ ଯାଞ୍ଚ ସମ୍ପୂର୍ଣ୍ଣ କରନ୍ତୁ",
    captchaCopy: "ଛବିକୁ ନିଜେ ପଢ଼ି ଲେଖନ୍ତୁ। CAPTCHA ସମାଧାନ ପାଇଁ ଆମେ ମଡେଲ ବ୍ୟବହାର କରୁନାହୁଁ।",
    captchaLabel: "ଛବିରେ ଥିବା ଅକ୍ଷର",
    submit: "ଗୋଟିଏ ସନ୍ଧାନ ଦାଖଲ କରନ୍ତୁ",
    human: "ମାନବ ଇନପୁଟ ଆବଶ୍ୟକ",
    resultsTitle: "ସମ୍ଭାବ୍ୟ ମେଳ",
    resultsCopy: "ଏହି ସୀମିତ ମେଳଗୁଡ଼ିକ ସରକାରୀ ECI ସନ୍ଧାନରୁ ଆସିଛି।",
    newSearch: "ନୂଆ କେସ",
    how: {
      title: "କିଏ କଣ କରେ",
      roles: [
        {
          title: "SIR Assist କ୍ଲାଉଡ୍ (Cloudflare Worker)",
          body: "ଏହି ପୃଷ୍ଠା ଓ ଏକ୍ସଟେନସନ୍ ଡାଉନଲୋଡ୍ ଯୋଗାଏ ଏବଂ କେବଳ ବଛା ରାଜ୍ୟ ଓ ଲେଖା ନାମରୁ ସୀମିତ AI ବନାନ ପରାମର୍ଶ ତିଆରି କରେ। ଜନ୍ମତାରିଖ, ବୟସ, ଲିଙ୍ଗ, ଜିଲ୍ଲା, CAPTCHA କିମ୍ବା ECI ଫଳାଫଳ ଏହା କେବେ ପାଏ ନାହିଁ; ନିଜେ ECI ସନ୍ଧାନ କରେ ନାହିଁ।",
        },
        {
          title: "ବ୍ରାଉଜର୍ ସହଯୋଗୀ (ଏକ୍ସଟେନସନ୍)",
          body: "ଆପଣଙ୍କ ବ୍ରାଉଜରରେ ସରକାରୀ ECI ପୃଷ୍ଠା ଖୋଲେ, ଅନୁମୋଦିତ ଗୋଟିଏ ସଂଯୋଜନ ଭରେ, CAPTCHA ଛବି ଅପରିବର୍ତ୍ତିତ ଦେଖାଏ, ଥରେ ମାତ୍ର ଦାଖଲ କରେ ଏବଂ ସୀମିତ ସମ୍ଭାବ୍ୟ-ମେଳ ସାରାଂଶ ଫେରାଏ। ସନ୍ଧାନ ବିବରଣୀ ଏହି ପୃଷ୍ଠା ଓ ECI ଟ୍ୟାବ୍ ମଧ୍ୟରେ ସ୍ଥାନୀୟ ଭାବେ ରହେ।",
        },
        {
          title: "ଆପଣ",
          body: "ପ୍ରତ୍ୟେକ CAPTCHA ନିଜେ ପଢ଼ି ଲେଖନ୍ତି, ପ୍ରତ୍ୟେକ ସଂଯୋଜନ ଚଳାଇବା ପୂର୍ବରୁ ଅନୁମୋଦନ କରନ୍ତି ଏବଂ ସମ୍ଭାବ୍ୟ ମେଳ ସରକାରୀ ECI ସେବାରେ ଯାଞ୍ଚ କରନ୍ତି।",
        },
      ],
      limitsTitle: "ଯାହା ଏଡ଼ାଯାଇପାରିବ ନାହିଁ",
      limits: [
        "ପ୍ରତ୍ୟେକ ଦାଖଲ ପାଇଁ ନୂଆ ମାନବ-ଲିଖିତ CAPTCHA ଆବଶ୍ୟକ; AI ଏହାକୁ କେବେ ସମାଧାନ କରେ ନାହିଁ।",
        "ECI ର ରେଟ୍-ଲିମିଟ୍, ସେବା ବାଧା ଓ ତଥ୍ୟ ତ୍ରୁଟି SIR Assist ନିୟନ୍ତ୍ରଣ ବାହାରେ।",
        "ସମ୍ଭାବ୍ୟ ମେଳ ପରିଚୟର ନିଶ୍ଚିତକରଣ ନୁହେଁ — ସରକାରୀ ସେବାରେ ଯାଞ୍ଚ କରନ୍ତୁ।",
        "ଶୂନ୍ୟ ଫଳାଫଳ କେବଳ ଚେଷ୍ଟା-କରା ନିର୍ଦ୍ଦିଷ୍ଟ ସଂଯୋଜନକୁ ବୁଝାଏ; କେହି ତାଲିକାରେ ନାହାନ୍ତି ବୋଲି ପ୍ରମାଣ କରେ ନାହିଁ।",
      ],
    },
  },
} as const;

const defaultForm: FormData = {
  state: "karnataka",
  name: "",
  relativeName: "",
  additionalRelativeNames: "",
  age: "",
  dob: "",
  gender: "",
  district: "",
};

const minimumExtensionVersion = "1.6.0";
const RATE_LIMIT_COOLDOWN_MS = 60_000;

const officialStateCodes: Record<SupportedState, string> = {
  karnataka: "S10",
  west_bengal: "S25",
  odisha: "S18",
  bihar: "S04",
  chhattisgarh: "S26",
  delhi: "U05",
  jharkhand: "S27",
  madhya_pradesh: "S12",
  rajasthan: "S20",
  uttar_pradesh: "S24",
  uttarakhand: "S28",
};

function isExtensionVersionCurrent(version: string): boolean {
  const current = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const minimum = /^(\d+)\.(\d+)\.(\d+)/.exec(minimumExtensionVersion);
  if (!current || !minimum) return false;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(current[index]) - Number(minimum[index]);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

function stepIndex(step: Step) {
  return { details: 0, variants: 1, captcha: 2, results: 3 }[step];
}

export function SearchAssistant() {
  const [locale, setLocale] = useState<Locale>("en");
  const [step, setStep] = useState<Step>("details");
  const [form, setForm] = useState<FormData>(defaultForm);
  const [nameCandidates, setNameCandidates] = useState<VariantCandidate[]>([]);
  const [relativeVariantGroups, setRelativeVariantGroups] = useState<
    RelativeVariantGroup[]
  >([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [selectedRelatives, setSelectedRelatives] = useState<string[]>([]);
  const [caseId, setCaseId] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const candidatesRef = useRef<CandidateSummary[]>([]);
  const [resultLimitReached, setResultLimitReached] = useState(false);
  const [searchQueue, setSearchQueue] = useState<SearchAttempt[]>([]);
  const [activeAttemptIndex, setActiveAttemptIndex] = useState(-1);
  const [attemptHistory, setAttemptHistory] = useState<AttemptRecord[]>([]);
  const [aiVariantStatus, setAiVariantStatus] =
    useState<AiVariantStatus>("idle");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extensionState, setExtensionState] =
    useState<ExtensionState>("checking");
  const [extensionVersion, setExtensionVersion] = useState("");
  const [apiObservation, setApiObservation] =
    useState<OfficialApiObservation | null>(null);
  const apiObservationRef = useRef<OfficialApiObservation | null>(null);
  const activeCaseRef = useRef("");
  const submittedCaseRef = useRef("");
  const searchQueueRef = useRef<SearchAttempt[]>([]);
  const activeAttemptIndexRef = useRef(-1);
  const startTimeoutRef = useRef<number | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const t = copy[locale];
  const currentStep = stepIndex(step);
  const stateLabel = stateOptions.find((item) => item.value === form.state)!;
  const officialRollUrl = `https://voters.eci.gov.in/download-eroll?stateCode=${officialStateCodes[form.state]}`;
  const birthCriteria = useMemo(
    () => birthCriteriaFor(form),
    [form],
  );
  const selectedRelativeIdentityValues = useMemo(() => {
    const selected = new Set(selectedRelatives);
    return relativeVariantGroups.flatMap((group) => {
      const preferred = group.candidates.find((candidate) =>
        selected.has(candidate.value),
      );
      return preferred ? [preferred.value] : [];
    });
  }, [relativeVariantGroups, selectedRelatives]);
  const plannedAttempts = useMemo(
    () =>
      planSearchQueue(selectedNames, selectedRelatives, birthCriteria, 18, {
        relativeIdentityValues: selectedRelativeIdentityValues,
      }),
    [
      birthCriteria,
      selectedNames,
      selectedRelativeIdentityValues,
      selectedRelatives,
    ],
  );
  const selectedCombinationCount =
    selectedNames.length * selectedRelatives.length * birthCriteria.length;
  const cappedCombinationCount = Math.max(
    0,
    selectedCombinationCount - plannedAttempts.length,
  );
  const extensionNeedsUpdate =
    extensionState === "available" &&
    !isExtensionVersionCurrent(extensionVersion);
  const extensionReady =
    extensionState === "available" && !extensionNeedsUpdate;
  const lastAttemptRecord =
    attemptHistory.length > 0
      ? attemptHistory[attemptHistory.length - 1]
      : undefined;
  const latestFailure =
    lastAttemptRecord?.status === "failed" ? lastAttemptRecord : undefined;
  const completedAttemptCount = attemptHistory.filter(
    (record) => record.status === "completed",
  ).length;
  const completedZeroCount = attemptHistory.filter(
    (record) => record.status === "completed" && record.candidateCount === 0,
  ).length;
  const failedAttemptCount = attemptHistory.filter(
    (record) => record.status === "failed",
  ).length;
  const nextAttemptIndex = activeAttemptIndex + 1;
  const nextAttempt = searchQueue[nextAttemptIndex];
  const showOfficialFallback = shouldOfferOfficialFallback({
    candidateCount: candidates.length,
    attemptedCount: attemptHistory.length,
    completedAttemptCount,
    plannedAttemptCount: searchQueue.length,
  });
  const apiCallAccepted = Boolean(
    apiObservation &&
      apiObservation.status >= 200 &&
      apiObservation.status < 300,
  );

  useEffect(() => {
    const detectionTimeout = window.setTimeout(() => {
      setExtensionState((current) =>
        current === "checking" ? "missing" : current,
      );
    }, 1_200);

    function clearStartTimeout() {
      if (startTimeoutRef.current !== null) {
        window.clearTimeout(startTimeoutRef.current);
        startTimeoutRef.current = null;
      }
    }

    function receiveExtensionMessage(event: MessageEvent) {
      const message = parseExtensionMessage(event);
      if (!message) return;
      if (message.type === "READY") {
        setExtensionState("available");
        setExtensionVersion(message.version);
        return;
      }
      if (message.type === "API_OBSERVATION") {
        if (
          !submittedCaseRef.current ||
          message.requestId !== submittedCaseRef.current
        ) {
          return;
        }
        apiObservationRef.current = message.observation;
        setApiObservation(message.observation);
        return;
      }
      if (
        "requestId" in message &&
        message.requestId &&
        message.requestId !== activeCaseRef.current
      ) {
        return;
      }
      if (message.type === "CAPTCHA_READY") {
        clearStartTimeout();
        setCaptchaImage(message.captchaImage);
        setCaptchaAnswer("");
        setExpiresAt(
          message.expiresAt ?? new Date(Date.now() + 90_000).toISOString(),
        );
        setBusy(false);
        setError("");
        setStep("captcha");
        return;
      }
      if (message.type === "RESULTS") {
        clearStartTimeout();
        const attemptIndex = activeAttemptIndexRef.current;
        const attempt = searchQueueRef.current[attemptIndex];
        const annotated = message.candidates.map((candidate) => ({
          ...candidate,
          matchedOn: [
            ...candidate.matchedOn,
            `search ${attemptIndex + 1}`,
          ],
        }));
        const mergedCandidates = deduplicateCandidates(
          [candidatesRef.current, annotated],
          10,
        ) as CandidateSummary[];
        candidatesRef.current = mergedCandidates;
        setCandidates(mergedCandidates);
        setResultLimitReached(
          (current) =>
            current || message.resultLimitReached || mergedCandidates.length >= 10,
        );
        if (attempt) {
          setAttemptHistory((current) => [
            ...current,
            {
              attempt,
              status: "completed",
              candidateCount: message.candidates.length,
              apiStatus: apiObservationRef.current?.status,
            },
          ]);
        }
        setBusy(false);
        setError("");
        setStep("results");
        activeCaseRef.current = "";
        setCaseId("");
        return;
      }
      if (message.type === "ERROR") {
        clearStartTimeout();
        if (apiObservationRef.current?.status === 429) {
          setCooldownUntil(Date.now() + RATE_LIMIT_COOLDOWN_MS);
          setCooldownRemaining(Math.ceil(RATE_LIMIT_COOLDOWN_MS / 1000));
        }
        const attemptIndex = activeAttemptIndexRef.current;
        const attempt = searchQueueRef.current[attemptIndex];
        if (attempt) {
          setAttemptHistory((current) => [
            ...current,
            {
              attempt,
              status: "failed",
              candidateCount: 0,
              apiStatus: apiObservationRef.current?.status,
              message: message.error,
            },
          ]);
          setStep("results");
        }
        setBusy(false);
        setError(message.error);
        activeCaseRef.current = "";
        setCaseId("");
      }
    }

    window.addEventListener("message", receiveExtensionMessage);
    sendExtensionMessage({ type: "PING" });
    return () => {
      clearStartTimeout();
      window.clearTimeout(detectionTimeout);
      window.removeEventListener("message", receiveExtensionMessage);
    };
  }, []);

  useEffect(() => {
    if (step !== "results") return;
    window.requestAnimationFrame(() => resultsHeadingRef.current?.focus());
  }, [step]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const interval = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldownUntil - Date.now()) / 1000),
      );
      setCooldownRemaining(remaining);
      if (remaining === 0) setCooldownUntil(0);
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  useEffect(() => {
    if (step !== "captcha" || !expiresAt || !caseId) return;
    const delay = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    const timeout = window.setTimeout(() => {
      const expiredCaseId = caseId;
      setCaseId("");
      activeCaseRef.current = "";
      const message =
        "This CAPTCHA session expired. Continue with the next planned spelling or start over.";
      const attempt = searchQueueRef.current[activeAttemptIndexRef.current];
      if (attempt) {
        setAttemptHistory((current) => [
          ...current,
          { attempt, status: "failed", candidateCount: 0, message },
        ]);
        setStep("results");
      }
      setError(message);
      sendExtensionMessage({ type: "CANCEL", requestId: expiredCaseId });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [caseId, expiresAt, step]);

  function requestForAttempt(attempt: SearchAttempt): SearchRequest {
    return {
      state: form.state,
      name: attempt.name,
      relativeName: attempt.relativeName,
      ...(attempt.birth?.kind === "dob"
        ? { dob: String(attempt.birth.value) }
        : { age: Number(attempt.birth?.value) }),
      gender: form.gender as SearchRequest["gender"],
      ...(form.district ? { district: form.district } : {}),
    };
  }

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function reloadPageForExtension() {
    window.location.reload();
  }

  async function prepareVariants(event: FormEvent) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | null;
    const requestAi = submitter?.value !== "offline";
    if (parseAgeAlternatives(form.age) === null) {
      setError(
        `Enter up to ${MAX_AGE_ALTERNATIVES} exact ages, or one ascending range covering no more than ${MAX_AGE_ALTERNATIVES} ages (for example, 40-46).`,
      );
      return;
    }
    if (form.dob && !isAdultDob(form.dob)) {
      setError("Enter a real date of birth for an adult voter.");
      return;
    }
    const requestedBirthCriteria = birthCriteriaFor(form);
    if (requestedBirthCriteria.length === 0) {
      setError("Enter at least one exact date of birth or age alternative.");
      return;
    }
    const relativeNames = relativeBaseNames(form);
    let voterCandidates = localCandidates(form.name, form.state, 6);
    let relativeGroups = normalizeRelativeGroups(
      [],
      relativeNames,
      form.state,
    );
    setAiVariantStatus(requestAi ? "loading" : "offline");
    if (requestAi) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      setBusy(true);
      try {
        const response = await fetch("/api/variants", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            state: form.state,
            voterName: form.name,
            relativeNames,
            aiOptIn: true,
          }),
        });
        const body = (await response.json()) as VariantSuggestionResponse;
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "AI spelling suggestions were unavailable.",
          );
        }
        voterCandidates = normalizeCandidateList(
          body.voterCandidates,
          form.name,
          form.state,
          6,
        );
        relativeGroups = normalizeRelativeGroups(
          body.relativeGroups,
          relativeNames,
          form.state,
        );
        const status = body.ai?.status;
        setAiVariantStatus(
          status === "generated" || status === "fallback" || status === "not_configured"
            ? status
            : "fallback",
        );
      } catch {
        setAiVariantStatus("fallback");
      } finally {
        window.clearTimeout(timeout);
        setBusy(false);
      }
    }
    setNameCandidates(voterCandidates);
    setRelativeVariantGroups(relativeGroups);
    setSelectedNames(uniqueValues([form.name.trim()], 1));
    setSelectedRelatives(relativeNames);
    setSearchQueue([]);
    searchQueueRef.current = [];
    setActiveAttemptIndex(-1);
    activeAttemptIndexRef.current = -1;
    setAttemptHistory([]);
    setCandidates([]);
    candidatesRef.current = [];
    setResultLimitReached(false);
    setApiObservation(null);
    apiObservationRef.current = null;
    submittedCaseRef.current = "";
    setError("");
    setStep("variants");
  }

  function toggleVariant(value: string, type: "name" | "relative") {
    const setter = type === "name" ? setSelectedNames : setSelectedRelatives;
    setter((current) =>
      current.includes(value)
        ? current.filter((candidate) => candidate !== value)
        : [...current, value],
    );
  }

  function startAttempt(attempt: SearchAttempt, attemptIndex: number) {
    if (!extensionReady) {
      setError(
        extensionNeedsUpdate
          ? `Update the SIR Assist browser companion to v${minimumExtensionVersion}, reload this page, and try again.`
          : "Install the SIR Assist browser companion, reload this page, and try again.",
      );
      return;
    }
    if (Date.now() < cooldownUntil) {
      setError(
        `The official service rate-limited the previous attempt (HTTP 429). Wait ${Math.max(1, cooldownRemaining)}s before the next search.`,
      );
      return;
    }
    setActiveAttemptIndex(attemptIndex);
    activeAttemptIndexRef.current = attemptIndex;
    const requestId = crypto.randomUUID();
    activeCaseRef.current = requestId;
    submittedCaseRef.current = "";
    setApiObservation(null);
    apiObservationRef.current = null;
    setCaseId(requestId);
    setBusy(true);
    setError("");
    startTimeoutRef.current = window.setTimeout(() => {
      if (activeCaseRef.current !== requestId) return;
      sendExtensionMessage({ type: "CANCEL", requestId });
      activeCaseRef.current = "";
      setCaseId("");
      setBusy(false);
      const message =
        "The browser companion did not reach the official CAPTCHA for this spelling.";
      setAttemptHistory((current) => [
        ...current,
        { attempt, status: "failed", candidateCount: 0, message },
      ]);
      setError(message);
      setStep("results");
    }, 45_000);
    sendExtensionMessage({
      type: "START",
      requestId,
      search: requestForAttempt(attempt),
    });
  }

  function startSearch() {
    if (plannedAttempts.length === 0) return;
    setSearchQueue(plannedAttempts);
    searchQueueRef.current = plannedAttempts;
    setAttemptHistory([]);
    setCandidates([]);
    candidatesRef.current = [];
    setResultLimitReached(false);
    startAttempt(plannedAttempts[0], 0);
  }

  function startNextAttempt() {
    const nextIndex = activeAttemptIndexRef.current + 1;
    const attempt = searchQueueRef.current[nextIndex];
    if (!attempt) return;
    setError("");
    startAttempt(attempt, nextIndex);
  }

  function refreshCaptcha() {
    if (!caseId || busy) return;
    setBusy(true);
    setError("");
    setCaptchaAnswer("");
    sendExtensionMessage({ type: "REFRESH_CAPTCHA", requestId: caseId });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!caseId) return;
    submittedCaseRef.current = caseId;
    setBusy(true);
    setError("");
    sendExtensionMessage({
      type: "SUBMIT",
      requestId: caseId,
      captchaAnswer: captchaAnswer.trim(),
    });
  }

  function cancelSearch(nextStep: Step = "variants") {
    const activeCaseId = caseId;
    if (startTimeoutRef.current !== null) {
      window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
    activeCaseRef.current = "";
    submittedCaseRef.current = "";
    setCaseId("");
    setCaptchaImage("");
    setCaptchaAnswer("");
    setExpiresAt("");
    setApiObservation(null);
    apiObservationRef.current = null;
    setError("");
    setStep(nextStep);
    if (activeCaseId) {
      sendExtensionMessage({ type: "CANCEL", requestId: activeCaseId });
    }
    if (nextStep === "variants") {
      setSearchQueue([]);
      searchQueueRef.current = [];
      setActiveAttemptIndex(-1);
      activeAttemptIndexRef.current = -1;
      setAttemptHistory([]);
      setCandidates([]);
      candidatesRef.current = [];
      setResultLimitReached(false);
    }
  }

  function reset() {
    setStep("details");
    setForm(defaultForm);
    setNameCandidates([]);
    setRelativeVariantGroups([]);
    setSelectedNames([]);
    setSelectedRelatives([]);
    setCaseId("");
    setCaptchaImage("");
    setCaptchaAnswer("");
    setExpiresAt("");
    setCandidates([]);
    candidatesRef.current = [];
    setResultLimitReached(false);
    setSearchQueue([]);
    searchQueueRef.current = [];
    setActiveAttemptIndex(-1);
    activeAttemptIndexRef.current = -1;
    setAttemptHistory([]);
    setApiObservation(null);
    apiObservationRef.current = null;
    setAiVariantStatus("idle");
    setError("");
    activeCaseRef.current = "";
    submittedCaseRef.current = "";
  }

  return (
    <main className="app-shell" lang={locale === "or" ? "or" : locale}>
      <header className="site-header">
        <div className="brand" aria-label="SIR Assist">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>
            <span className="brand-name">SIR Assist</span>
            <span className="brand-note">Independent beta · Not an ECI service</span>
          </span>
        </div>
        <label>
          <span className="sr-only">Interface language</span>
          <select
            className="language-select"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            aria-label="Interface language"
          >
            <option value="en">English</option>
            <option value="kn">ಕನ್ನಡ</option>
            <option value="bn">বাংলা</option>
            <option value="or">ଓଡ଼ିଆ</option>
          </select>
        </label>
      </header>

      <section className="hero">
        <div className="intro">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p className="intro-copy">{t.intro}</p>
          <div className="script-line" aria-label="Supported languages">
            <span className="script-pill">ಕನ್ನಡ · Kannada</span>
            <span className="script-pill">বাংলা · Bengali</span>
            <span className="script-pill">ଓଡ଼ିଆ · Odia</span>
            <span className="script-pill">हिन्दी · Hindi</span>
          </div>
          <ul className="trust-list">
            {t.trust.map((item) => (
              <li key={item}>
                <span className="trust-icon" aria-hidden="true">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <section className="workflow-card" aria-live="polite">
          <ol className="stepper" aria-label="Search progress">
            {t.steps.map((label, index) => (
              <li
                key={label}
                className={`step-item ${index === currentStep ? "active" : ""} ${index < currentStep ? "complete" : ""}`}
                aria-current={index === currentStep ? "step" : undefined}
              >
                {label}
              </li>
            ))}
          </ol>

          {step === "details" && (
            <form className="card-body" onSubmit={prepareVariants}>
              <p className="section-kicker">{t.section}</p>
              <h2>{t.formTitle}</h2>
              <p className="section-copy">{t.formCopy}</p>

              <ExtensionPreflight
                state={extensionState}
                version={extensionVersion}
                needsUpdate={extensionNeedsUpdate}
                onReload={reloadPageForExtension}
              />

              <div className="state-grid" role="group" aria-label="State">
                {stateOptions.map((state) => (
                  <button
                    key={state.value}
                    type="button"
                    className={`state-option ${form.state === state.value ? "selected" : ""}`}
                    onClick={() => setForm((current) => ({ ...current, state: state.value, district: "" }))}
                    aria-pressed={form.state === state.value}
                    data-testid={`state-${state.value}`}
                  >
                    <span className="state-native">{state.native}</span>
                    <span className="state-english">{state.english} · {state.language}</span>
                  </button>
                ))}
              </div>

              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="name">{t.name}</label>
                  <input
                    id="name"
                    name="name"
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="e.g. Ramesh Kumar / রমেশ কুমার"
                    maxLength={80}
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="field full">
                  <label htmlFor="relativeName">Primary {t.relative.toLocaleLowerCase()}</label>
                  <input
                    id="relativeName"
                    name="relativeName"
                    value={form.relativeName}
                    onChange={(event) => update("relativeName", event.target.value)}
                    placeholder="e.g. Suresh Kumar"
                    maxLength={80}
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="field full">
                  <label htmlFor="additionalRelativeNames">
                    Other relative-name alternatives <span className="optional">({t.optional})</span>
                  </label>
                  <textarea
                    id="additionalRelativeNames"
                    name="additionalRelativeNames"
                    value={form.additionalRelativeNames}
                    onChange={(event) => update("additionalRelativeNames", event.target.value)}
                    placeholder={"One per line, for example:\nMother’s current name\nMother’s maiden name"}
                    maxLength={400}
                    rows={3}
                    autoComplete="off"
                  />
                  <small className="field-help">
                    ECI provides one relative-name field and no father/mother selector, so these are tried as separate alternatives.
                  </small>
                </div>
                <div className="field">
                  <label htmlFor="dob">
                    Date of birth <span className="optional">({t.optional})</span>
                  </label>
                  <input
                    id="dob"
                    name="dob"
                    aria-label="Date of birth"
                    value={form.dob}
                    onChange={(event) => update("dob", event.target.value)}
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    maxLength={10}
                  />
                  <small className="field-help">
                    Use YYYY-MM-DD. An entered DOB is searched first, before any age alternatives. If you trust the exact DOB, leave ages blank—each age adds one more CAPTCHA search. Latest adult DOB: {adultDobMaxValue()}.
                  </small>
                </div>
                <div className="field">
                  <label htmlFor="age">
                    Age alternatives <span className="optional">({t.optional})</span>
                  </label>
                  <input
                    id="age"
                    name="age"
                    value={form.age}
                    onChange={(event) => update("age", event.target.value)}
                    type="text"
                    inputMode="text"
                    placeholder="42, 43 or 40-46"
                    aria-label="Age alternatives"
                    maxLength={48}
                  />
                  <small className="field-help">
                    Enter up to {MAX_AGE_ALTERNATIVES} exact ages, or one short inclusive range such as 40-46, only when the DOB is uncertain. Every age becomes a separate exact-age search; this is not an age bracket.
                  </small>
                </div>
                <div className="field">
                  <label htmlFor="gender">{t.gender}</label>
                  <select id="gender" value={form.gender} onChange={(event) => update("gender", event.target.value as FormData["gender"])} required>
                    <option value="" disabled>Select gender</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Third gender</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="district">{t.district} <span className="optional">({t.optional})</span></label>
                  <input
                    id="district"
                    name="district"
                    value={form.district}
                    onChange={(event) => update("district", event.target.value)}
                    placeholder="Leave blank for all districts"
                    maxLength={80}
                    autoComplete="off"
                  />
                </div>
              </div>

              {error && <p className="error-message" role="alert">{error}</p>}

              <p className="privacy-note ai-generation-disclosure">
                {t.privacy}
              </p>
              <div className="actions generation-actions">
                <button
                  className="primary-button"
                  type="submit"
                  name="variantMode"
                  value="ai"
                  disabled={busy}
                >
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {t.continue}<span className="button-arrow" aria-hidden="true">→</span>
                </button>
                <button
                  className="secondary-button"
                  type="submit"
                  name="variantMode"
                  value="offline"
                  disabled={busy}
                >
                  {t.offline}
                </button>
              </div>
            </form>
          )}

          {step === "variants" && (
            <div className="card-body">
              <p className="section-kicker">Step 2 of 4</p>
              <h2>{t.reviewTitle}</h2>
              <p className="section-copy">{t.reviewCopy}</p>
              <p className="selection-note">
                Generated spellings are suggestions only. The names you entered are selected by default; only spellings you check are added to the search queue.
              </p>
              {aiVariantStatus !== "idle" && (
                <p className={`ai-variant-status ${aiVariantStatus}`} role="status">
                  {aiVariantStatus === "generated"
                    ? "AI spelling suggestions added."
                    : aiVariantStatus === "loading"
                      ? "Generating AI spelling suggestions…"
                      : aiVariantStatus === "offline"
                        ? "Offline generic transliteration selected. Review these approximations before searching."
                        : "AI was unavailable or rejected invalid output, so generic offline transliterations are shown."}
                </p>
              )}
              <VariantGroup
                label={t.nameVariants}
                candidates={nameCandidates}
                selected={selectedNames}
                state={form.state}
                onToggle={(value) => toggleVariant(value, "name")}
              />
              <div className="relative-identity-list">
                {relativeVariantGroups.map((group) => (
                  <section className="relative-identity" key={group.relativeId}>
                    <div className="relative-identity-heading">
                      <strong>{group.enteredValue}</strong>
                      <small>Relative identity · suggestions stay in this group</small>
                    </div>
                    <VariantGroup
                      label={`${t.relativeVariants}: ${group.enteredValue}`}
                      candidates={group.candidates}
                      selected={selectedRelatives}
                      state={form.state}
                      onToggle={(value) => toggleVariant(value, "relative")}
                    />
                  </section>
                ))}
              </div>
              <section className="search-plan" aria-label="Planned official searches">
                <div className="search-plan-heading">
                  <strong>Planned search queue</strong>
                  <span>{plannedAttempts.length} queued · 18 hard maximum</span>
                </div>
                {plannedAttempts.length > 0 ? (
                  <ol>
                    {plannedAttempts.map((attempt, index) => (
                      <li key={`${attempt.name}\u0000${attempt.relativeName}\u0000${formatBirthCriterion(attempt.birth)}`}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{attempt.name}</strong>
                          <small>Relative: {attempt.relativeName}</small>
                          <small>{formatBirthCriterion(attempt.birth)}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>Select at least one spelling in each list.</p>
                )}
                <p className="search-plan-note">
                  Only checked spellings are queued. Every selected relative identity gets the first birth-detail search before any full sweep. The primary relative&apos;s remaining age/DOB criteria run first, followed by the other identities and then spelling variants. A short age range expands into separate exact-age searches, which run after an entered DOB. Each row requires a fresh human-entered CAPTCHA, and the queue never exceeds 18 searches.
                </p>
                {cappedCombinationCount > 0 && (
                  <p className="search-plan-cap" role="status">
                    18-search cap applied: {cappedCombinationCount} later selected {cappedCombinationCount === 1 ? "combination was" : "combinations were"} not queued. Uncheck lower-priority spellings to bring a preferred combination into the queue.
                  </p>
                )}
              </section>
              <div
                className={`extension-status ${extensionNeedsUpdate ? "update-required" : extensionState}`}
                role="status"
                data-testid="extension-status"
              >
                <span className="extension-status-dot" aria-hidden="true" />
                <div>
                  <strong>
                    {extensionNeedsUpdate
                      ? `Browser companion update required · v${minimumExtensionVersion}`
                      : extensionState === "available"
                      ? `Browser companion connected${extensionVersion ? ` · v${extensionVersion}` : ""}`
                      : extensionState === "checking"
                        ? "Checking browser companion…"
                        : "Browser companion required"}
                  </strong>
                  <p>
                    {extensionNeedsUpdate
                      ? `Version ${extensionVersion || "unknown"} is connected. Install v${minimumExtensionVersion} to verify the sanitized official API call after a human CAPTCHA submission.`
                      : extensionState === "available"
                      ? "The selected details go directly from this page to the official ECI tab in your browser—not through the SIR Assist server."
                      : "Download the extension, unzip it, load the folder as an unpacked extension, then reload this page."}
                  </p>
                  {(extensionState === "missing" || extensionNeedsUpdate) && (
                    <span className="extension-status-actions">
                      <a
                        className="extension-download"
                        href="/sir-assist-browser-companion.zip"
                        download
                      >
                        Download browser companion
                      </a>
                      <button className="extension-retry" type="button" onClick={reloadPageForExtension}>
                        {extensionNeedsUpdate
                          ? `Reload page to detect v${minimumExtensionVersion}`
                          : "Reload page to detect extension"}
                      </button>
                    </span>
                  )}
                </div>
              </div>
              {error && <p className="error-message" role="alert">{error}</p>}
              <div className="actions">
                <button className="text-button" type="button" onClick={() => setStep("details")}>← {t.back}</button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={startSearch}
                  disabled={
                    busy ||
                    !extensionReady ||
                    plannedAttempts.length === 0
                  }
                  data-testid="start-search"
                >
                  {busy && <span className="spinner" aria-hidden="true" />}
                  Start first of {plannedAttempts.length} planned {plannedAttempts.length === 1 ? "search" : "searches"}<span className="button-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          )}

          {step === "captcha" && (
            <form className="card-body" onSubmit={submitSearch}>
              <p className="section-kicker">Step 3 of 4</p>
              <h2>{t.captchaTitle}</h2>
              <p className="section-copy">{t.captchaCopy}</p>
              <div className="search-summary">
                <div className="search-summary-row"><span>State</span><strong>{stateLabel.english}</strong></div>
                <div className="search-summary-row"><span>Attempt</span><strong>{activeAttemptIndex + 1} of {searchQueue.length}</strong></div>
                <div className="search-summary-row"><span>Name spelling</span><strong>{searchQueue[activeAttemptIndex]?.name}</strong></div>
                <div className="search-summary-row"><span>Relative spelling</span><strong>{searchQueue[activeAttemptIndex]?.relativeName}</strong></div>
                <div className="search-summary-row"><span>Birth criterion</span><strong>{formatBirthCriterion(searchQueue[activeAttemptIndex]?.birth)}</strong></div>
                <div className="search-summary-row"><span>Submission limit</span><strong>1 for this CAPTCHA</strong></div>
              </div>
              <div className="captcha-frame">
                {/* This image is read from the live official page; its text is never interpreted by code. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={captchaImage} alt="CAPTCHA challenge. Read and type the characters shown." />
              </div>
              <span className="human-badge">{t.human}</span>
              {expiresAt && (
                <p className="session-expiry">
                  This CAPTCHA is available for up to three minutes. Submit it promptly; the official page may refresh sooner. Session deadline: {new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.
                </p>
              )}
              <div className="field">
                <label htmlFor="captcha">{t.captchaLabel}</label>
                <input
                  id="captcha"
                  name="captcha"
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={12}
                  required
                  data-testid="captcha-input"
                />
              </div>
              {error && <p className="error-message" role="alert">{error}</p>}
              <div className="actions">
                <button className="text-button" type="button" onClick={() => cancelSearch("variants")}>← Cancel case</button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={refreshCaptcha}
                  disabled={busy || !caseId}
                  data-testid="refresh-captcha"
                >
                  Show a new CAPTCHA
                </button>
                <button className="primary-button" type="submit" disabled={busy || !caseId || captchaAnswer.trim().length < 4} data-testid="submit-search">
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {t.submit}<span className="button-arrow" aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          )}

          {step === "results" && (
            <div className="card-body">
              <p className="section-kicker">Step 4 of 4 · Official search</p>
              {latestFailure && (
                <section className="search-failure-alert" role="alert" aria-labelledby="search-failure-heading">
                  <p>Search {activeAttemptIndex + 1} did not complete</p>
                  <h2 id="search-failure-heading">No official result was recorded</h2>
                  <strong>{latestFailure.message ?? "The browser companion could not complete this official search."}</strong>
                  <span>This is a failed or expired attempt—not a zero-match response from ECI.</span>
                </section>
              )}
              <section
                className={`possible-match-summary ${candidates.length > 0 ? "found" : latestFailure ? "incomplete" : "empty"}`}
                aria-labelledby="possible-match-heading"
                aria-describedby="possible-match-caveat"
              >
                <p className="possible-match-label">
                  {latestFailure && candidates.length === 0
                    ? "Completed-search summary"
                    : "Official ECI response"}
                </p>
                <h2 id="possible-match-heading" ref={resultsHeadingRef} tabIndex={-1}>
                  {candidates.length > 0
                    ? `${candidates.length} possible ${candidates.length === 1 ? "match" : "matches"} found`
                    : latestFailure
                      ? completedAttemptCount > 0
                        ? `${completedZeroCount} completed ${completedZeroCount === 1 ? "search has" : "searches have"} returned zero`
                        : "No completed search result yet"
                      : completedAttemptCount > 0
                        ? "No possible matches returned so far"
                        : "No official result yet"}
                </h2>
                <p id="possible-match-caveat">
                  {candidates.length > 0
                    ? "This is not confirmation of identity. Compare the limited details below with what you know, then verify through the official ECI service."
                    : latestFailure
                      ? "Only completed official searches count toward the summary above. Continue with the next criterion or start a new case."
                      : "A completed zero-result search only describes the exact spelling, relative and birth criterion shown in that attempt. Try another planned combination if available."}
                </p>
              </section>
              {candidates.length > 0 && (
                <section className="verify-first" aria-labelledby="verify-first-heading">
                  <div>
                    <h3 id="verify-first-heading">Found the right person? Stop here and verify officially.</h3>
                    <p>
                      Each further search costs another human-entered CAPTCHA and adds load on the official service. Confirm the match on the official ECI page first; continue the remaining planned searches only if none of these results is the right person.
                    </p>
                  </div>
                  <a href="https://electoralsearch.eci.gov.in/" target="_blank" rel="noreferrer">
                    Verify on official ECI search
                  </a>
                </section>
              )}
              {apiObservation && (
                <section
                  className={`official-api-verification ${apiCallAccepted ? "accepted" : "rejected"}`}
                  aria-labelledby="official-api-verification-heading"
                  data-testid="official-api-verification"
                >
                  <div className="official-api-verification-heading">
                    <span className="official-api-check" aria-hidden="true">{apiCallAccepted ? "✓" : "!"}</span>
                    <div>
                      <p>Local network observation · transport diagnostic, not a search result</p>
                      <h3 id="official-api-verification-heading">Official API call observed</h3>
                      <strong>
                        {apiObservation.method} {apiObservation.endpoint.path} · {apiObservation.status === 0 ? "no HTTP status" : `HTTP ${apiObservation.status}`}
                      </strong>
                    </div>
                  </div>
                  <p className="official-api-privacy">
                    This diagnostic only confirms that the official request completed; whether the record was found is stated in the summary above. Observed locally in this browser only after your human-entered CAPTCHA submission. The request uses an encrypted wire envelope. Only the official URL, method, status and encrypted-envelope key names appear here. No voter input, CAPTCHA or response body enters this diagnostic; the metadata is not logged, sent to SIR Assist servers or stored.
                  </p>
                  {!apiCallAccepted && (
                    <p className="official-api-rejection" role="status">
                      The API call itself was observed, but ECI did not return a successful 2xx status. This attempt is a rejected or interrupted submission—not a completed zero-result search.
                    </p>
                  )}
                  <dl className="official-api-facts">
                    <div>
                      <dt>Official origin</dt>
                      <dd><code>{apiObservation.endpoint.origin}</code></dd>
                    </div>
                    <div>
                      <dt>Transport</dt>
                      <dd>{apiObservation.transport === "xhr" ? "XMLHttpRequest" : "Fetch"}</dd>
                    </div>
                    <div>
                      <dt>Request envelope</dt>
                      <dd>{apiObservation.request.topLevelKeys.length} top-level keys · encrypted values withheld</dd>
                    </div>
                  </dl>
                  <details className="official-api-schema">
                    <summary>Show sanitized schema names</summary>
                    <dl>
                      <div>
                        <dt>Query key names</dt>
                        <dd>{apiObservation.endpoint.queryKeys.join(", ") || "None"}</dd>
                      </div>
                      <div>
                        <dt>Request envelope key names</dt>
                        <dd>{apiObservation.request.topLevelKeys.join(", ") || "None"}</dd>
                      </div>
                      <div>
                        <dt>Request nested key names</dt>
                        <dd>{apiObservation.request.nestedKeys.join(", ") || "None"}</dd>
                      </div>
                    </dl>
                  </details>
                </section>
              )}
              <div className="search-outcome-totals" aria-label="Search outcome totals">
                <span><strong>{completedAttemptCount}</strong> completed</span>
                <span><strong>{completedZeroCount}</strong> completed with zero returned</span>
                <span><strong>{failedAttemptCount}</strong> failed or expired</span>
              </div>
              <section className="result-stack" aria-label="Possible match details">
                {lastAttemptRecord?.status === "completed" && candidates.length === 0 && (
                  <p className="empty-result">
                    The ECI page showed no possible matches after an observed HTTP 2xx response for official search {activeAttemptIndex + 1} and this exact combination.
                  </p>
                )}
                {candidates.map((candidate, index) => (
                  <article className="result-card" key={candidate.id} aria-labelledby={`candidate-heading-${index}`}>
                    <div className="result-head">
                      <div>
                        <span className="result-number">Result {String(index + 1).padStart(2, "0")}</span>
                        <h3 className="candidate-name" id={`candidate-heading-${index}`}>{candidate.displayName}</h3>
                      </div>
                      <span className="match-badge">Possible match</span>
                    </div>
                    <dl className="result-meta">
                      <div><dt>Age band</dt><dd>{candidate.ageBand}</dd></div>
                      <div><dt>District</dt><dd>{candidate.district}</dd></div>
                      <div><dt>Assembly constituency</dt><dd>{candidate.constituency}</dd></div>
                      <div><dt>Returned by</dt><dd>{candidate.matchedOn.join(", ")}</dd></div>
                    </dl>
                  </article>
                ))}
              </section>
              <div className="minimized-callout">
                Privacy guardrail: a displayed age band is privacy-minimized result information, not the bracket searched. Each entered age was searched as an exact alternative. EPIC number, address, polling station and full voter details are intentionally omitted.
              </div>
              {resultLimitReached && (
                <p className="result-limit-warning" role="status">
                  SIR Assist reached its 10-summary privacy limit. Additional official rows may not be displayed; narrow the district or verify directly on ECI before excluding a possible match.
                </p>
              )}
              {showOfficialFallback && (
                <section className="official-fallbacks" aria-labelledby="official-fallbacks-heading">
                  <div>
                    <h3 id="official-fallbacks-heading">Still not found?</h3>
                    <p>
                      Try an EPIC-number search or inspect the published electoral roll directly on an official ECI site. SIR Assist does not receive anything you enter on those pages.
                    </p>
                  </div>
                  <div className="official-fallback-links">
                    <a href="https://electoralsearch.eci.gov.in/" target="_blank" rel="noreferrer">
                      Open official ECI search
                    </a>
                    <a href={officialRollUrl} target="_blank" rel="noreferrer">
                      Download official electoral roll
                    </a>
                    {form.state === "west_bengal" && (
                      <a href="https://ceowestbengal.wb.gov.in/SIR" target="_blank" rel="noreferrer">
                        West Bengal SIR 2026 rolls and lists
                      </a>
                    )}
                  </div>
                </section>
              )}
              <details className="attempt-progress">
                <summary>
                  Search attempts · {attemptHistory.length} of {searchQueue.length} attempted
                </summary>
                <ol>
                  {attemptHistory.map((record, index) => (
                    <li key={`${index}-${record.attempt.name}-${record.attempt.relativeName}-${formatBirthCriterion(record.attempt.birth)}`}>
                      <span className={`attempt-status ${record.status}`}>
                        {record.status === "completed" ? "✓" : "!"}
                      </span>
                      <div>
                        <strong>{record.attempt.name}</strong>
                        <small>
                          {record.attempt.relativeName} · {formatBirthCriterion(record.attempt.birth)} · {record.status === "completed" ? `completed · ${record.candidateCount} returned` : "failed · no official result"}{typeof record.apiStatus === "number" ? ` · ${record.apiStatus === 0 ? "no HTTP status" : `HTTP ${record.apiStatus}`}` : ""}
                        </small>
                        {record.status === "failed" && record.message && (
                          <small className="attempt-message">{record.message}</small>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
              {cooldownRemaining > 0 && (
                <p className="cooldown-note" role="status">
                  The official service rate-limited the last attempt (HTTP 429). To avoid further throttling, the next search unlocks in {cooldownRemaining}s.
                </p>
              )}
              <div className="actions">
                <button className="secondary-button" type="button" onClick={reset}>{t.newSearch}</button>
                {nextAttempt && (
                  <button
                    className={`${candidates.length > 0 ? "secondary-button" : "primary-button"} next-search-button`}
                    type="button"
                    onClick={startNextAttempt}
                    disabled={busy || cooldownRemaining > 0}
                  >
                    <span>
                      <strong>
                        {candidates.length > 0
                          ? `Continue anyway: ${formatBirthCriterion(nextAttempt.birth)}`
                          : `Try ${formatBirthCriterion(nextAttempt.birth)} next`}
                      </strong>
                      <small>{nextAttempt.name} · relative {nextAttempt.relativeName}</small>
                    </span>
                    <span className="button-arrow" aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="role-map" aria-labelledby="role-map-title">
        <h2 id="role-map-title">{t.how.title}</h2>
        <div className="role-grid">
          {t.how.roles.map((role) => (
            <article className="role-card" key={role.title}>
              <h3>{role.title}</h3>
              <p>{role.body}</p>
            </article>
          ))}
        </div>
        <div className="role-limits">
          <h3>{t.how.limitsTitle}</h3>
          <ul>
            {t.how.limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="footer-note">
        <span>SIR Assist is an independent assistance service and is not affiliated with the Election Commission of India.</span>
        <span>
          Local browser companion · Human-entered CAPTCHA ·{" "}
          <a href="/LICENSE.txt">GPL-3.0-or-later · No warranty</a>
        </span>
      </footer>
    </main>
  );
}

function ExtensionPreflight({
  state,
  version,
  needsUpdate,
  onReload,
}: {
  state: ExtensionState;
  version: string;
  needsUpdate: boolean;
  onReload: () => void;
}) {
  return (
    <section className={`extension-preflight ${needsUpdate ? "update-required" : state}`} aria-labelledby="extension-preflight-title">
      <div className="extension-preflight-heading">
        <span className="extension-status-dot" aria-hidden="true" />
        <div>
          <h3 id="extension-preflight-title">
            {needsUpdate
              ? `Update browser companion to v${minimumExtensionVersion}`
              : state === "available"
              ? `Browser companion connected${version ? ` · v${version}` : ""}`
              : state === "checking"
                ? "Checking the browser companion…"
                : "Install the browser companion before searching"}
          </h3>
          <p role="status" aria-live="polite">
            {needsUpdate
              ? `Version ${version || "unknown"} is connected. The update verifies sanitized official API metadata after a human CAPTCHA submission.`
              : state === "available"
              ? "Ready to open the official ECI page locally when you approve a search."
              : "The companion is required only for the official-search and CAPTCHA steps; you can still prepare spelling variants first."}
          </p>
        </div>
      </div>
      {needsUpdate && (
        <div className="extension-update">
          <p>
            Download and unzip the latest ZIP, replace the existing unpacked folder, open <code>chrome://extensions</code>, click <strong>Reload</strong> for SIR Assist Browser Companion, then reload this page.
          </p>
          <div className="extension-preflight-actions">
            <a className="extension-download-button" href="/sir-assist-browser-companion.zip" download>
              Download v{minimumExtensionVersion}
            </a>
            <button className="extension-retry" type="button" onClick={onReload}>
              Reload page to detect v{minimumExtensionVersion}
            </button>
          </div>
        </div>
      )}
      {state === "missing" && (
        <div className="extension-first-run">
          <p>
            <strong>Why it is needed:</strong> ECI requires its real webpage and a human-entered CAPTCHA. SIR Assist does not send that search through its server. The companion opens ECI in your browser, fills one approved search, shows the official CAPTCHA here for you to type, and returns only a minimized possible-match summary.
          </p>
          <p className="extension-guardrail">
            It cannot solve CAPTCHAs, read unrelated websites, access browsing history, or return full voter records.
          </p>
          <ol>
            <li>Download the browser companion ZIP.</li>
            <li>Unzip the downloaded file.</li>
            <li>Open <code>chrome://extensions</code>, enable <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, and select the unzipped folder.</li>
            <li>Reload SIR Assist and confirm “Browser companion connected”.</li>
          </ol>
          <div className="extension-preflight-actions">
            <a className="extension-download-button" href="/sir-assist-browser-companion.zip" download>
              Download browser companion
            </a>
            <button className="extension-retry" type="button" onClick={onReload}>
              Reload page to detect extension
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function VariantGroup({
  label,
  candidates,
  selected,
  state,
  onToggle,
}: {
  label: string;
  candidates: VariantCandidate[];
  selected: string[];
  state: SupportedState;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="variant-group">
      <legend className="variant-label">
        <span>{label}</span>
        <span className="variant-count">
          Select one or more · {candidates.filter((candidate) => selected.includes(candidate.value)).length} of {candidates.length}
        </span>
      </legend>
      <div className="variant-list">
        {candidates.map((candidate) => (
          <label className="variant-choice" key={candidate.value}>
            <input type="checkbox" name={label} checked={selected.includes(candidate.value)} onChange={() => onToggle(candidate.value)} />
            <span className="variant-copy">
              <span>{candidate.value}</span>
              <span className="variant-badges">
                <small>{sourceLabel[candidate.source]}</small>
                <small>{variantScript(candidate.value, state)}</small>
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
