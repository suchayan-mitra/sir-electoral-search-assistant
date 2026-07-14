/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const STATE_CONFIG = {
  karnataka: {
    vowels: { a: "ಅ", aa: "ಆ", i: "ಇ", ee: "ಈ", u: "ಉ", oo: "ಊ", e: "ಎ", ai: "ಐ", o: "ಒ", au: "ಔ" },
    marks: { a: "", aa: "ಾ", i: "ಿ", ee: "ೀ", u: "ು", oo: "ೂ", e: "ೆ", ai: "ೈ", o: "ೊ", au: "ೌ" },
    consonants: { k: "ಕ", kh: "ಖ", g: "ಗ", gh: "ಘ", ng: "ಙ", ch: "ಚ", j: "ಜ", jh: "ಝ", ny: "ಞ", t: "ತ", th: "ಥ", d: "ದ", dh: "ಧ", n: "ನ", p: "ಪ", ph: "ಫ", b: "ಬ", bh: "ಭ", m: "ಮ", y: "ಯ", r: "ರ", l: "ಲ", v: "ವ", sh: "ಶ", s: "ಸ", h: "ಹ" },
    virama: "್",
  },
  west_bengal: {
    vowels: { a: "অ", aa: "আ", i: "ই", ee: "ঈ", u: "উ", oo: "ঊ", e: "এ", ai: "ঐ", o: "ও", au: "ঔ" },
    marks: { a: "", aa: "া", i: "ি", ee: "ী", u: "ু", oo: "ূ", e: "ে", ai: "ৈ", o: "ো", au: "ৌ" },
    consonants: { k: "ক", kh: "খ", g: "গ", gh: "ঘ", ng: "ঙ", ch: "চ", j: "জ", jh: "ঝ", ny: "ঞ", t: "ত", th: "থ", d: "দ", dh: "ধ", n: "ন", p: "প", ph: "ফ", b: "ব", bh: "ভ", m: "ম", y: "য", r: "র", l: "ল", v: "ব", sh: "শ", s: "স", h: "হ" },
    virama: "্",
  },
  odisha: {
    vowels: { a: "ଅ", aa: "ଆ", i: "ଇ", ee: "ଈ", u: "ଉ", oo: "ଊ", e: "ଏ", ai: "ଐ", o: "ଓ", au: "ଔ" },
    marks: { a: "", aa: "ା", i: "ି", ee: "ୀ", u: "ୁ", oo: "ୂ", e: "େ", ai: "ୈ", o: "ୋ", au: "ୌ" },
    consonants: { k: "କ", kh: "ଖ", g: "ଗ", gh: "ଘ", ng: "ଙ", ch: "ଚ", j: "ଜ", jh: "ଝ", ny: "ଞ", t: "ତ", th: "ଥ", d: "ଦ", dh: "ଧ", n: "ନ", p: "ପ", ph: "ଫ", b: "ବ", bh: "ଭ", m: "ମ", y: "ଯ", r: "ର", l: "ଲ", v: "ୱ", sh: "ଶ", s: "ସ", h: "ହ" },
    virama: "୍",
  },
};

const TOKENS = [
  "aa", "ee", "oo", "ai", "au", "kh", "gh", "ch", "jh", "th", "dh", "ph", "bh", "sh", "ng", "ny",
  "a", "i", "u", "e", "o", "k", "g", "j", "t", "d", "n", "p", "b", "m", "y", "r", "l", "v", "s", "h",
];

function isLatin(value) {
  return /[a-z]/i.test(value) && !/[\u0980-\u09ff\u0b00-\u0b7f\u0c80-\u0cff]/.test(value);
}

function clean(value) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function transliterateToStateScript(input, state) {
  const value = clean(input);
  const config = STATE_CONFIG[state];
  if (!value || !config || !isLatin(value)) return value;
  return value
    .toLowerCase()
    .split(" ")
    .map((word) => {
      let output = "";
      let cursor = 0;
      let previousWasConsonant = false;

      while (cursor < word.length) {
        const token = TOKENS.find((candidate) => word.startsWith(candidate, cursor));
        if (!token) {
          output += word[cursor];
          previousWasConsonant = false;
          cursor += 1;
          continue;
        }

        if (config.consonants[token]) {
          if (previousWasConsonant) output += config.virama;
          output += config.consonants[token];
          previousWasConsonant = true;
        } else {
          output += previousWasConsonant ? config.marks[token] : config.vowels[token];
          previousWasConsonant = false;
        }
        cursor += token.length;
      }
      return output;
    })
    .join(" ");
}

const SPELLING_RULES = [
  [/ee/gi, "i"],
  [/oo/gi, "u"],
  [/aa/gi, "a"],
  [/sh/gi, "s"],
  [/bh/gi, "b"],
  [/ph/gi, "f"],
  [/v/gi, "b"],
  [/ch/gi, "c"],
];

export function generateVariants(input, state, limit = 6) {
  const base = clean(input);
  if (!base) return [];
  const boundedLimit = Math.max(1, Math.min(6, limit));
  const values = [base];

  if (isLatin(base)) {
    values.push(transliterateToStateScript(base, state));
    for (const [pattern, replacement] of SPELLING_RULES) {
      if (pattern.test(base)) values.push(base.replace(pattern, replacement));
      pattern.lastIndex = 0;
    }
    const withoutFinalA = base.replace(/a$/i, "");
    if (withoutFinalA !== base) values.push(withoutFinalA);
  }

  return [...new Set(values.filter(Boolean))].slice(0, boundedLimit);
}

export const supportedStates = Object.freeze(Object.keys(STATE_CONFIG));
