/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = resolve(projectRoot, "extension");
const outputPath = resolve(projectRoot, "public", "sir-assist-browser-companion.zip");
const publicLicensePath = resolve(projectRoot, "public", "LICENSE.txt");
const extensionFiles = [
  "manifest.json",
  "background.js",
  "eci-network-observer.js",
  "eci-driver.js",
  "sir-assist-bridge.js",
  "protocol.js",
  "README.md",
];

const archive = {};
for (const name of extensionFiles) {
  archive[name] = strToU8(await readFile(resolve(extensionRoot, name), "utf8"));
}
const license = new Uint8Array(await readFile(resolve(projectRoot, "LICENSE")));
archive.LICENSE = license;

await Promise.all([
  writeFile(
    outputPath,
    zipSync(archive, { level: 9, mtime: new Date("1980-01-02T00:00:00.000Z") }),
  ),
  writeFile(publicLicensePath, license),
]);

console.log(`Packaged ${extensionFiles.length + 1} allowlisted files in ${outputPath}`);
