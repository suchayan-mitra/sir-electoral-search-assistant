/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  "use strict";

  const protocol = globalThis.MatsetuProtocol;
  if (window.top !== window || location.origin !== protocol.ECI_ORIGIN) return;

  const stateCodes = {
    karnataka: "S10",
    west_bengal: "S25",
    odisha: "S18",
  };
  const genderCodes = { female: "F", male: "M", other: "T" };
  const districtAliases = {
    BENGALURUURBAN: "BANGALOREURBAN",
    BELAGAVI: "BELGAUM",
    MYSURU: "MYSORE",
    SHIVAMOGGA: "SHIMOGA",
  };
  let activeRequestId = "";
  let phase = "idle";

  function waitFor(getValue, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const value = getValue();
        if (value) return resolve(value);
        if (Date.now() - started >= timeoutMs) {
          return reject(new Error("The official ECI page did not reach the expected state."));
        }
        window.setTimeout(check, 150);
      };
      check();
    });
  }

  function setNativeValue(element, value) {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function normalizeDistrict(value) {
    const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return districtAliases[normalized] ?? normalized;
  }

  async function chooseDistrict(value) {
    const select = await waitFor(() => {
      const element = document.querySelector('select[aria-label="Select District"]');
      return element?.options?.length > 1 ? element : null;
    }, 12_000);
    const expected = normalizeDistrict(value);
    const option = [...select.options].find(
      (candidate) => normalizeDistrict(candidate.textContent) === expected,
    );
    if (!option) {
      throw new Error(
        "That district was not found on the official ECI form. Leave it blank or use the official spelling.",
      );
    }
    setNativeValue(select, option.value);
  }

  async function fillOfficialForm(search) {
    const details = await waitFor(() =>
      document.querySelector('#detail[aria-label="Search By Details"]'),
    );
    details.click();

    const state = await waitFor(() => document.querySelector("#stateID"));
    setNativeValue(state, stateCodes[search.state]);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const name = await waitFor(() => document.querySelector("#firstNameID"));
    const relative = await waitFor(() => document.querySelector("#relFirstNameID"));
    setNativeValue(name, search.name);
    setNativeValue(relative, search.relativeName);

    if (search.dob) {
      const dobRadio = await waitFor(() =>
        document.querySelector('input[type="radio"][name="date"][value="dob"]'),
      );
      dobRadio.click();
      const dateInput = await waitFor(() =>
        document.querySelector('input[type="date"][name="date"]'),
      );
      setNativeValue(dateInput, search.dob);
    } else {
      const ageRadio = await waitFor(() =>
        document.querySelector('input[type="radio"][name="date"][value="age"]'),
      );
      ageRadio.click();
      const ageSelect = await waitFor(() => {
        const element = document.querySelector("select#ageID");
        return element && !element.disabled ? element : null;
      });
      setNativeValue(ageSelect, search.age);
    }

    const gender = await waitFor(() =>
      document.querySelector(
        `input[type="radio"][name="gender"][value="${genderCodes[search.gender]}"]`,
      ),
    );
    gender.click();
    if (search.district) await chooseDistrict(search.district);

    const captchaImage = await waitFor(() => {
      const image = document.querySelector('.captcha-div img[src^="data:image/"]');
      const source = image?.getAttribute("src") ?? "";
      return protocol.isCaptchaDataImage(source) ? source : null;
    });
    return captchaImage;
  }

  function parseCandidates(table) {
    const headers = [...table.querySelectorAll("thead th, thead td")].map(
      (header) =>
        (header.textContent ?? "").trim().toUpperCase().replace(/\s+/g, " "),
    );
    const nameIndex = headers.findIndex(
      (header) => header === "NAME" || (header.endsWith("NAME") && !header.includes("RELATIVE")),
    );
    const ageIndex = headers.findIndex((header) => header === "AGE");
    const districtIndex = headers.findIndex((header) => header.includes("DISTRICT"));
    const constituencyIndex = headers.findIndex((header) =>
      header.includes("ASSEMBLY CONSTITUENCY"),
    );
    if ([nameIndex, ageIndex, districtIndex, constituencyIndex].some((index) => index < 0)) {
      throw new Error("The official ECI results format changed and could not be minimized.");
    }
    return [...table.querySelectorAll("tbody tr")].slice(0, 10).map((row, index) => {
      const cells = [...row.querySelectorAll("td")];
      return {
        id: `candidate-${String(index + 1).padStart(2, "0")}`,
        displayName: protocol.cleanText(cells[nameIndex]?.textContent, `Candidate ${index + 1}`),
        match: "possible",
        ageBand: protocol.ageBand(cells[ageIndex]?.textContent),
        district: protocol.cleanText(cells[districtIndex]?.textContent),
        constituency: protocol.cleanText(cells[constituencyIndex]?.textContent),
        matchedOn: ["selected name", "relative name", "birth detail"],
      };
    });
  }

  async function waitForResults() {
    const outcome = await waitFor(() => {
      if (document.querySelector(".Toastify__toast--error")) return { type: "error" };
      const table = document.querySelector("table#table-id");
      if (table) return { type: "table", table };
      const noResult = [...document.querySelectorAll("h4")].some(
        (element) => (element.textContent ?? "").trim() === "No Result Found",
      );
      return noResult ? { type: "empty" } : null;
    }, 30_000);
    if (outcome.type === "error") {
      throw new Error(
        "The official site did not accept that CAPTCHA. Start a new case.",
      );
    }
    return outcome.type === "empty" ? [] : parseCandidates(outcome.table);
  }

  async function reportError(requestId, error) {
    phase = "closed";
    await chrome.runtime.sendMessage({
      source: "eci-driver",
      type: "ECI_ERROR",
      requestId,
      error:
        error instanceof Error
          ? error.message.slice(0, 240)
          : "The official ECI page could not complete this case.",
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source !== "matsetu-extension") return;
    if (message.type === "FILL") {
      if (
        phase !== "idle" ||
        !protocol.isRequestId(message.requestId) ||
        !protocol.validSearch(message.search)
      ) {
        return;
      }
      activeRequestId = message.requestId;
      phase = "filling";
      void fillOfficialForm(message.search)
        .then(async (captchaImage) => {
          phase = "captcha";
          await chrome.runtime.sendMessage({
            source: "eci-driver",
            type: "CAPTCHA_READY",
            requestId: activeRequestId,
            captchaImage,
          });
        })
        .catch((error) => reportError(activeRequestId, error));
      return;
    }

    if (message.type === "SUBMIT") {
      if (
        phase !== "captcha" ||
        message.requestId !== activeRequestId ||
        typeof message.captchaAnswer !== "string" ||
        !/^[A-Za-z0-9]{4,12}$/.test(message.captchaAnswer)
      ) {
        return;
      }
      phase = "submitting";
      void (async () => {
        const input = await waitFor(() =>
          document.querySelector('input[name="captcha"][aria-label="Enter Captcha"]'),
        );
        const search = await waitFor(() =>
          document.querySelector('button[aria-label="Search"]'),
        );
        setNativeValue(input, message.captchaAnswer);
        search.click();
        const candidates = await waitForResults();
        phase = "closed";
        await chrome.runtime.sendMessage({
          source: "eci-driver",
          type: "RESULTS",
          requestId: activeRequestId,
          candidates,
        });
      })().catch((error) => reportError(activeRequestId, error));
    }
  });

  void chrome.runtime.sendMessage({ source: "eci-driver", type: "ECI_READY" });
})();
