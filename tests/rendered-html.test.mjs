import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateVariants, supportedStates, transliterateToStateScript } from "../lib/variants.mjs";
import { validateSearchInput } from "../lib/server/search-validation.mjs";
await import("../extension/protocol.js");
const extensionProtocol = globalThis.MatsetuProtocol;

async function source(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("build contains the Matsetu product shell and extension-only search route", async () => {
  const [layout, assistant, worker] = await Promise.all([
    source("../app/layout.tsx"),
    source("../app/search-assistant.tsx"),
    source("../worker/index.ts"),
  ]);
  assert.match(layout, /title = "Matsetu/);
  assert.match(assistant, /Find the spelling that finds the record/);
  assert.match(assistant, /Independent beta/);
  assert.match(assistant, /You—not automation—read and type every CAPTCHA/);
  assert.match(assistant, /Karnataka/);
  assert.match(assistant, /West Bengal/);
  assert.match(assistant, /Odisha/);
  assert.match(assistant, /Browser companion connected/);
  assert.match(assistant, /Install the browser companion before searching/);
  assert.match(assistant, /Why it is needed:/);
  assert.match(assistant, /chrome:\/\/extensions/);
  assert.match(assistant, /Check connection again/);
  assert.match(assistant, /It cannot solve CAPTCHAs, read unrelated websites/);
  assert.match(assistant, /Planned search queue/);
  assert.match(assistant, /18 maximum/);
  assert.match(assistant, /Send the entered names to AI for better spelling suggestions/);
  assert.match(assistant, /Age alternatives/);
  assert.match(assistant, /Other relative-name alternatives/);
  assert.match(assistant, /Requesting AI suggestions did not approve them/);
  assert.match(assistant, /Entered by you/);
  assert.match(assistant, /Local transliteration/);
  assert.match(assistant, /AI suggestion/);
  assert.doesNotMatch(assistant, /Cloudflare Workers AI \(Kimi K2\.6\)|Cloudflare Kimi suggestions|AI suggestion · Kimi/);
  assert.match(assistant, /setSelectedNames\(uniqueValues\(\[form\.name\.trim\(\)\], 1\)\)/);
  assert.match(assistant, /setSelectedRelatives\(relativeNames\)/);
  assert.match(assistant, /Relative identity · suggestions stay in this group/);
  assert.match(assistant, /Continue to search/);
  assert.match(assistant, /matsetu-browser-companion\.zip/);
  assert.match(assistant, /GPL-3\.0-or-later · No warranty/);
  assert.doesNotMatch(assistant, /<span>Created by Suchayan Mitra/);
  assert.match(assistant, /possible match.*found/);
  assert.match(assistant, /This is not confirmation of identity/);
  assert.match(assistant, /Assembly constituency/);
  assert.match(assistant, /Returned by/);
  assert.match(assistant, /resultsHeadingRef\.current\?\.focus/);
  assert.doesNotMatch(assistant, /<dt>Name variant<\/dt>/);
  assert.doesNotMatch(assistant, /fetch\("\/api\/search"/);
  assert.match(worker, /url\.pathname === "\/api\/search"/);
  assert.match(worker, /url\.pathname === "\/api\/variants"/);
  assert.match(worker, /AI_VARIANT_RATE_LIMITER\.limit/);
  assert.match(worker, /extensionRequired: true/);
  assert.doesNotMatch(assistant, /codex-preview|react-loading-skeleton|ChatGPT|mock search/i);
});

test("extension protocol accepts one selected bounded search", () => {
  assert.equal(
    extensionProtocol.validSearch({
      state: "west_bengal",
      name: "Example",
      relativeName: "Relative",
      age: 45,
      gender: "female",
    }),
    true,
  );
  assert.equal(
    extensionProtocol.validSearch({
      state: "west_bengal",
      name: "Example",
      relativeName: "Relative",
      age: 45,
      dob: "1981-01-01",
      gender: "female",
    }),
    false,
  );
  assert.equal(
    extensionProtocol.validSearch({
      state: "west_bengal",
      name: "Example",
      relativeName: "Relative",
      age: 45,
      gender: "female",
      captchaAnswer: "must-not-pass",
    }),
    false,
  );
});

test("validates one bounded official search input", () => {
  assert.equal(
    validateSearchInput({
      state: "karnataka",
      name: "Example",
      relativeName: "Relative",
      age: 40,
      gender: "male",
    }),
    true,
  );
  assert.equal(
    validateSearchInput({
      state: "karnataka",
      name: "Example",
      relativeName: "Relative",
      age: 40,
      dob: "1986-01-01",
      gender: "male",
    }),
    false,
  );
  assert.equal(
    validateSearchInput({
      state: "unsupported",
      name: "Example",
      relativeName: "Relative",
      age: 40,
      gender: "male",
    }),
    false,
  );
  assert.equal(
    validateSearchInput({
      state: "odisha",
      name: "Example",
      relativeName: "Relative",
      dob: "2026-99-99",
      gender: "female",
    }),
    false,
  );
});

test("generates bounded state-script variants", () => {
  assert.deepEqual(supportedStates, ["karnataka", "west_bengal", "odisha"]);
  assert.equal(transliterateToStateScript("Amit", "karnataka"), "ಅಮಿತ");
  assert.equal(transliterateToStateScript("Amit", "west_bengal"), "অমিত");
  assert.equal(transliterateToStateScript("Amit", "odisha"), "ଅମିତ");

  const variants = generateVariants("Ramesh", "karnataka", 99);
  assert.ok(variants.includes("Ramesh"));
  assert.ok(variants.some((value) => /[\u0c80-\u0cff]/.test(value)));
  assert.ok(variants.length <= 6);
  assert.equal(new Set(variants).size, variants.length);
});

test("preserves native-script input without inventing variants", () => {
  assert.deepEqual(generateVariants("অমিত", "west_bengal"), ["অমিত"]);
  assert.deepEqual(generateVariants("ସୁରେଶ", "odisha"), ["ସୁରେଶ"]);
  assert.deepEqual(generateVariants("   ", "odisha"), []);
});

test("uses conservative Bengali lexical corrections for known name words", () => {
  const suchayan = generateVariants("Suchayan Mitra", "west_bengal");
  const chandramouli = generateVariants("Chandramauli Mitra", "west_bengal");
  const sudiptaGhose = generateVariants("Sudipta Ghose", "west_bengal");
  assert.ok(suchayan.includes("সুচয়ন মিত্র"));
  assert.ok(chandramouli.includes("চন্দ্রমৌলি মিত্র"));
  assert.ok(sudiptaGhose.includes("সুদীপ্ত ঘোষ"));
  assert.equal(suchayan.some((value) => value.includes("সুচযন")), false);
  assert.equal(sudiptaGhose.some((value) => value.includes("ঘোসে")), false);
});
