/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  "use strict";

  const protocol = globalThis.SirAssistProtocol;
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
  let captchaRefreshInFlight = false;
  let observerToken = "";
  let searchApiStatus = null;
  let searchResponseSettled = false;
  let observationRelay = Promise.resolve();
  const RESULT_STABILITY_POLLS = 4;

  function setObserverEnabled(enabled) {
    if (!observerToken) return;
    document.dispatchEvent(
      new CustomEvent(protocol.API_OBSERVER_CONTROL_EVENT, {
        detail: JSON.stringify({ enabled, token: observerToken }),
      }),
    );
    if (!enabled) observerToken = "";
  }

  async function settleObservationRelay() {
    try {
      await observationRelay;
    } catch {
      throw new Error("The official API response could not be relayed safely.");
    }
  }

  document.addEventListener(protocol.API_OBSERVATION_EVENT, (event) => {
    if (
      phase !== "submitting" ||
      !activeRequestId ||
      !observerToken ||
      typeof event.detail !== "string" ||
      event.detail.length > 8_192
    ) {
      return;
    }
    let envelope;
    try {
      envelope = JSON.parse(event.detail);
    } catch {
      return;
    }
    if (
      !protocol.isPlainObject(envelope) ||
      Object.keys(envelope).length !== 2 ||
      envelope.token !== observerToken ||
      !protocol.isApiObservation(envelope.observation)
    ) {
      return;
    }
    searchApiStatus = envelope.observation.status;
    if (searchApiStatus >= 200 && searchApiStatus < 300) {
      window.setTimeout(() => {
        if (phase === "submitting") searchResponseSettled = true;
      }, 500);
    }
    observationRelay = observationRelay.then(() =>
      chrome.runtime.sendMessage({
        source: "eci-driver",
        type: "API_OBSERVATION",
        requestId: activeRequestId,
        observation: envelope.observation,
      }),
    );
    setObserverEnabled(false);
  });

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

  function textDigest(value) {
    const text = String(value ?? "").slice(0, 4_000);
    let hash = 2_166_136_261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return `${text.length}:${hash >>> 0}`;
  }

  function isVisibleElement(element) {
    if (
      !element ||
      element.hidden ||
      element.getAttribute?.("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = window.getComputedStyle?.(element);
    if (
      style &&
      (style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0")
    ) {
      return false;
    }
    if (
      typeof element.getClientRects === "function" &&
      element.getClientRects().length === 0
    ) {
      return false;
    }
    return true;
  }

  function visibleErrorMarkers() {
    return [
      ...document.querySelectorAll(
        '.Toastify__toast--error, .Toastify__toast, [role="alert"]',
      ),
    ].filter(
      (element) => {
        if (!isVisibleElement(element)) return false;
        const explicitError =
          element.matches?.(".Toastify__toast--error") ||
          element.classList?.contains("Toastify__toast--error");
        return (
          explicitError ||
          /invalid|incorrect|expired|error|failed|rejected|mismatch|try again|too many|unavailable/i.test(
            element.textContent ?? "",
          )
        );
      },
    );
  }

  function freshErrorMarkerPresent(initialErrors, mutationTracker) {
    return visibleErrorMarkers().some(
      (element) =>
        !initialErrors.has(element) ||
        initialErrors.get(element) !== textDigest(element.textContent) ||
        mutationTracker.wasMutated(element),
    );
  }

  function visibleNoResultMarkers() {
    return [...document.querySelectorAll("h4")].filter(
      (element) =>
        isVisibleElement(element) &&
        (element.textContent ?? "").trim() === "No Result Found",
    );
  }

  function tableFingerprint(table) {
    if (!table) return "";
    const headers = [...table.querySelectorAll("thead th, thead td")];
    const rows = [...table.querySelectorAll("tbody tr")];
    const structure = rows.map((row) =>
      [...row.querySelectorAll("td")]
        .map((cell) => textDigest((cell.textContent ?? "").trim()))
        .join(","),
    );
    return `${headers.length}|${rows.length}|${structure.join(";")}`;
  }

  function snapshotResultState() {
    const table = document.querySelector("table#table-id");
    const visibleTable = isVisibleElement(table) ? table : null;
    return {
      noResultNodes: new Set(visibleNoResultMarkers()),
      errors: new Map(
        visibleErrorMarkers().map((element) => [
          element,
          textDigest(element.textContent),
        ]),
      ),
      table: visibleTable,
      tableFingerprint: tableFingerprint(visibleTable),
    };
  }

  function createResultMutationTracker(initialResultState) {
    const trackedNodes = [
      ...initialResultState.noResultNodes,
      ...initialResultState.errors.keys(),
      initialResultState.table,
    ].filter(Boolean);
    const mutatedNodes = new WeakSet();
    const recordTouchesNode = (record, node) => {
      if (
        record.target === node ||
        Boolean(node?.contains?.(record.target))
      ) {
        return true;
      }
      if (record.type !== "childList") return false;
      return [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])].some(
        (changedNode) =>
          changedNode === node ||
          Boolean(changedNode?.contains?.(node)) ||
          Boolean(node?.contains?.(changedNode)),
      );
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of trackedNodes) {
          if (recordTouchesNode(record, node)) mutatedNodes.add(node);
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-hidden", "class", "hidden", "style"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return {
      disconnect() {
        observer.disconnect();
      },
      wasMutated(node) {
        return mutatedNodes.has(node);
      },
    };
  }

  function apiFailureMessage(status) {
    if (status === 0) {
      return "The official ECI request received no HTTP response (status 0). Check the network and try again; no result was recorded.";
    }
    if (status === 429) {
      return "The official ECI service rate-limited this search (HTTP 429). Wait before trying again; no result was recorded.";
    }
    if (status >= 500) {
      return `The official ECI service returned HTTP ${status}. This appears to be a service-side failure; no result was recorded.`;
    }
    if (status >= 400) {
      return `The official ECI service rejected this search with HTTP ${status}. The CAPTCHA or another form value may have been rejected; no result was recorded.`;
    }
    return `The official ECI search returned HTTP ${status} instead of a successful 2xx response. No result was recorded.`;
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

  function formMismatch(field) {
    throw new Error(`The official ECI form did not retain the ${field}. Try this search again.`);
  }

  function verifyValue(element, expected, field) {
    if (!element || String(element.value) !== String(expected)) formMismatch(field);
  }

  function verifyRadio(selected, alternate, field) {
    if (!selected?.checked || alternate?.checked) formMismatch(field);
  }

  function verifyOfficialForm(search) {
    verifyValue(document.querySelector("#stateID"), stateCodes[search.state], "selected state");
    verifyValue(document.querySelector("#firstNameID"), search.name, "voter name");
    verifyValue(
      document.querySelector("#relFirstNameID"),
      search.relativeName,
      "relative name",
    );

    const dobRadio = document.querySelector(
      'input[type="radio"][name="date"][value="dob"]',
    );
    const ageRadio = document.querySelector(
      'input[type="radio"][name="date"][value="age"]',
    );
    if (search.dob) {
      verifyRadio(dobRadio, ageRadio, "DOB search mode");
      verifyValue(
        document.querySelector('input[type="date"][name="date"]'),
        search.dob,
        "selected DOB",
      );
    } else {
      verifyRadio(ageRadio, dobRadio, "age search mode");
      verifyValue(document.querySelector("select#ageID"), search.age, "selected age");
    }

    const expectedGenderCode = genderCodes[search.gender];
    const genderRadios = Object.values(genderCodes).map((code) =>
      document.querySelector(`input[type="radio"][name="gender"][value="${code}"]`),
    );
    if (
      !genderRadios.some(
        (radio) => radio?.value === expectedGenderCode && radio.checked,
      ) ||
      genderRadios.some(
        (radio) => radio?.value !== expectedGenderCode && radio?.checked,
      )
    ) {
      formMismatch("selected gender");
    }

    if (search.district) {
      const district = document.querySelector('select[aria-label="Select District"]');
      const expected = normalizeDistrict(search.district);
      const option = [...(district?.options ?? [])].find(
        (candidate) => normalizeDistrict(candidate.textContent) === expected,
      );
      if (!option || String(district.value) !== String(option.value)) {
        formMismatch("selected district");
      }
    }
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

    await new Promise((resolve) => window.setTimeout(resolve, 150));
    verifyOfficialForm(search);

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
    const rows = [...table.querySelectorAll("tbody tr")];
    const candidates = rows.slice(0, 10).map((row, index) => {
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
    return {
      candidates,
      resultLimitReached: rows.length >= 10,
    };
  }

  async function waitForResults(initialResultState, mutationTracker) {
    let outcome;
    let stableOutcomeKey = "";
    let stableOutcomeNode = null;
    let stableOutcomePolls = 0;
    try {
      outcome = await waitFor(() => {
        const spinner = document.querySelector(".globalSpinnerDiv");
        if (searchApiStatus === null) return null;
        if (searchApiStatus < 200 || searchApiStatus >= 300) {
          return { type: "api-error", status: searchApiStatus };
        }
        if (
          spinner ||
          !searchResponseSettled
        ) {
          stableOutcomeKey = "";
          stableOutcomeNode = null;
          stableOutcomePolls = 0;
          return null;
        }
        if (
          freshErrorMarkerPresent(
            initialResultState.errors,
            mutationTracker,
          )
        ) {
          return { type: "error" };
        }
        const table = document.querySelector("table#table-id");
        const visibleTable = isVisibleElement(table) ? table : null;
        const rows = visibleTable
          ? [...visibleTable.querySelectorAll("tbody tr")]
          : [];
        const currentTableFingerprint = tableFingerprint(visibleTable);
        const currentNoResultMarkers = visibleNoResultMarkers();
        const freshNoResultMarker = currentNoResultMarkers.find(
          (element) =>
            !initialResultState.noResultNodes.has(element) ||
            mutationTracker.wasMutated(element),
        );
        let candidate = null;
        let candidateKey = "";
        let candidateNode = null;
        if (
          visibleTable &&
          rows.length > 0 &&
          (visibleTable !== initialResultState.table ||
            currentTableFingerprint !== initialResultState.tableFingerprint ||
            mutationTracker.wasMutated(visibleTable))
        ) {
          candidate = { type: "table", table: visibleTable };
          candidateKey = `table:${currentTableFingerprint}`;
          candidateNode = visibleTable;
        } else if (freshNoResultMarker) {
          candidate = { type: "empty" };
          candidateKey = `empty:${currentNoResultMarkers.length}`;
          candidateNode = freshNoResultMarker;
        }
        if (!candidate) {
          stableOutcomeKey = "";
          stableOutcomeNode = null;
          stableOutcomePolls = 0;
          return null;
        }
        if (
          candidateKey !== stableOutcomeKey ||
          candidateNode !== stableOutcomeNode
        ) {
          stableOutcomeKey = candidateKey;
          stableOutcomeNode = candidateNode;
          stableOutcomePolls = 1;
          return null;
        }
        stableOutcomePolls += 1;
        return stableOutcomePolls >= RESULT_STABILITY_POLLS ? candidate : null;
      }, 30_000);
    } catch (error) {
      if (searchApiStatus === null) {
        throw new Error(
          "The official ECI search API call was not observed, so this attempt was not completed.",
        );
      }
      if (searchApiStatus >= 200 && searchApiStatus < 300) {
        throw new Error(
          `The official ECI API returned HTTP ${searchApiStatus}, but the page did not expose a fresh, stable result or explicit no-result marker. No result was recorded.`,
        );
      }
      throw error;
    }
    if (outcome.type === "api-error") {
      throw new Error(apiFailureMessage(outcome.status));
    }
    if (outcome.type === "error") {
      throw new Error(
        `The official ECI page displayed a validation error after HTTP ${searchApiStatus}. The CAPTCHA or another form value may have been rejected; no result was recorded.`,
      );
    }
    return outcome.type === "empty"
      ? { candidates: [], resultLimitReached: false }
      : parseCandidates(outcome.table);
  }

  async function reportError(requestId, error) {
    setObserverEnabled(false);
    try {
      await settleObservationRelay();
    } catch {
      // The terminal error below is still delivered without any unsafe fallback data.
    }
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
    if (message?.source !== "sir-assist-extension") return;
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

    if (message.type === "REFRESH_CAPTCHA") {
      if (
        phase !== "captcha" ||
        message.requestId !== activeRequestId ||
        captchaRefreshInFlight
      ) {
        return;
      }
      captchaRefreshInFlight = true;
      void (async () => {
        const previousImage =
          document
            .querySelector('.captcha-div img[src^="data:image/"]')
            ?.getAttribute("src") ?? "";
        const refreshControl = await waitFor(() =>
          document.querySelector(
            '.captcha-div [role="button"][aria-label="Captcha Refresh"]',
          ),
        );
        refreshControl.click();
        const captchaImage = await waitFor(() => {
          const source =
            document
              .querySelector('.captcha-div img[src^="data:image/"]')
              ?.getAttribute("src") ?? "";
          return source !== previousImage && protocol.isCaptchaDataImage(source)
            ? source
            : null;
        }, 15_000);
        await chrome.runtime.sendMessage({
          source: "eci-driver",
          type: "CAPTCHA_READY",
          requestId: activeRequestId,
          captchaImage,
        });
      })()
        .catch((error) => reportError(activeRequestId, error))
        .finally(() => {
          captchaRefreshInFlight = false;
        });
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
      searchApiStatus = null;
      searchResponseSettled = false;
      observationRelay = Promise.resolve();
      void (async () => {
        const input = await waitFor(() =>
          document.querySelector('input[name="captcha"][aria-label="Enter Captcha"]'),
        );
        const search = await waitFor(() =>
          document.querySelector('button[aria-label="Search"]'),
        );
        setNativeValue(input, message.captchaAnswer);
        observerToken = crypto.randomUUID();
        setObserverEnabled(true);
        const initialResultState = snapshotResultState();
        const mutationTracker = createResultMutationTracker(initialResultState);
        let result;
        try {
          search.click();
          result = await waitForResults(initialResultState, mutationTracker);
        } finally {
          mutationTracker.disconnect();
        }
        await settleObservationRelay();
        setObserverEnabled(false);
        phase = "closed";
        await chrome.runtime.sendMessage({
          source: "eci-driver",
          type: "RESULTS",
          requestId: activeRequestId,
          candidates: result.candidates,
          resultLimitReached: result.resultLimitReached,
        });
      })().catch((error) => reportError(activeRequestId, error));
    }
  });

  void chrome.runtime.sendMessage({ source: "eci-driver", type: "ECI_READY" });
})();
