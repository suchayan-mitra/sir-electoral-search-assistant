import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateVariants, supportedStates, transliterateToStateScript } from "../lib/variants.mjs";
import { validateSearchInput } from "../lib/server/search-validation.mjs";
await import("../extension/protocol.js");
const extensionProtocol = globalThis.SirAssistProtocol;

async function source(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("build contains the SIR Assist product shell and extension-only search route", async () => {
  const [layout, assistant, worker] = await Promise.all([
    source("../app/layout.tsx"),
    source("../app/search-assistant.tsx"),
    source("../worker/index.ts"),
  ]);
  assert.match(layout, /title = "SIR Assist/);
  assert.match(assistant, /Find the spelling that finds the record/);
  assert.match(assistant, /Independent beta/);
  assert.match(assistant, /You—not automation—read and type every CAPTCHA/);
  assert.match(assistant, /Karnataka/);
  assert.match(assistant, /West Bengal/);
  assert.match(assistant, /Odisha/);
  assert.match(assistant, /Bihar/);
  assert.match(assistant, /Uttar Pradesh/);
  assert.match(assistant, /Delhi \(NCT\)/);
  assert.match(assistant, /हिन्दी · Hindi/);
  assert.match(assistant, /Browser companion connected/);
  assert.match(assistant, /Install the browser companion before searching/);
  assert.match(assistant, /Why it is needed:/);
  assert.match(assistant, /chrome:\/\/extensions/);
  assert.match(assistant, /Reload page to detect extension/);
  assert.match(assistant, /Reload page to detect v\{minimumExtensionVersion\}/);
  assert.match(assistant, /window\.location\.reload\(\)/);
  assert.doesNotMatch(assistant, /Check connection again/);
  assert.match(assistant, /It cannot solve CAPTCHAs, read unrelated websites/);
  assert.match(assistant, /Planned search queue/);
  assert.match(assistant, /18 hard maximum/);
  assert.match(assistant, /18-search cap applied/);
  assert.match(assistant, /Generate AI spelling variants/);
  assert.match(assistant, /Use offline transliteration/);
  assert.match(assistant, /This sends only the selected state and entered names to SIR Assist AI/);
  assert.match(assistant, /const requestAi = submitter\?\.value !== "offline"/);
  assert.match(assistant, /signal: controller\.signal/);
  assert.doesNotMatch(assistant, /aiVariantOptIn|setAiVariantOptIn/);
  assert.match(assistant, /Age alternatives/);
  assert.match(assistant, /one short inclusive range such as 40-46/);
  assert.match(assistant, /Every age becomes a separate exact-age search; this is not an age bracket/);
  assert.match(assistant, /queue never exceeds 18 searches/);
  assert.match(assistant, /Every selected relative identity gets the first birth-detail search/);
  assert.match(assistant, /primary relative&apos;s remaining age\/DOB criteria run first/i);
  assert.match(assistant, /relativeIdentityValues: selectedRelativeIdentityValues/);
  assert.match(assistant, /short age range expands into separate exact-age searches, which run after an entered DOB/);
  assert.match(assistant, /An entered DOB is searched first, before any age alternatives/);
  assert.match(assistant, /Who does what/);
  assert.match(assistant, /What cannot be bypassed/);
  assert.match(assistant, /it never searches ECI itself/);
  assert.match(assistant, /Stop here and verify officially/);
  assert.match(assistant, /Verify on official ECI search/);
  assert.match(assistant, /Other relative-name alternatives/);
  assert.match(assistant, /Generated spellings are suggestions only/);
  assert.match(assistant, /only spellings you check are added to the search queue/);
  assert.match(assistant, /Entered by you/);
  assert.match(assistant, /Local transliteration/);
  assert.match(assistant, /AI suggestion/);
  assert.doesNotMatch(assistant, /Cloudflare Workers AI \(Kimi K2\.6\)|Cloudflare Kimi suggestions|AI suggestion · Kimi/);
  assert.match(assistant, /setSelectedNames\(uniqueValues\(\[form\.name\.trim\(\)\], 1\)\)/);
  assert.match(assistant, /setSelectedRelatives\(relativeNames\)/);
  assert.match(assistant, /Relative identity · suggestions stay in this group/);
  assert.match(assistant, /Try \$\{formatBirthCriterion\(nextAttempt\.birth\)\} next/);
  assert.match(assistant, /Continue anyway: \$\{formatBirthCriterion\(nextAttempt\.birth\)\}/);
  assert.match(assistant, /nextAttempt\.name\} · relative \{nextAttempt\.relativeName/);
  assert.match(assistant, /sir-assist-browser-companion\.zip/);
  assert.match(assistant, /minimumExtensionVersion = "1\.5\.0"/);
  assert.match(assistant, /Show a new CAPTCHA/);
  assert.match(assistant, /type: "REFRESH_CAPTCHA", requestId: caseId/);
  assert.match(assistant, /RATE_LIMIT_COOLDOWN_MS = 60_000/);
  assert.match(assistant, /rate-limited the last attempt \(HTTP 429\)/);
  assert.match(assistant, /disabled=\{busy \|\| cooldownRemaining > 0\}/);
  assert.match(assistant, /Browser companion update required/);
  assert.match(assistant, /!extensionReady/);
  assert.match(assistant, /available for up to three minutes/);
  assert.match(assistant, /GPL-3\.0-or-later · No warranty/);
  assert.doesNotMatch(assistant, /<span>Created by Suchayan Mitra/);
  assert.match(assistant, /className="match-badge">Possible match/);
  assert.match(assistant, /No official result was recorded/);
  assert.match(assistant, /failed or expired attempt—not a zero-match response/);
  assert.match(assistant, /Official API call observed/);
  assert.match(assistant, /transport diagnostic, not a search result/);
  assert.match(
    assistant,
    /whether the record was found is stated in the summary above/,
  );
  assert.match(assistant, /apiStatus: apiObservationRef\.current\?\.status/);
  assert.match(assistant, /after an observed HTTP 2xx response/);
  assert.match(assistant, /human-entered CAPTCHA submission/);
  assert.match(assistant, /encrypted wire envelope/);
  assert.match(assistant, /No voter input, CAPTCHA or response body enters this diagnostic/);
  assert.match(assistant, /metadata is not logged, sent to SIR Assist servers or stored/);
  assert.match(assistant, /ECI did not return a successful 2xx status/);
  assert.match(assistant, /not a completed zero-result search/);
  assert.match(assistant, /10-summary privacy limit/);
  assert.match(assistant, /Open official ECI search/);
  assert.match(assistant, /Download official electoral roll/);
  assert.match(assistant, /West Bengal SIR 2026 rolls and lists/);
  assert.match(assistant, /\{showOfficialFallback && \(/);
  assert.match(assistant, /shouldOfferOfficialFallback/);
  assert.match(assistant, /message\.resultLimitReached/);
  assert.match(assistant, /message\.type === "API_OBSERVATION"/);
  assert.match(assistant, /message\.requestId !== submittedCaseRef\.current/);
  assert.match(assistant, /step === "results"/);
  assert.match(assistant, /latestFailure\.message/);
  assert.match(assistant, /No possible matches returned so far/);
  assert.doesNotMatch(assistant, /No possible matches found yet/);
  assert.match(assistant, /lastAttemptRecord\?\.status === "completed"/);
  assert.match(assistant, /This is not confirmation of identity/);
  assert.match(assistant, /displayed age band is privacy-minimized result information, not the bracket searched/);
  assert.match(assistant, /Assembly constituency/);
  assert.match(assistant, /Returned by/);
  assert.match(assistant, /resultsHeadingRef\.current\?\.focus/);
  assert.doesNotMatch(assistant, /<dt>Name variant<\/dt>/);
  assert.doesNotMatch(assistant, /fetch\("\/api\/search"/);
  assert.match(worker, /url\.pathname === "\/api\/search"/);
  assert.match(worker, /url\.pathname === "\/api\/variants"/);
  assert.match(worker, /url\.pathname === "\/LICENSE\.txt"/);
  assert.match(worker, /import gplLicenseText from "\.\.\/LICENSE\?raw"/);
  assert.match(worker, /AI_VARIANT_RATE_LIMITER\.limit/);
  assert.match(worker, /extensionRequired: true/);
  assert.doesNotMatch(assistant, /codex-preview|react-loading-skeleton|ChatGPT|mock search/i);

  // The possible-match summary is the headline of the results step; the
  // network observation renders after it as a quiet transport diagnostic.
  const matchSummaryPosition = assistant.indexOf("possible-match-summary ${");
  const apiPanelPosition = assistant.indexOf("official-api-verification ${");
  assert.ok(matchSummaryPosition >= 0);
  assert.ok(apiPanelPosition > matchSummaryPosition);

  // A trusted DOB must consume the first CAPTCHA-backed attempt; guessed ages
  // only run after it.
  const ageCriterionPosition = assistant.indexOf(
    'criteria.push({ kind: "age", value: age })',
  );
  const dobCriterionPosition = assistant.indexOf(
    'criteria.push({ kind: "dob", value: form.dob })',
  );
  assert.ok(dobCriterionPosition >= 0);
  assert.ok(ageCriterionPosition > dobCriterionPosition);
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
      state: "bihar",
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
      state: "uttar_pradesh",
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
  assert.deepEqual(supportedStates, [
    "karnataka",
    "west_bengal",
    "odisha",
    "bihar",
    "chhattisgarh",
    "delhi",
    "jharkhand",
    "madhya_pradesh",
    "rajasthan",
    "uttar_pradesh",
    "uttarakhand",
  ]);
  assert.equal(transliterateToStateScript("Amit", "karnataka"), "ಅಮಿತ");
  assert.equal(transliterateToStateScript("Amit", "west_bengal"), "অমিত");
  assert.equal(transliterateToStateScript("Amit", "odisha"), "ଅମିତ");
  // Every Hindi-belt state shares the same generic Devanagari table.
  assert.equal(transliterateToStateScript("Amit", "bihar"), "अमित");
  assert.equal(transliterateToStateScript("Amit", "uttar_pradesh"), "अमित");
  const hindiForms = generateVariants("Sudipta", "rajasthan", 6);
  assert.ok(hindiForms.includes("सुदिप्त"));
  assert.ok(hindiForms.includes("सुदिप्ता"));

  const variants = generateVariants("Ramesh", "karnataka", 99);
  assert.ok(variants.includes("Ramesh"));
  assert.ok(variants.some((value) => /[\u0c80-\u0cff]/.test(value)));
  assert.ok(variants.length <= 6);
  assert.equal(new Set(variants).size, variants.length);

  // A romanized final consonant + "a" is ambiguous between the inherent vowel
  // and the aa-matra, so both native endings must be offered.
  const odiaForms = generateVariants("Sudipta", "odisha", 6);
  assert.ok(odiaForms.includes("\u0b38\u0b41\u0b26\u0b3f\u0b2a\u0b4d\u0b24"));
  assert.ok(odiaForms.includes("\u0b38\u0b41\u0b26\u0b3f\u0b2a\u0b4d\u0b24\u0b3e"));
  const bengaliForms = generateVariants("Sudipta Mitra", "west_bengal", 6);
  assert.ok(bengaliForms.includes("\u09b8\u09c1\u09a6\u09bf\u09aa\u09cd\u09a4\u09be \u09ae\u09bf\u09a4\u09cd\u09b0"));
  assert.ok(bengaliForms.includes("\u09b8\u09c1\u09a6\u09bf\u09aa\u09cd\u09a4\u09be \u09ae\u09bf\u09a4\u09cd\u09b0\u09be"));
});

test("preserves native-script input without inventing variants", () => {
  assert.deepEqual(generateVariants("অমিত", "west_bengal"), ["অমিত"]);
  assert.deepEqual(generateVariants("ସୁରେଶ", "odisha"), ["ସୁରେଶ"]);
  assert.deepEqual(generateVariants("   ", "odisha"), []);
});

test("generic fallback contains no person-specific name dictionary", async () => {
  const variantsSource = await source("../lib/variants.mjs");
  assert.doesNotMatch(
    variantsSource,
    /wordOverrides|phraseOverrides|nameOverrides|curatedStateScriptVariants/,
  );
  assert.doesNotMatch(
    variantsSource,
    /\b[a-z]{3,}\s*:\s*\[[^\]]*[\u0980-\u09ff\u0b00-\u0b7f\u0c80-\u0cff]/i,
  );
});
