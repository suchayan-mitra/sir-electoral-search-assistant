import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateCandidates,
  isAdultDob,
  MAX_AGE_ALTERNATIVES,
  parseAgeAlternatives,
  planSearchQueue,
  shouldOfferOfficialFallback,
} from "../lib/search-plan.mjs";

test("expands a bounded inclusive age sweep into exact ages", () => {
  assert.equal(MAX_AGE_ALTERNATIVES, 7);
  assert.deepEqual(parseAgeAlternatives("40-46"), [40, 41, 42, 43, 44, 45, 46]);
  assert.deepEqual(parseAgeAlternatives("40–46"), [40, 41, 42, 43, 44, 45, 46]);
  assert.deepEqual(parseAgeAlternatives("42, 43; 44/45"), [42, 43, 44, 45]);
  assert.deepEqual(parseAgeAlternatives("42, 42, 43"), [42, 43]);
  assert.deepEqual(parseAgeAlternatives(""), []);
  for (const invalid of ["46-40", "39-46", "40-47", "17-20", "119-121", "40 to 46"]) {
    assert.equal(parseAgeAlternatives(invalid), null);
  }
});

test("plans base, one-side, then combined variants with a hard cap", () => {
  const plan = planSearchQueue(
    ["Name", "নাম", "Neme"],
    ["Relative", "রিলেটিভ", "Relativ"],
  );
  assert.deepEqual(
    plan.map(({ name, relativeName }) => [name, relativeName]),
    [
      ["Name", "Relative"],
      ["নাম", "Relative"],
      ["Name", "রিলেটিভ"],
      ["Neme", "Relative"],
      ["Name", "Relativ"],
      ["নাম", "রিলেটিভ"],
    ],
  );
  assert.equal(plan.length, 6);
});

test("preserves the numeric-limit legacy queue", () => {
  const plan = planSearchQueue(
    ["Name", "নাম", "Neme"],
    ["Relative", "রিলেটিভ", "Relativ"],
    4,
  );

  assert.deepEqual(
    plan.map(({ name, relativeName }) => [name, relativeName]),
    [
      ["Name", "Relative"],
      ["নাম", "Relative"],
      ["Name", "রিলেটিভ"],
      ["Neme", "Relative"],
    ],
  );
  assert.ok(plan.every((attempt) => !("birth" in attempt)));
});

test("expands each prioritized spelling pair across DOB and age alternatives", () => {
  const plan = planSearchQueue(
    ["Example Name", "Example Neme"],
    ["Example Relative", "Alternate Relative"],
    [
      { kind: "dob", value: "1980-01-01" },
      { kind: "age", value: 42 },
      { kind: "age", value: 43 },
      { kind: "age", value: 42 },
    ],
    18,
  );

  assert.deepEqual(
    plan.slice(0, 3).map(({ name, relativeName, birth }) => ({
      name,
      relativeName,
      birth,
    })),
    [
      {
        name: "Example Name",
        relativeName: "Example Relative",
        birth: { kind: "dob", value: "1980-01-01" },
      },
      {
        name: "Example Name",
        relativeName: "Example Relative",
        birth: { kind: "age", value: 42 },
      },
      {
        name: "Example Name",
        relativeName: "Example Relative",
        birth: { kind: "age", value: 43 },
      },
    ],
  );
  assert.equal(plan.length, 12);
  assert.equal(
    new Set(
      plan.map(
        ({ name, relativeName, birth }) =>
          `${name}\u0000${relativeName}\u0000${birth.kind}:${birth.value}`,
      ),
    ).size,
    plan.length,
  );
  assert.deepEqual(
    [...new Set(plan.map(({ birth }) => `${birth.kind}:${birth.value}`))].sort(),
    ["age:42", "age:43", "dob:1980-01-01"],
  );
  assert.deepEqual(
    Object.fromEntries(
      ["dob:1980-01-01", "age:42", "age:43"].map((criterion) => [
        criterion,
        plan.filter(({ birth }) => `${birth.kind}:${birth.value}` === criterion)
          .length,
      ]),
    ),
    { "dob:1980-01-01": 4, "age:42": 4, "age:43": 4 },
  );
});

test("prioritizes a Bengali combined pair in a capped West Bengal queue", () => {
  const names = [
    "Example Elector",
    "নমুনা ভোটার",
    "Example Electer",
    "উদাহরণ ভোটার",
    "Example Voter",
  ];
  const relatives = [
    "Example Relative",
    "Alternate Relative",
    "Another Relative",
    "পরীক্ষা আত্মীয়",
    "Example Relativ",
    "নমুনা আত্মীয়",
  ];
  const criteria = [
    { kind: "age", value: 42 },
    { kind: "age", value: 43 },
    { kind: "dob", value: "1980-01-01" },
  ];
  const plan = planSearchQueue(names, relatives, criteria, 18);

  assert.equal(plan.length, 18);
  assert.deepEqual(
    plan.slice(0, 6).map(({ name, relativeName, birth }) => ({
      name,
      relativeName,
      birth,
    })),
    [
      {
        name: "Example Elector",
        relativeName: "Example Relative",
        birth: { kind: "age", value: 42 },
      },
      {
        name: "Example Elector",
        relativeName: "Example Relative",
        birth: { kind: "age", value: 43 },
      },
      {
        name: "Example Elector",
        relativeName: "Example Relative",
        birth: { kind: "dob", value: "1980-01-01" },
      },
      {
        name: "নমুনা ভোটার",
        relativeName: "পরীক্ষা আত্মীয়",
        birth: { kind: "age", value: 42 },
      },
      {
        name: "নমুনা ভোটার",
        relativeName: "পরীক্ষা আত্মীয়",
        birth: { kind: "age", value: 43 },
      },
      {
        name: "নমুনা ভোটার",
        relativeName: "পরীক্ষা আত্মীয়",
        birth: { kind: "dob", value: "1980-01-01" },
      },
    ],
  );
  assert.deepEqual(
    [...new Set(plan.map(({ birth }) => `${birth.kind}:${birth.value}`))].sort(),
    ["age:42", "age:43", "dob:1980-01-01"],
  );
  assert.deepEqual(
    Object.fromEntries(
      ["dob:1980-01-01", "age:42", "age:43"].map((criterion) => [
        criterion,
        plan.filter(({ birth }) => `${birth.kind}:${birth.value}` === criterion)
          .length,
      ]),
    ),
    { "dob:1980-01-01": 6, "age:42": 6, "age:43": 6 },
  );
  assert.ok(
    plan.some(
      ({ name, relativeName }) =>
        name === "নমুনা ভোটার" && relativeName === "পরীক্ষা আত্মীয়",
    ),
  );
  assert.deepEqual(plan, planSearchQueue(names, relatives, criteria, 18));
});

test("keeps a seven-age sweep, DOB and local-script pair inside the eighteen-search cap", () => {
  const criteria = [
    ...parseAgeAlternatives("40-46").map((age) => ({
      kind: "age",
      value: age,
    })),
    { kind: "dob", value: "1980-01-01" },
  ];
  const plan = planSearchQueue(
    ["Example Elector", "নমুনা ভোটার", "Example Electer"],
    ["Primary Relative", "প্রথম আত্মীয়", "প্রথম আত্মিয়"],
    criteria,
    18,
  );

  assert.equal(plan.length, 18);
  assert.deepEqual(
    plan.slice(0, 8).map(({ birth }) => `${birth.kind}:${birth.value}`),
    [
      "age:40",
      "age:41",
      "age:42",
      "age:43",
      "age:44",
      "age:45",
      "age:46",
      "dob:1980-01-01",
    ],
  );
  assert.deepEqual(
    plan.slice(8, 16).map(({ name, relativeName, birth }) => ({
      name,
      relativeName,
      criterion: `${birth.kind}:${birth.value}`,
    })),
    [
      "age:40",
      "age:41",
      "age:42",
      "age:43",
      "age:44",
      "age:45",
      "age:46",
      "dob:1980-01-01",
    ].map((criterion) => ({
      name: "নমুনা ভোটার",
      relativeName: "প্রথম আত্মীয়",
      criterion,
    })),
  );
});

test("covers each entered relative identity before variant sweeps consume the cap", () => {
  const criteria = [
    ...parseAgeAlternatives("40-46").map((age) => ({
      kind: "age",
      value: age,
    })),
    { kind: "dob", value: "1980-01-01" },
  ];
  const primaryRelative = "Primary Relative";
  const secondRelative = "Second Relative";
  const plan = planSearchQueue(
    ["Example Elector", "নমুনা ভোটার"],
    [
      primaryRelative,
      secondRelative,
      "প্রথম আত্মীয়",
      "দ্বিতীয় আত্মীয়",
    ],
    criteria,
    18,
    {
      relativeIdentityValues: [
        primaryRelative,
        secondRelative,
      ],
    },
  );

  assert.equal(plan.length, 18);
  assert.deepEqual(
    plan.slice(0, 2).map(({ name, relativeName, birth }) => ({
      name,
      relativeName,
      criterion: `${birth.kind}:${birth.value}`,
    })),
    [primaryRelative, secondRelative].map((relativeName) => ({
      name: "Example Elector",
      relativeName,
      criterion: "age:40",
    })),
  );
  const remainingCriteria = [
    "age:40",
    "age:41",
    "age:42",
    "age:43",
    "age:44",
    "age:45",
    "age:46",
    "dob:1980-01-01",
  ].slice(1);
  assert.deepEqual(
    plan.slice(2, 9).map(({ relativeName, birth }) => ({
      relativeName,
      criterion: `${birth.kind}:${birth.value}`,
    })),
    remainingCriteria.map((criterion) => ({
      relativeName: primaryRelative,
      criterion,
    })),
  );
  assert.deepEqual(
    plan.slice(9, 16).map(({ relativeName, birth }) => ({
      relativeName,
      criterion: `${birth.kind}:${birth.value}`,
    })),
    remainingCriteria.map((criterion) => ({
      relativeName: secondRelative,
      criterion,
    })),
  );
  assert.deepEqual(
    plan.slice(16).map(({ name, relativeName, birth }) => ({
      name,
      relativeName,
      criterion: `${birth.kind}:${birth.value}`,
    })),
    [
      {
        name: "নমুনা ভোটার",
        relativeName: "প্রথম আত্মীয়",
        criterion: "age:40",
      },
      {
        name: "নমুনা ভোটার",
        relativeName: "প্রথম আত্মীয়",
        criterion: "age:41",
      },
    ],
  );
});

test("offers official fallbacks only after an exhausted completed no-match queue", () => {
  assert.equal(
    shouldOfferOfficialFallback({
      candidateCount: 0,
      attemptedCount: 3,
      completedAttemptCount: 3,
      plannedAttemptCount: 3,
    }),
    true,
  );
  for (const state of [
    {
      candidateCount: 1,
      attemptedCount: 3,
      completedAttemptCount: 3,
      plannedAttemptCount: 3,
    },
    {
      candidateCount: 0,
      attemptedCount: 2,
      completedAttemptCount: 2,
      plannedAttemptCount: 3,
    },
    {
      candidateCount: 0,
      attemptedCount: 3,
      completedAttemptCount: 2,
      plannedAttemptCount: 3,
    },
    {
      candidateCount: 0,
      attemptedCount: 0,
      completedAttemptCount: 0,
      plannedAttemptCount: 0,
    },
  ]) {
    assert.equal(shouldOfferOfficialFallback(state), false);
  }
});

test("rejects invalid birth criteria and caps expanded queues at eighteen", () => {
  const plan = planSearchQueue(
    ["Name", "Neme", "নাম"],
    ["Relative", "Parent", "Relativ"],
    [
      { kind: "dob", value: "not-a-date" },
      { kind: "age", value: 17 },
      { kind: "age", value: 42 },
      { kind: "age", value: 43 },
    ],
    99,
  );
  assert.equal(plan.length, 18);
  assert.ok(plan.every(({ birth }) => birth.kind === "age"));
});

test("accepts only real adult DOB values", () => {
  const now = new Date("2026-07-12T12:00:00Z");
  assert.equal(isAdultDob("1980-01-01", now), true);
  assert.equal(isAdultDob("2020-01-01", now), false);
  assert.equal(isAdultDob("2008-07-13", now), false);
  assert.equal(isAdultDob("1980-02-30", now), false);
  assert.equal(isAdultDob("not-a-date", now), false);
});

test("deduplicates minimized candidates across attempts", () => {
  const result = deduplicateCandidates([
    [
      {
        displayName: "Example Voter",
        ageBand: "38–42",
        district: "Mysore",
        constituency: "Example AC",
        matchedOn: ["search 1"],
      },
    ],
    [
      {
        displayName: " example  voter ",
        ageBand: "38–42",
        district: "Mysore",
        constituency: "Example AC",
        matchedOn: ["search 2"],
      },
    ],
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].matchedOn, ["search 1", "search 2"]);
  assert.equal(result[0].id, "candidate-01");
});
