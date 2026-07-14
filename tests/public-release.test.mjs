import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("public release declares its author, copyright and GPL license", async () => {
  const [packageSource, license, publicLicense, readme, authors, notice, appSource] = await Promise.all([
    read("package.json"),
    read("LICENSE"),
    read("public/LICENSE.txt"),
    read("README.md"),
    read("AUTHORS.md"),
    read("NOTICE"),
    read("app/search-assistant.tsx"),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.author.name, "Suchayan Mitra");
  assert.equal(packageJson.contributors[0].name, "AI Copilot");
  assert.equal(packageJson.license, "GPL-3.0-or-later");
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 29 June 2007/);
  assert.equal(publicLicense, license);
  assert.match(readme, /GPL-3\.0-or-later/);
  assert.match(readme, /created and authored by \*\*Suchayan Mitra\*\*/i);
  assert.match(authors, /Suchayan Mitra/);
  assert.match(authors, /AI Copilot/);
  assert.match(notice, /Copyright \(C\) 2026 Suchayan Mitra/);
  assert.match(appSource, /Copyright \(C\) 2026 Suchayan Mitra/);
  assert.match(appSource, /Author: Suchayan Mitra/);
  assert.match(appSource, /Development assistance: AI Copilot/);
  assert.match(appSource, /SPDX-License-Identifier: GPL-3\.0-or-later/);
});

test("public release documents privacy, security and contribution boundaries", async () => {
  const [privacy, security, contributing] = await Promise.all([
    read("PRIVACY.md"),
    read("SECURITY.md"),
    read("CONTRIBUTING.md"),
  ]);
  assert.match(privacy, /CAPTCHA answers.*never stored/);
  assert.match(privacy, /EPIC number, address, polling station/);
  assert.match(security, /One CAPTCHA permits at most one official submission/);
  assert.match(security, /must not embed person-specific name mappings/);
  assert.match(contributing, /Do not add CAPTCHA solving, OCR, evasion/);
  assert.match(contributing, /Do not add person-specific name dictionaries/);
});
