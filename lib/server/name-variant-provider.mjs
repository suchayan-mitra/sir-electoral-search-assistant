/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  generateVariants,
  supportedStates,
  transliterateToStateScript,
} from "../variants.mjs";

export const MAX_VARIANTS_PER_NAME = 6;
export const MAX_RELATIVE_IDENTITIES = 6;
export const MAX_CANDIDATES_PER_RELATIVE = 4;
export const MAX_RELATIVE_VARIANTS =
  MAX_RELATIVE_IDENTITIES * MAX_CANDIDATES_PER_RELATIVE;
export const MAX_PLANNED_SEARCHES = 18;
export const AI_NAME_VARIANT_MODEL = "@cf/moonshotai/kimi-k2.6";

const supportedStateSet = new Set(supportedStates);
function devanagariTarget(stateName) {
  return Object.freeze({
    stateName,
    language: "Hindi",
    script: "Devanagari",
    nativePattern: /[\u0900-\u097f]/,
  });
}
const stateLanguageTargets = Object.freeze({
  karnataka: Object.freeze({
    stateName: "Karnataka",
    language: "Kannada",
    script: "Kannada",
    nativePattern: /[\u0c80-\u0cff]/,
  }),
  west_bengal: Object.freeze({
    stateName: "West Bengal",
    language: "Bengali",
    script: "Bengali",
    nativePattern: /[\u0980-\u09ff]/,
  }),
  odisha: Object.freeze({
    stateName: "Odisha",
    language: "Odia",
    script: "Odia",
    nativePattern: /[\u0b00-\u0b7f]/,
  }),
  bihar: devanagariTarget("Bihar"),
  chhattisgarh: devanagariTarget("Chhattisgarh"),
  delhi: devanagariTarget("NCT of Delhi"),
  jharkhand: devanagariTarget("Jharkhand"),
  madhya_pradesh: devanagariTarget("Madhya Pradesh"),
  rajasthan: devanagariTarget("Rajasthan"),
  uttar_pradesh: devanagariTarget("Uttar Pradesh"),
  uttarakhand: devanagariTarget("Uttarakhand"),
});
const allowedRequestKeys = new Set([
  "state",
  "voterName",
  "relativeNames",
  "aiOptIn",
]);

function clean(value, maxLength = 80) {
  return typeof value === "string"
    ? value.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function boundedUnique(values, limit = MAX_VARIANTS_PER_NAME) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

const candidateSourcePriority = Object.freeze({
  entered: 4,
  ai: 3,
  "local-transliteration": 2,
  "local-spelling": 1,
});

function candidateKey(value) {
  return clean(value).toLocaleLowerCase();
}

const unicodeLetterPattern = /\p{L}/u;
const latinLetterPattern = /\p{Script=Latin}/u;
const separatorPattern = /[\s\-\u2010-\u2015]+/u;

function nameComponents(value) {
  return clean(value)
    .split(separatorPattern)
    .map((component) => component.replace(/[.'’]/gu, ""))
    .filter(Boolean);
}

function scriptKind(value, state) {
  const letters = [...clean(value)].filter((character) =>
    unicodeLetterPattern.test(character),
  );
  if (letters.length === 0) return "other";
  if (letters.every((character) => latinLetterPattern.test(character))) {
    return "roman";
  }
  const nativePattern = stateLanguageTargets[state]?.nativePattern;
  if (
    nativePattern &&
    letters.every((character) => nativePattern.test(character))
  ) {
    return "native";
  }
  return "mixed";
}

function romanSignature(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Script=Latin}]/gu, "")
    .replace(/aa/g, "a")
    .replace(/(?:ee|ii)/g, "i")
    .replace(/(?:oo|uu)/g, "u")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/ch/g, "c")
    .replace(/jh/g, "j")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/sh/g, "s")
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/c/g, "k")
    .replace(/[vw]/g, "b")
    .replace(/(.)\1+/g, "$1");
}

function nativeSignature(value) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}]/gu, "");
}

function editDistance(leftValue, rightValue) {
  const left = [...leftValue];
  const right = [...rightValue];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function firstConsonant(value) {
  return [...value].find((character) => !"aeiou".includes(character)) ?? "";
}

function romanComponentMatches(reference, candidate) {
  const left = romanSignature(reference);
  const right = romanSignature(candidate);
  if (!left || !right) return false;
  if (left.length === 1 || right.length === 1) return left === right;
  if (firstConsonant(left) !== firstConsonant(right)) return false;
  const ratio = right.length / left.length;
  const allowedEdits = Math.min(3, Math.max(1, Math.floor(left.length * 0.25)));
  return (
    ratio >= 0.67 &&
    ratio <= 1.5 &&
    editDistance(left, right) <= allowedEdits
  );
}

function nativeComponentMatches(reference, candidate) {
  const left = nativeSignature(reference);
  const right = nativeSignature(candidate);
  if (!left || !right) return false;
  const ratio = right.length / left.length;
  const allowedEdits = Math.min(5, Math.max(2, Math.ceil(left.length * 0.45)));
  return (
    ratio >= 0.5 &&
    ratio <= 1.8 &&
    editDistance(left, right) <= allowedEdits
  );
}

function componentSequencesMatch(reference, candidate, componentMatches) {
  const referenceParts = nameComponents(reference);
  const candidateParts = nameComponents(candidate);
  if (referenceParts.length === 0 || candidateParts.length === 0) return false;

  const memo = new Map();
  function visit(referenceIndex, candidateIndex) {
    const key = `${referenceIndex}:${candidateIndex}`;
    if (memo.has(key)) return memo.get(key);
    if (
      referenceIndex === referenceParts.length &&
      candidateIndex === candidateParts.length
    ) {
      return true;
    }
    if (
      referenceIndex >= referenceParts.length ||
      candidateIndex >= candidateParts.length
    ) {
      return false;
    }

    const oneToOne =
      componentMatches(
        referenceParts[referenceIndex],
        candidateParts[candidateIndex],
      ) && visit(referenceIndex + 1, candidateIndex + 1);
    if (oneToOne) {
      memo.set(key, true);
      return true;
    }

    const twoReferenceParts = referenceParts.slice(
      referenceIndex,
      referenceIndex + 2,
    );
    const twoCandidateParts = candidateParts.slice(
      candidateIndex,
      candidateIndex + 2,
    );
    const twoToOne =
      twoReferenceParts.length === 2 &&
      twoReferenceParts.every((part) => [...part].length > 1) &&
      componentMatches(
        twoReferenceParts.join(""),
        candidateParts[candidateIndex],
      ) &&
      visit(referenceIndex + 2, candidateIndex + 1);
    if (twoToOne) {
      memo.set(key, true);
      return true;
    }

    const oneToTwo =
      twoCandidateParts.length === 2 &&
      twoCandidateParts.every((part) => [...part].length > 1) &&
      componentMatches(
        referenceParts[referenceIndex],
        twoCandidateParts.join(""),
      ) &&
      visit(referenceIndex + 1, candidateIndex + 2);
    memo.set(key, oneToTwo);
    return oneToTwo;
  }

  return visit(0, 0);
}

function isIdentityPreservingVariant(variant, enteredValue, state) {
  const variantKind = scriptKind(variant, state);
  const enteredKind = scriptKind(enteredValue, state);
  if (variantKind === "mixed" || variantKind === "other") return false;

  if (variantKind === "roman" && enteredKind === "roman") {
    return componentSequencesMatch(
      enteredValue,
      variant,
      romanComponentMatches,
    );
  }
  if (variantKind === "native" && enteredKind === "roman") {
    return componentSequencesMatch(
      transliterateToStateScript(enteredValue, state),
      variant,
      nativeComponentMatches,
    );
  }
  if (variantKind === "native" && enteredKind === "native") {
    return componentSequencesMatch(
      enteredValue,
      variant,
      nativeComponentMatches,
    );
  }

  // A reverse transliterator is not available for native-only input. Preserve
  // component structure and leave every AI suggestion unchecked for review.
  return nameComponents(enteredValue).length === nameComponents(variant).length;
}

function identityPreservingVariants(values, enteredValue, state, limit) {
  return boundedUnique(values, limit).filter((variant) =>
    isIdentityPreservingVariant(variant, enteredValue, state),
  );
}

export function filterIdentityPreservingSuggestions(
  suggestions,
  input,
  relativeGroups,
) {
  if (
    !suggestions ||
    !Array.isArray(suggestions.voterNameVariants) ||
    !Array.isArray(suggestions.relativeGroups)
  ) {
    throw new Error("AI variant groups were invalid.");
  }
  const relativeById = new Map(
    relativeGroups.map((group) => [group.relativeId, group.value]),
  );
  return {
    voterNameVariants: identityPreservingVariants(
      suggestions.voterNameVariants,
      input.voterName,
      input.state,
      MAX_VARIANTS_PER_NAME,
    ),
    relativeGroups: suggestions.relativeGroups.map((group) => {
      const enteredValue = relativeById.get(group?.relativeId);
      if (!enteredValue || !Array.isArray(group?.variants)) {
        throw new Error("AI relative group did not match an entered name.");
      }
      return {
        relativeId: group.relativeId,
        variants: identityPreservingVariants(
          group.variants,
          enteredValue,
          input.state,
          MAX_CANDIDATES_PER_RELATIVE,
        ),
      };
    }),
  };
}

function mergeCandidates(candidates, limit) {
  const merged = new Map();
  for (const candidate of candidates) {
    const value = clean(candidate?.value);
    const source = candidate?.source;
    if (!value || !Object.hasOwn(candidateSourcePriority, source)) continue;
    const key = candidateKey(value);
    const existing = merged.get(key);
    if (
      !existing ||
      candidateSourcePriority[source] > candidateSourcePriority[existing.source]
    ) {
      merged.set(key, { value, source });
    }
  }
  return [...merged.values()].slice(0, limit);
}

function localCandidates(input, state) {
  const entered = clean(input);
  const transliteration = clean(transliterateToStateScript(entered, state));
  const candidates = [{ value: entered, source: "entered" }];
  if (
    transliteration &&
    candidateKey(transliteration) !== candidateKey(entered)
  ) {
    candidates.push({
      value: transliteration,
      source: "local-transliteration",
    });
  }
  for (const value of generateVariants(entered, state, MAX_VARIANTS_PER_NAME)) {
    if (
      candidateKey(value) === candidateKey(entered) ||
      candidateKey(value) === candidateKey(transliteration)
    ) {
      continue;
    }
    candidates.push({
      value,
      source: stateLanguageTargets[state]?.nativePattern.test(value)
        ? "local-transliteration"
        : "local-spelling",
    });
  }
  return candidates;
}

function assignRelativeIds(relativeNames) {
  return boundedUnique(relativeNames, MAX_RELATIVE_IDENTITIES).map(
    (value, index) => ({ relativeId: `r${index + 1}`, value }),
  );
}

export function validateNameVariantRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedRequestKeys.has(key))) return null;

  const state = String(value.state ?? "");
  const voterName = clean(value.voterName);
  const relativeNames = boundedUnique(
    value.relativeNames,
    MAX_RELATIVE_IDENTITIES,
  );
  if (
    !supportedStateSet.has(state) ||
    !voterName ||
    relativeNames.length === 0 ||
    value.aiOptIn !== true
  ) {
    return null;
  }
  return Object.freeze({
    state,
    voterName,
    relativeNames: Object.freeze(relativeNames),
    aiOptIn: true,
  });
}

/**
 * Replace this provider with a sanctioned AI adapter later. Implementations must
 * accept names/state only and return spelling suggestions only. CAPTCHA data is
 * intentionally absent from this boundary.
 */
export class UnavailableAiNameVariantProvider {
  id = "unavailable";

  isConfigured() {
    return false;
  }

  /** @returns {Promise<{voterNameVariants: string[], relativeGroups: Array<{relativeId: string, variants: string[]}>}>} */
  async suggest() {
    throw new Error("AI name-variant provider is not configured.");
  }
}

export function parseAiVariantResponse(value, expectedRelativeIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI response was not an object.");
  }
  const objectResponse =
    value.response &&
    typeof value.response === "object" &&
    !Array.isArray(value.response)
      ? value.response
      : null;
  const responseText =
    typeof value.response === "string"
      ? value.response
      : value.choices?.[0]?.message?.content;
  if (
    !objectResponse &&
    (typeof responseText !== "string" || responseText.length > 8_000)
  ) {
    throw new Error("AI response text was missing or too large.");
  }

  const parsed = objectResponse ?? JSON.parse(responseText.trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI response JSON was not an object.");
  }
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "relativeGroups" ||
    keys[1] !== "voterNameVariants"
  ) {
    throw new Error("AI response JSON had unexpected fields.");
  }

  function strictArray(candidate, limit) {
    if (!Array.isArray(candidate) || candidate.length > limit) {
      throw new Error("AI response variants were not bounded arrays.");
    }
    if (
      candidate.some(
        (item) =>
          typeof item !== "string" ||
          item.length === 0 ||
          item.length > 80 ||
          item.trim() !== item,
      )
    ) {
      throw new Error("AI response contained an invalid variant.");
    }
    return boundedUnique(candidate, limit);
  }

  if (
    !Array.isArray(expectedRelativeIds) ||
    expectedRelativeIds.length === 0 ||
    expectedRelativeIds.length > MAX_RELATIVE_IDENTITIES
  ) {
    throw new Error("Expected relative IDs were invalid.");
  }

  if (
    !Array.isArray(parsed.relativeGroups) ||
    parsed.relativeGroups.length !== expectedRelativeIds.length
  ) {
    throw new Error("AI response did not return every relative group.");
  }

  const expectedIds = new Set(expectedRelativeIds);
  const groupsById = new Map();
  for (const group of parsed.relativeGroups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Error("AI relative group was invalid.");
    }
    const groupKeys = Object.keys(group).sort();
    if (
      groupKeys.length !== 2 ||
      groupKeys[0] !== "relativeId" ||
      groupKeys[1] !== "variants" ||
      typeof group.relativeId !== "string" ||
      !expectedIds.has(group.relativeId) ||
      groupsById.has(group.relativeId)
    ) {
      throw new Error("AI response had an unknown or duplicate relative ID.");
    }
    groupsById.set(group.relativeId, {
      relativeId: group.relativeId,
      variants: strictArray(group.variants, MAX_CANDIDATES_PER_RELATIVE),
    });
  }

  return {
    voterNameVariants: strictArray(
      parsed.voterNameVariants,
      MAX_VARIANTS_PER_NAME,
    ),
    relativeGroups: expectedRelativeIds.map((relativeId) =>
      groupsById.get(relativeId),
    ),
  };
}

export function assertStateScriptCoverage(
  suggestions,
  state,
  expectedRelativeIds,
) {
  const target = stateLanguageTargets[state];
  if (!target) throw new Error("AI variant state was unsupported.");
  const hasRoman = (value) => /[A-Za-z]/.test(value);
  const hasNative = (value) => target.nativePattern.test(value);
  const voterRoman = suggestions.voterNameVariants.filter(hasRoman).length;
  const voterNative = suggestions.voterNameVariants.filter(hasNative).length;
  if (voterRoman < 1 || voterNative < 1) {
    throw new Error(
      "AI variants did not include both Roman and state-native spellings.",
    );
  }
  if (
    suggestions.relativeGroups.length !== expectedRelativeIds.length ||
    suggestions.relativeGroups.some((group, index) => {
      if (group.relativeId !== expectedRelativeIds[index]) return true;
      return (
        group.variants.filter(hasRoman).length < 1 ||
        group.variants.filter(hasNative).length < 1
      );
    })
  ) {
    throw new Error(
      "Each AI relative group must include Roman and state-native spellings.",
    );
  }
  return suggestions;
}

function buildVariantSystemPrompt(state, relativeCount) {
  const target = stateLanguageTargets[state];
  if (!target) throw new Error("AI variant state was unsupported.");
  return [
    "You generate constrained orthographic and transliteration variants for electoral-roll name lookup; you do not create or modify identities.",
    `The selected state is ${target.stateName}. Its target language is ${target.language} and its native script is ${target.script}.`,
    "For the voter and for every supplied relative ID, include at least one complete Roman-script spelling and at least one complete target-native-script spelling.",
    "Preserve the same person and every supplied name component in every variant. Never add, remove, replace, translate, or invent a given name, middle name, surname, initial, honorific, or relationship label.",
    "Do not merge two relatives, split one person into multiple people, reorder name components, infer family names, or add facts.",
    "Roman variants may make only conservative phonetic spelling changes. Native-script variants must be transliterations of the full supplied name, not translations or substitutes.",
    "Allow only conservative spacing, joining, hyphenation, vowel-length, and established target-script orthographic alternatives. Never introduce or discard a name component.",
    "Order the strongest likely electoral-roll spellings first. Generate every suggestion from the supplied full name; the application has no person-specific name dictionary.",
    `Return exactly ${relativeCount} relativeGroups, one for each opaque relativeId supplied. Copy each relativeId exactly once; never omit, duplicate, create, guess, or rename an ID. Keep variants within its own relative group.`,
    `Return strict JSON with exactly voterNameVariants and relativeGroups. Each relative group must have exactly relativeId and variants. Return at most ${MAX_VARIANTS_PER_NAME} voter strings and ${MAX_CANDIDATES_PER_RELATIVE} strings per relative. Return no explanation and no other fields.`,
  ].join(" ");
}

export class CloudflareAiNameVariantProvider {
  id = "cloudflare-workers-ai";

  constructor(ai) {
    this.ai = ai;
  }

  isConfigured() {
    return Boolean(this.ai && typeof this.ai.run === "function");
  }

  async suggest(input) {
    if (!this.isConfigured()) {
      throw new Error("Workers AI binding is not configured.");
    }
    const relativeGroups = input.relativeGroups.slice(
      0,
      MAX_RELATIVE_IDENTITIES,
    );
    const expectedRelativeIds = relativeGroups.map(
      (group) => group.relativeId,
    );
    const output = await this.ai.run(AI_NAME_VARIANT_MODEL, {
      messages: [
        {
          role: "system",
          content: buildVariantSystemPrompt(
            input.state,
            relativeGroups.length,
          ),
        },
        {
          role: "user",
          content: JSON.stringify({
            state: input.state,
            voterName: input.voterName,
            relativeGroups: relativeGroups.map((group) => ({
              relativeId: group.relativeId,
              name: group.value,
            })),
          }),
        },
      ],
      max_completion_tokens: 400,
      temperature: 0.2,
      chat_template_kwargs: { thinking: false },
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            voterNameVariants: {
              type: "array",
              minItems: 1,
              maxItems: MAX_VARIANTS_PER_NAME,
              description:
                "Complete voter-name spellings for the same identity, including Roman and selected state-native script forms; no name component may be added or removed.",
              items: {
                type: "string",
                maxLength: 80,
                description:
                  "A complete spelling or transliteration of the supplied voter name, preserving every name component and surname.",
              },
            },
            relativeGroups: {
              type: "array",
              minItems: relativeGroups.length,
              maxItems: relativeGroups.length,
              description:
                "Exactly one group for each supplied opaque relative ID; IDs must not be omitted, duplicated, changed, or invented.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  relativeId: {
                    type: "string",
                    enum: expectedRelativeIds,
                  },
                  variants: {
                    type: "array",
                    minItems: 2,
                    maxItems: MAX_CANDIDATES_PER_RELATIVE,
                    items: {
                      type: "string",
                      maxLength: 80,
                      description:
                        "A complete Roman or state-native spelling of only the name assigned to this relative ID.",
                    },
                  },
                },
                required: ["relativeId", "variants"],
              },
            },
          },
          required: ["voterNameVariants", "relativeGroups"],
        },
      },
    });
    return assertStateScriptCoverage(
      parseAiVariantResponse(output, expectedRelativeIds),
      input.state,
      expectedRelativeIds,
    );
  }
}

function buildSuggestionResult(input, aiSuggestions, aiStatus) {
  const relativeIdentities = assignRelativeIds(input.relativeNames);
  const aiRelativeById = new Map(
    (aiSuggestions?.relativeGroups ?? []).map((group) => [
      group.relativeId,
      group.variants,
    ]),
  );
  const voterLocal = localCandidates(input.voterName, input.state);
  const aiGenerated = aiStatus === "generated" && Boolean(aiSuggestions);
  const voterCandidates = mergeCandidates(
    aiGenerated
      ? [
          voterLocal[0],
          ...aiSuggestions.voterNameVariants.map((value) => ({
            value,
            source: "ai",
          })),
        ]
      : voterLocal,
    MAX_VARIANTS_PER_NAME,
  );
  const relativeGroups = relativeIdentities.map((identity) => {
    const local = localCandidates(identity.value, input.state);
    return {
      relativeId: identity.relativeId,
      candidates: mergeCandidates(
        aiGenerated
          ? [
              local[0],
              ...(aiRelativeById.get(identity.relativeId) ?? []).map(
                (value) => ({ value, source: "ai" }),
              ),
            ]
          : local,
        MAX_CANDIDATES_PER_RELATIVE,
      ),
    };
  });

  return {
    voterNameVariants: voterCandidates.map((candidate) => candidate.value),
    relativeNameVariants: relativeGroups.flatMap((group) =>
      group.candidates.map((candidate) => candidate.value),
    ),
    voterCandidates,
    relativeGroups,
    ai: {
      requested: Boolean(input.aiOptIn),
      used: aiStatus === "generated",
      status: aiStatus,
    },
    limits: {
      variantsPerName: MAX_VARIANTS_PER_NAME,
      candidatesPerRelative: MAX_CANDIDATES_PER_RELATIVE,
      relativeIdentities: MAX_RELATIVE_IDENTITIES,
      plannedSearches: MAX_PLANNED_SEARCHES,
    },
  };
}

export async function suggestNameVariants(
  input,
  /** @type {{isConfigured(): boolean, suggest(input: {state: string, voterName: string, relativeGroups: Array<{relativeId: string, value: string}>}): Promise<{voterNameVariants: string[], relativeGroups: Array<{relativeId: string, variants: string[]}>}>}} */
  provider = new UnavailableAiNameVariantProvider(),
) {
  if (!input.aiOptIn || !provider.isConfigured()) {
    return buildSuggestionResult(input, null, "not_configured");
  }

  try {
    const relativeGroups = assignRelativeIds(input.relativeNames);
    const suggested = await provider.suggest({
      state: input.state,
      voterName: input.voterName,
      relativeGroups,
    });
    const identityChecked = filterIdentityPreservingSuggestions(
      suggested,
      input,
      relativeGroups,
    );
    const validated = assertStateScriptCoverage(
      identityChecked,
      input.state,
      relativeGroups.map((group) => group.relativeId),
    );
    return buildSuggestionResult(input, validated, "generated");
  } catch {
    return buildSuggestionResult(input, null, "fallback");
  }
}
