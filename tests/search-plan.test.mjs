import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateCandidates,
  isAdultDob,
  planSearchQueue,
} from "../lib/search-plan.mjs";

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
    "Suchayan Mitra",
    "সুচয়ন মিত্র",
    "Sucayan Mitra",
    "সুচায়ন মিত্র",
    "Suchayan Mitro",
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
        name: "Suchayan Mitra",
        relativeName: "Example Relative",
        birth: { kind: "age", value: 42 },
      },
      {
        name: "Suchayan Mitra",
        relativeName: "Example Relative",
        birth: { kind: "age", value: 43 },
      },
      {
        name: "Suchayan Mitra",
        relativeName: "Example Relative",
        birth: { kind: "dob", value: "1980-01-01" },
      },
      {
        name: "সুচয়ন মিত্র",
        relativeName: "পরীক্ষা আত্মীয়",
        birth: { kind: "age", value: 42 },
      },
      {
        name: "সুচয়ন মিত্র",
        relativeName: "পরীক্ষা আত্মীয়",
        birth: { kind: "age", value: 43 },
      },
      {
        name: "সুচয়ন মিত্র",
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
        name === "সুচয়ন মিত্র" && relativeName === "পরীক্ষা আত্মীয়",
    ),
  );
  assert.deepEqual(plan, planSearchQueue(names, relatives, criteria, 18));
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
