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
  "local-transliteration": 3,
  "local-spelling": 2,
  ai: 1,
});

function candidateKey(value) {
  return clean(value).toLocaleLowerCase();
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
  const voterCandidates = mergeCandidates(
    [
      ...voterLocal.slice(0, 2),
      ...(aiSuggestions?.voterNameVariants ?? []).map((value) => ({
        value,
        source: "ai",
      })),
      ...voterLocal.slice(2),
    ],
    MAX_VARIANTS_PER_NAME,
  );
  const relativeGroups = relativeIdentities.map((identity) => {
    const local = localCandidates(identity.value, input.state);
    return {
      relativeId: identity.relativeId,
      candidates: mergeCandidates(
        [
          ...local.slice(0, 2),
          ...(aiRelativeById.get(identity.relativeId) ?? []).map((value) => ({
            value,
            source: "ai",
          })),
          ...local.slice(2),
        ],
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
    const validated = assertStateScriptCoverage(
      suggested,
      input.state,
      relativeGroups.map((group) => group.relativeId),
    );
    return buildSuggestionResult(input, validated, "generated");
  } catch {
    return buildSuggestionResult(input, null, "fallback");
  }
}
