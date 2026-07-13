import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("manifest is limited to Matsetu and the official ECI origin", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, [
    "https://electoralsearch.eci.gov.in/*",
  ]);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://matsetu-electoral-search-assistant.jukulda.workers.dev/*",
  ]);
  for (const forbidden of ["<all_urls>", "cookies", "debugger", "webRequest"]) {
    assert.equal(JSON.stringify(manifest).includes(forbidden), false);
  }
});

test("companion uses session-only state and never stores CAPTCHA answers", async () => {
  const background = await read("background.js");
  assert.match(background, /chrome\.storage\.session/);
  assert.doesNotMatch(background, /storage\.(local|sync)/);
  assert.match(background, /delete session\.search/);
  assert.doesNotMatch(background, /session\.captchaAnswer/);
});

test("protocol rejects unknown search fields before transient storage", async () => {
  const protocol = await read("protocol.js");
  assert.match(protocol, /SEARCH_KEYS/);
  assert.match(protocol, /Object\.keys\(value\).*SEARCH_KEYS/);
});

test("ECI driver fills the official form and minimizes approved fields", async () => {
  const driver = await read("eci-driver.js");
  assert.match(driver, /#detail\[aria-label="Search By Details"\]/);
  assert.match(driver, /#firstNameID/);
  assert.match(driver, /#relFirstNameID/);
  assert.match(driver, /\.captcha-div img/);
  assert.match(driver, /table#table-id/);
  assert.match(driver, /slice\(0, 10\)/);
  assert.doesNotMatch(driver, /epicNumber|polling|serialNumber|address/i);
});

test("no extension source contains CAPTCHA-solving or evasion integrations", async () => {
  const source = (
    await Promise.all(
      ["background.js", "eci-driver.js", "matsetu-bridge.js"].map(read),
    )
  ).join("\n");
  assert.doesNotMatch(source, /openai|anthropic|ocr|captcha.?solver|proxy|webRequest/i);
  assert.doesNotMatch(source, /console\.(log|debug|info)/);
});

test("downloadable companion is an allowlisted GPL source archive", async () => {
  const archive = new Uint8Array(
    await readFile(new URL("../../public/matsetu-browser-companion.zip", import.meta.url)),
  );
  const files = unzipSync(archive);
  assert.deepEqual(Object.keys(files).sort(), [
    "LICENSE",
    "README.md",
    "background.js",
    "eci-driver.js",
    "manifest.json",
    "matsetu-bridge.js",
    "protocol.js",
  ]);
  assert.match(strFromU8(files.LICENSE), /GNU GENERAL PUBLIC LICENSE/);
  assert.match(strFromU8(files["README.md"]), /authored by \*\*Suchayan Mitra\*\*/);
  assert.match(strFromU8(files["README.md"]), /development assistance from \*\*AI Copilot\*\*/);
  assert.match(strFromU8(files["background.js"]), /Copyright \(C\) 2026 Suchayan Mitra/);
  assert.match(strFromU8(files["background.js"]), /Development assistance: AI Copilot/);
  assert.equal(JSON.parse(strFromU8(files["manifest.json"])).version, "1.0.2");
});
