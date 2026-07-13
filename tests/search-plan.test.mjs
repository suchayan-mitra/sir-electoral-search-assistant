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

test("expands each spelling pair across exact DOB and age alternatives", () => {
  const plan = planSearchQueue(
    ["Suchayan Mitra", "Suchayan Mitro"],
    ["Chandramauli Mitra", "Sudipta Mitra"],
    [
      { kind: "dob", value: "1983-07-28" },
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
        name: "Suchayan Mitra",
        relativeName: "Chandramauli Mitra",
        birth: { kind: "dob", value: "1983-07-28" },
      },
      {
        name: "Suchayan Mitra",
        relativeName: "Chandramauli Mitra",
        birth: { kind: "age", value: 42 },
      },
      {
        name: "Suchayan Mitra",
        relativeName: "Chandramauli Mitra",
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
  assert.ok(plan.some(({ relativeName }) => relativeName === "Sudipta Mitra"));
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
  assert.equal(isAdultDob("1983-07-28", now), true);
  assert.equal(isAdultDob("2020-01-01", now), false);
  assert.equal(isAdultDob("2008-07-13", now), false);
  assert.equal(isAdultDob("1983-02-30", now), false);
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
