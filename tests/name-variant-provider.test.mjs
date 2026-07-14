import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_NAME_VARIANT_MODEL,
  assertStateScriptCoverage,
  CloudflareAiNameVariantProvider,
  MAX_CANDIDATES_PER_RELATIVE,
  MAX_PLANNED_SEARCHES,
  MAX_RELATIVE_IDENTITIES,
  MAX_VARIANTS_PER_NAME,
  parseAiVariantResponse,
  suggestNameVariants,
  UnavailableAiNameVariantProvider,
  validateNameVariantRequest,
} from "../lib/server/name-variant-provider.mjs";

const validRequest = {
  state: "karnataka",
  voterName: "Ramesh",
  relativeNames: ["Suresh", "Lakshmi"],
  aiOptIn: true,
};

const validAiSuggestions = {
  voterNameVariants: ["Ramesh", "ರಮೇಶ್"],
  relativeGroups: [
    { relativeId: "r1", variants: ["Suresh", "ಸುರೇಶ್"] },
    { relativeId: "r2", variants: ["Lakshmi", "ಲಕ್ಷ್ಮಿ"] },
  ],
};

test("variant boundary requires an explicit AI request and accepts at most six names", () => {
  assert.deepEqual(validateNameVariantRequest(validRequest), validRequest);
  assert.equal(
    validateNameVariantRequest({ ...validRequest, aiOptIn: false }),
    null,
  );
  assert.equal(
    validateNameVariantRequest({ ...validRequest, captchaAnswer: "SECRET" }),
    null,
  );
  const bounded = validateNameVariantRequest({
    ...validRequest,
    relativeNames: Array.from({ length: 9 }, (_, index) => `Relative ${index}`),
  });
  assert.equal(bounded.relativeNames.length, MAX_RELATIVE_IDENTITIES);
});

test("unavailable AI uses bounded generic fallback in every supported script", async () => {
  const provider = new UnavailableAiNameVariantProvider();
  let called = false;
  provider.suggest = async () => {
    called = true;
    return validAiSuggestions;
  };
  const cases = [
    { state: "karnataka", script: /[\u0c80-\u0cff]/ },
    { state: "west_bengal", script: /[\u0980-\u09ff]/ },
    { state: "odisha", script: /[\u0b00-\u0b7f]/ },
  ];
  for (const { state, script } of cases) {
    const result = await suggestNameVariants(
      {
        state,
        voterName: "Naren Dal",
        relativeNames: ["Pavan Sen"],
        aiOptIn: true,
      },
      provider,
    );
    assert.equal(result.ai.status, "not_configured");
    assert.equal(result.voterCandidates[0].value, "Naren Dal");
    assert.equal(result.voterCandidates[0].source, "entered");
    assert.ok(
      result.voterCandidates.some(
        (candidate) =>
          candidate.source === "local-transliteration" &&
          script.test(candidate.value),
      ),
    );
    assert.ok(result.voterCandidates.length <= MAX_VARIANTS_PER_NAME);
    assert.ok(
      result.relativeGroups.every(
        (group) => group.candidates.length <= MAX_CANDIDATES_PER_RELATIVE,
      ),
    );
    assert.equal(result.limits.plannedSearches, MAX_PLANNED_SEARCHES);
  }
  assert.equal(called, false);
});

test("configured AI failure falls back without retrying or exposing the error", async () => {
  let calls = 0;
  const result = await suggestNameVariants(validRequest, {
    isConfigured: () => true,
    suggest: async () => {
      calls += 1;
      throw new Error("private provider failure");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ai.status, "fallback");
  assert.equal(result.ai.used, false);
  assert.ok(
    result.voterCandidates.slice(1).every((candidate) =>
      candidate.source.startsWith("local-"),
    ),
  );
  assert.equal(JSON.stringify(result).includes("private provider failure"), false);
});

test("provider receives opaque IDs and AI suggestions follow entered values", async () => {
  const provider = {
    isConfigured: () => true,
    suggest: async (input) => {
      assert.deepEqual(input.relativeGroups, [
        { relativeId: "r1", value: "Suresh" },
        { relativeId: "r2", value: "Lakshmi" },
      ]);
      assert.equal("relativeNames" in input, false);
      return validAiSuggestions;
    },
  };
  const result = await suggestNameVariants(validRequest, provider);
  assert.equal(result.ai.status, "generated");
  assert.deepEqual(
    result.voterCandidates.slice(0, 2).map((candidate) => candidate.source),
    ["entered", "ai"],
  );
  assert.ok(
    [
      ...result.voterCandidates.slice(1),
      ...result.relativeGroups.flatMap((group) => group.candidates.slice(1)),
    ].every((candidate) => candidate.source === "ai"),
  );
  assert.equal(
    result.voterCandidates.find((candidate) => candidate.value === "Ramesh")
      .source,
    "entered",
  );
  assert.equal(
    result.relativeGroups[0].candidates.find(
      (candidate) => candidate.value === "Suresh",
    ).source,
    "entered",
  );
  assert.ok(
    result.voterCandidates.every((candidate) =>
      ["entered", "local-transliteration", "local-spelling", "ai"].includes(
        candidate.source,
      ),
    ),
  );
});

test("entered values remain entered while AI outranks matching generic output", async () => {
  const result = await suggestNameVariants(
    {
      state: "karnataka",
      voterName: "Amit",
      relativeNames: ["Suman"],
      aiOptIn: true,
    },
    {
      isConfigured: () => true,
      suggest: async () => ({
        voterNameVariants: ["Amit", "ಅಮಿತ"],
        relativeGroups: [
          { relativeId: "r1", variants: ["Suman", "ಸುಮನ"] },
        ],
      }),
    },
  );
  assert.equal(
    result.voterCandidates.find((candidate) => candidate.value === "Amit")
      .source,
    "entered",
  );
  assert.equal(
    result.voterCandidates.find((candidate) => candidate.value === "ಅಮಿತ")
      .source,
    "ai",
  );
  assert.equal(
    result.relativeGroups[0].candidates.find(
      (candidate) => candidate.value === "ಸುಮನ",
    ).source,
    "ai",
  );
  assert.equal(
    result.voterCandidates.some((candidate) =>
      candidate.source.startsWith("local-"),
    ),
    false,
  );
});

test("invalid provider grouping falls back without leaking provider errors", async () => {
  const result = await suggestNameVariants(validRequest, {
    isConfigured: () => true,
    suggest: async () => ({
      voterNameVariants: ["Ramesh", "ರಮೇಶ್"],
      relativeGroups: [
        { relativeId: "r1", variants: ["Suresh", "ಸುರೇಶ್"] },
        { relativeId: "unknown", variants: ["Lakshmi", "ಲಕ್ಷ್ಮಿ"] },
      ],
    }),
  });
  assert.equal(result.ai.status, "fallback");
  assert.equal(result.ai.used, false);
  assert.equal(result.relativeGroups[1].relativeId, "r2");
});

test("Cloudflare adapter sends grouped opaque IDs and strict grouped schema", async () => {
  let invocation;
  const provider = new CloudflareAiNameVariantProvider({
    run: async (model, input) => {
      invocation = { model, input };
      return { response: validAiSuggestions };
    },
  });
  const suggestions = await provider.suggest({
    state: validRequest.state,
    voterName: validRequest.voterName,
    relativeGroups: [
      { relativeId: "r1", value: "Suresh" },
      { relativeId: "r2", value: "Lakshmi" },
    ],
  });
  assert.equal(invocation.model, AI_NAME_VARIANT_MODEL);
  const payload = JSON.parse(invocation.input.messages[1].content);
  assert.deepEqual(payload.relativeGroups, [
    { relativeId: "r1", name: "Suresh" },
    { relativeId: "r2", name: "Lakshmi" },
  ]);
  assert.equal("relativeNames" in payload, false);
  assert.equal(/captcha|district|age/i.test(JSON.stringify(payload)), false);
  const schema = invocation.input.response_format.json_schema;
  assert.deepEqual(
    schema.properties.relativeGroups.items.properties.relativeId.enum,
    ["r1", "r2"],
  );
  assert.equal(
    schema.properties.relativeGroups.items.properties.variants.maxItems,
    MAX_CANDIDATES_PER_RELATIVE,
  );
  assert.match(
    invocation.input.messages[0].content,
    /Never introduce or discard a name component/,
  );
  assert.deepEqual(suggestions, validAiSuggestions);
});

test("parser rejects unknown, duplicate, and missing relative IDs", () => {
  const responses = [
    {
      ...validAiSuggestions,
      relativeGroups: [
        validAiSuggestions.relativeGroups[0],
        { relativeId: "r3", variants: ["Lakshmi", "ಲಕ್ಷ್ಮಿ"] },
      ],
    },
    {
      ...validAiSuggestions,
      relativeGroups: [
        validAiSuggestions.relativeGroups[0],
        validAiSuggestions.relativeGroups[0],
      ],
    },
    {
      ...validAiSuggestions,
      relativeGroups: [validAiSuggestions.relativeGroups[0]],
    },
  ];
  for (const response of responses) {
    assert.throws(() =>
      parseAiVariantResponse({ response }, ["r1", "r2"]),
    );
  }
});

test("parser rejects model-assigned provenance and extra group fields", () => {
  assert.throws(() =>
    parseAiVariantResponse(
      {
        response: {
          ...validAiSuggestions,
          relativeGroups: [
            {
              relativeId: "r1",
              variants: ["Suresh", "ಸುರೇಶ್"],
              source: "entered",
            },
            validAiSuggestions.relativeGroups[1],
          ],
        },
      },
      ["r1", "r2"],
    ),
  );
});

test("state-script coverage is enforced inside every relative group", () => {
  const cases = [
    {
      state: "karnataka",
      suggestions: {
        voterNameVariants: ["Ramesh", "ರಮೇಶ್"],
        relativeGroups: [
          { relativeId: "r1", variants: ["Suresh", "ಸುರೇಶ್"] },
        ],
      },
    },
    {
      state: "west_bengal",
      suggestions: {
        voterNameVariants: ["Example Voter", "উদাহরণ ভোটার"],
        relativeGroups: [
          {
            relativeId: "r1",
            variants: ["Example Relative", "উদাহরণ আত্মীয়"],
          },
        ],
      },
    },
    {
      state: "odisha",
      suggestions: {
        voterNameVariants: ["Ramesh Das", "ରମେଶ ଦାସ"],
        relativeGroups: [
          { relativeId: "r1", variants: ["Suresh Das", "ସୁରେଶ ଦାସ"] },
        ],
      },
    },
  ];
  for (const { state, suggestions } of cases) {
    assert.equal(
      assertStateScriptCoverage(suggestions, state, ["r1"]),
      suggestions,
    );
  }
  assert.throws(() =>
    assertStateScriptCoverage(
      {
        voterNameVariants: ["Example Voter", "উদাহরণ ভোটার"],
        relativeGroups: [
          {
            relativeId: "r1",
            variants: ["Example Relative", "ಉದಾಹರಣೆ ಸಂಬಂಧಿ"],
          },
        ],
      },
      "west_bengal",
      ["r1"],
    ),
  );
});

test("AI additions remain capped per identity and are server-labelled", async () => {
  const result = await suggestNameVariants(validRequest, {
    isConfigured: () => true,
    suggest: async () => ({
      voterNameVariants: [
        "Ramesh",
        "ರಮೇಶ್",
        "Ramesh K",
        "Ramesh Kumar",
        "Rames",
        "Ramesha",
      ],
      relativeGroups: [
        {
          relativeId: "r1",
          variants: ["Suresh", "ಸುರೇಶ್", "Suresh K", "Suresha"],
        },
        {
          relativeId: "r2",
          variants: ["Lakshmi", "ಲಕ್ಷ್ಮಿ", "Laxmi", "Lakshmee"],
        },
      ],
    }),
  });
  assert.ok(result.voterCandidates.length <= MAX_VARIANTS_PER_NAME);
  assert.ok(
    result.relativeGroups.every(
      (group) => group.candidates.length <= MAX_CANDIDATES_PER_RELATIVE,
    ),
  );
  const allCandidates = [
    ...result.voterCandidates,
    ...result.relativeGroups.flatMap((group) => group.candidates),
  ];
  assert.ok(allCandidates.every((candidate) => candidate.source));
  assert.equal(
    allCandidates.some((candidate) =>
      ["Ramesh K", "Ramesh Kumar", "Suresh K"].includes(candidate.value),
    ),
    false,
  );
  assert.equal(
    allCandidates.some((candidate) => candidate.source === "untrusted-model"),
    false,
  );
});

test("dictionary-free identity validation drops added or unrelated AI names", async () => {
  const result = await suggestNameVariants(
    {
      state: "west_bengal",
      voterName: "Naren Dal",
      relativeNames: ["Pavan Sen"],
      aiOptIn: true,
    },
    {
      isConfigured: () => true,
      suggest: async () => ({
        voterNameVariants: [
          "Naren Dal",
          "নরেন দাল",
          "Naren Dhal",
          "Narendralal",
          "উদাহরণ ভোটার",
        ],
        relativeGroups: [
          {
            relativeId: "r1",
            variants: ["Pavan Sen", "পাবন সেন", "Paban Sen", "Entirely Different"],
          },
        ],
      }),
    },
  );

  assert.equal(result.ai.status, "generated");
  assert.ok(result.voterNameVariants.includes("Naren Dhal"));
  assert.ok(result.voterNameVariants.includes("নরেন দাল"));
  assert.equal(result.voterNameVariants.includes("Narendralal"), false);
  assert.equal(result.voterNameVariants.includes("উদাহরণ ভোটার"), false);
  assert.equal(result.relativeNameVariants.includes("Entirely Different"), false);
});
