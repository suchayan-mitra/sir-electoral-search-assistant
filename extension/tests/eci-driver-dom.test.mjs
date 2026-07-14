/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const extensionRoot = new URL("../", import.meta.url);
const [protocolSource, driverSource] = await Promise.all([
  readFile(new URL("protocol.js", extensionRoot), "utf8"),
  readFile(new URL("eci-driver.js", extensionRoot), "utf8"),
]);

const requestId = "b91a9f50-2f14-4f35-a0e4-84028546a422";
const captchaImage = `data:image/png;base64,${"A".repeat(600)}`;

function createHarness({ deferSettleTimer = false } = {}) {
  const formControls = [];
  const documentListeners = new Map();
  const documentEvents = [];
  const settleTimers = [];
  const pollTimers = [];
  const mutationObservers = [];
  let deferPollTimers = false;
  let messageListener;

  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
    }
  }

  class FakeCustomEvent extends FakeEvent {
    constructor(type, options = {}) {
      super(type, options);
      this.detail = options.detail;
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      mutationObservers.push(this);
    }

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }
  }

  class FakeInput {
    constructor({ name = "", type = "text", value = "" } = {}) {
      this._value = String(value);
      this.checked = false;
      this.disabled = false;
      this.events = [];
      this.locked = false;
      this.name = name;
      this.type = type;
      formControls.push(this);
    }

    get value() {
      return this._value;
    }

    set value(value) {
      if (!this.locked) this._value = String(value);
    }

    click() {
      if (this.type === "radio") {
        for (const control of formControls) {
          if (control !== this && control.type === "radio" && control.name === this.name) {
            control.checked = false;
          }
        }
        this.checked = true;
      }
    }

    dispatchEvent(event) {
      this.events.push(event.type);
      return true;
    }
  }

  class FakeSelect extends FakeInput {
    constructor({ options = [], value = "" } = {}) {
      super({ type: "select", value });
      this.options = options;
    }

    get value() {
      return this._value;
    }

    set value(value) {
      if (!this.locked) this._value = String(value);
    }
  }

  class FakeButton {
    constructor() {
      this.clicked = false;
    }

    click() {
      this.clicked = true;
      this.onClick?.();
    }
  }

  function createVisibleElement(textContent = "", { hidden = false, error = false } = {}) {
    return {
      error,
      hidden,
      textContent,
      getAttribute(name) {
        return name === "aria-hidden" && this.hidden ? "true" : null;
      },
      getClientRects() {
        return this.hidden ? [] : [{}];
      },
      matches(selector) {
        return this.error && selector === ".Toastify__toast--error";
      },
    };
  }

  function createTable(rowCount, { hidden = false } = {}) {
    const headers = ["Name", "Age", "District", "Assembly Constituency"].map(
      (textContent) => ({ textContent }),
    );
    const rows = Array.from({ length: rowCount }, (_, index) => {
      const cells = [
        { textContent: `Example Voter ${index + 1}` },
        { textContent: String(40 + (index % 5)) },
        { textContent: "Kolkata" },
        { textContent: "Example Assembly Constituency" },
      ];
      return {
        cells,
        querySelectorAll(selector) {
          return selector === "td" ? cells : [];
        },
      };
    });
    return {
      hidden,
      rows,
      getAttribute(name) {
        return name === "aria-hidden" && this.hidden ? "true" : null;
      },
      getClientRects() {
        return this.hidden ? [] : [{}];
      },
      querySelectorAll(selector) {
        if (selector === "thead th, thead td") return headers;
        if (selector === "tbody tr") return rows;
        return [];
      },
    };
  }

  const elements = {
    details: new FakeButton(),
    state: new FakeSelect(),
    name: new FakeInput(),
    relative: new FakeInput(),
    dobRadio: new FakeInput({ name: "date", type: "radio", value: "dob" }),
    ageRadio: new FakeInput({ name: "date", type: "radio", value: "age" }),
    date: new FakeInput({ name: "date", type: "date" }),
    age: new FakeSelect(),
    female: new FakeInput({ name: "gender", type: "radio", value: "F" }),
    male: new FakeInput({ name: "gender", type: "radio", value: "M" }),
    other: new FakeInput({ name: "gender", type: "radio", value: "T" }),
    district: new FakeSelect({
      options: [
        { textContent: "Select District", value: "" },
        { textContent: "CUTTACK", value: "357" },
        { textContent: "KOLKATA NORTH", value: "KOL-N" },
      ],
    }),
    captcha: {
      src: captchaImage,
      getAttribute(name) {
        return name === "src" ? this.src : null;
      },
    },
    captchaAnswer: new FakeInput({ name: "captcha" }),
    captchaRefresh: new FakeButton(),
    search: new FakeButton(),
    headings: [],
    alerts: [],
    table: null,
    spinnerReads: 0,
  };

  const selectorMap = new Map([
    ['#detail[aria-label="Search By Details"]', elements.details],
    ["#stateID", elements.state],
    ["#firstNameID", elements.name],
    ["#relFirstNameID", elements.relative],
    ['input[type="radio"][name="date"][value="dob"]', elements.dobRadio],
    ['input[type="radio"][name="date"][value="age"]', elements.ageRadio],
    ['input[type="date"][name="date"]', elements.date],
    ["select#ageID", elements.age],
    ['input[type="radio"][name="gender"][value="F"]', elements.female],
    ['input[type="radio"][name="gender"][value="M"]', elements.male],
    ['input[type="radio"][name="gender"][value="T"]', elements.other],
    ['select[aria-label="Select District"]', elements.district],
    ['.captcha-div img[src^="data:image/"]', elements.captcha],
    [
      '.captcha-div [role="button"][aria-label="Captcha Refresh"]',
      elements.captchaRefresh,
    ],
    ['input[name="captcha"][aria-label="Enter Captcha"]', elements.captchaAnswer],
    ['button[aria-label="Search"]', elements.search],
  ]);

  const sent = [];
  const context = {
    CustomEvent: FakeCustomEvent,
    Event: FakeEvent,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          sent.push(message);
          return Promise.resolve();
        },
      },
    },
    document: {
      documentElement: {},
      addEventListener(type, listener) {
        const listeners = documentListeners.get(type) ?? [];
        listeners.push(listener);
        documentListeners.set(type, listeners);
      },
      dispatchEvent(event) {
        documentEvents.push(event);
        for (const listener of documentListeners.get(event.type) ?? []) listener(event);
        return true;
      },
      querySelector(selector) {
        if (selector === ".globalSpinnerDiv") {
          if (elements.spinnerReads <= 0) return null;
          elements.spinnerReads -= 1;
          return {};
        }
        if (selector === "table#table-id") return elements.table;
        if (selector === ".Toastify__toast--error") {
          return elements.alerts.find((element) => element.error) ?? null;
        }
        return selectorMap.get(selector) ?? null;
      },
      querySelectorAll(selector) {
        if (selector === "h4") return elements.headings;
        if (
          selector ===
          '.Toastify__toast--error, .Toastify__toast, [role="alert"]'
        ) {
          return elements.alerts;
        }
        return [];
      },
    },
    crypto: {
      randomUUID() {
        return "34c1364c-eb60-4384-b8da-4fc5f7815939";
      },
    },
    location: { origin: "https://electoralsearch.eci.gov.in" },
    setTimeout(callback, delay) {
      if (deferSettleTimer && delay === 500) {
        settleTimers.push(callback);
        return settleTimers.length;
      }
      if (deferPollTimers && delay === 150) {
        pollTimers.push(callback);
        return pollTimers.length;
      }
      if (deferSettleTimer) {
        setImmediate(callback);
        return 0;
      }
      callback();
      return 0;
    },
  };
  context.globalThis = context;
  context.window = context;
  context.top = context;

  vm.createContext(context);
  vm.runInContext(protocolSource, context, { filename: "protocol.js" });
  vm.runInContext(driverSource, context, { filename: "eci-driver.js" });

  async function fill(search) {
    messageListener({
      source: "sir-assist-extension",
      type: "FILL",
      requestId,
      search,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const outcome = sent.find(
        (message) => message.type === "CAPTCHA_READY" || message.type === "ECI_ERROR",
      );
      if (outcome) return outcome;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("The ECI driver did not finish filling the fake form.");
  }

  async function refreshCaptcha() {
    const startedAt = sent.length;
    messageListener({
      source: "sir-assist-extension",
      type: "REFRESH_CAPTCHA",
      requestId,
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const outcome = sent
        .slice(startedAt)
        .find(
          (message) =>
            message.type === "CAPTCHA_READY" || message.type === "ECI_ERROR",
        );
      if (outcome) return outcome;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("The ECI driver did not finish refreshing the fake CAPTCHA.");
  }

  async function submitWithObservation(
    status,
    { render = "empty", rowCount = 0 } = {},
  ) {
    const startedAt = sent.length;
    elements.search.onClick = () => {
      elements.spinnerReads = 1;
      const control = [...documentEvents]
        .reverse()
        .find((event) => event.type === "sir-assist-api-observer-control");
      const controlDetail = JSON.parse(control.detail);
      if (render === "empty") {
        elements.headings.push(createVisibleElement("No Result Found"));
      } else if (render === "hidden-empty") {
        elements.headings.push(
          createVisibleElement("No Result Found", { hidden: true }),
        );
      } else if (render === "table") {
        elements.table = createTable(rowCount);
      } else if (render === "hidden-table") {
        elements.table = createTable(rowCount, { hidden: true });
      } else if (render === "error") {
        elements.alerts.push(
          createVisibleElement("Invalid CAPTCHA", { error: true }),
        );
      } else if (render === "neutral-error") {
        elements.alerts.push(
          createVisibleElement("Please review your entry", { error: true }),
        );
      } else if (render === "changed-error") {
        elements.alerts[0].textContent = "CAPTCHA expired";
      }
      context.document.dispatchEvent(
        new FakeCustomEvent("sir-assist-api-observation", {
          detail: JSON.stringify({
            token: controlDetail.token,
            observation: {
              transport: "xhr",
              method: "POST",
              endpoint: {
                origin: "https://gateway-voters.eci.gov.in",
                path: "/api/v1/elastic/search-by-details-from-state-display-v1",
                queryKeys: [],
              },
              status,
              request: {
                topLevelKeys: ["encryptedPayload", "encryptedKey", "iv"],
                nestedKeys: [],
              },
              response: {
                topLevelKeys: [],
                schemaKeys: [],
                arrayLengths: [],
              },
            },
          }),
        }),
      );
    };
    messageListener({
      source: "sir-assist-extension",
      type: "SUBMIT",
      requestId,
      captchaAnswer: "ABCD12",
    });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const outcome = sent
        .slice(startedAt)
        .find((message) => message.type === "RESULTS" || message.type === "ECI_ERROR");
      if (outcome) return { outcome, messages: sent.slice(startedAt) };
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("The ECI driver did not finish submitting the fake form.");
  }

  return {
    documentEvents,
    elements,
    fill,
    flushSettleTimers() {
      for (const callback of settleTimers.splice(0)) callback();
    },
    flushNextPollTimer() {
      const callback = pollTimers.shift();
      callback?.();
      return Boolean(callback);
    },
    makeTable: createTable,
    messageListener: (message) => messageListener(message),
    refreshCaptcha,
    mutate(target, overrides = {}) {
      const record = {
        addedNodes: [],
        removedNodes: [],
        target,
        type: "attributes",
        ...overrides,
      };
      for (const observer of mutationObservers) {
        if (observer.connected) observer.callback([record], observer);
      }
    },
    sent,
    setPollTimersDeferred(value) {
      deferPollTimers = value;
    },
    submitWithObservation,
    visibleElement: createVisibleElement,
  };
}

test("ECI driver verifies the age branch before relaying CAPTCHA", async () => {
  const { elements, fill } = createHarness();
  const outcome = await fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });

  assert.equal(outcome.type, "CAPTCHA_READY");
  assert.equal(outcome.captchaImage, captchaImage);
  assert.equal(elements.state.value, "S25");
  assert.equal(elements.name.value, "Example Voter");
  assert.equal(elements.relative.value, "Example Relative");
  assert.equal(elements.ageRadio.checked, true);
  assert.equal(elements.dobRadio.checked, false);
  assert.equal(elements.age.value, "42");
  assert.equal(elements.male.checked, true);
});

test("ECI driver fills a Hindi-belt state search with its audited code", async () => {
  const { elements, fill } = createHarness();
  const outcome = await fill({
    state: "bihar",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });

  assert.equal(outcome.type, "CAPTCHA_READY");
  assert.equal(elements.state.value, "S04");
});

test("ECI driver verifies the DOB and district branch before relaying CAPTCHA", async () => {
  const { elements, fill } = createHarness();
  const outcome = await fill({
    state: "odisha",
    name: "Example Voter",
    relativeName: "Example Relative",
    dob: "1980-01-01",
    gender: "female",
    district: "Cuttack",
  });

  assert.equal(outcome.type, "CAPTCHA_READY");
  assert.equal(elements.state.value, "S18");
  assert.equal(elements.dobRadio.checked, true);
  assert.equal(elements.ageRadio.checked, false);
  assert.equal(elements.date.value, "1980-01-01");
  assert.equal(elements.female.checked, true);
  assert.equal(elements.district.value, "357");
});

test("ECI driver blocks CAPTCHA relay when a filled value was not retained", async () => {
  const { elements, fill, sent } = createHarness();
  elements.state.locked = true;
  const outcome = await fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 43,
    gender: "male",
  });

  assert.equal(outcome.type, "ECI_ERROR");
  assert.match(outcome.error, /did not retain the selected state/);
  assert.equal(sent.some((message) => message.type === "CAPTCHA_READY"), false);
});

test("ECI driver accepts empty DOM results only after a relayed 2xx search trace", async () => {
  const { fill, submitWithObservation } = createHarness();
  await fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const { outcome, messages } = await submitWithObservation(200);

  assert.equal(outcome.type, "RESULTS");
  assert.equal(Array.isArray(outcome.candidates), true);
  assert.equal(outcome.candidates.length, 0);
  assert.deepEqual(
    messages.filter((message) => ["API_OBSERVATION", "RESULTS"].includes(message.type)).map(
      (message) => message.type,
    ),
    ["API_OBSERVATION", "RESULTS"],
  );
});

test("ECI driver does not accept a stale empty DOM before response settling", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const submission = harness.submitWithObservation(200);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.sent.some((message) => message.type === "RESULTS"), false);

  harness.flushSettleTimers();
  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
});

test("ECI driver rejects non-2xx search traces even when ECI renders no result", async () => {
  const { fill, submitWithObservation } = createHarness();
  await fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 43,
    gender: "male",
  });
  const { outcome, messages } = await submitWithObservation(422);

  assert.equal(outcome.type, "ECI_ERROR");
  assert.match(outcome.error, /HTTP 422/);
  assert.match(outcome.error, /CAPTCHA or another form value/);
  assert.equal(messages.some((message) => message.type === "RESULTS"), false);
  assert.deepEqual(
    messages.filter((message) => ["API_OBSERVATION", "ECI_ERROR"].includes(message.type)).map(
      (message) => message.type,
    ),
    ["API_OBSERVATION", "ECI_ERROR"],
  );
});

test("ECI driver distinguishes network, throttling and service failures", async () => {
  const cases = [
    { status: 0, expected: /no HTTP response \(status 0\)/ },
    { status: 429, expected: /rate-limited.*HTTP 429/ },
    { status: 503, expected: /HTTP 503.*service-side failure/ },
  ];
  for (const { status, expected } of cases) {
    const harness = createHarness();
    await harness.fill({
      state: "west_bengal",
      name: "Example Voter",
      relativeName: "Example Relative",
      age: 42,
      gender: "male",
    });
    const { outcome } = await harness.submitWithObservation(status);
    assert.equal(outcome.type, "ECI_ERROR");
    assert.match(outcome.error, expected);
  }
});

test("ECI driver does not accept a no-result marker that predates submission", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  const staleMarker = harness.visibleElement("No Result Found");
  harness.elements.headings.push(staleMarker);
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const submission = harness.submitWithObservation(200, { render: "none" });
  await new Promise((resolve) => setImmediate(resolve));
  const unrelatedSibling = {};
  const commonAncestor = {
    contains(node) {
      return node === staleMarker || node === unrelatedSibling;
    },
  };
  harness.mutate(commonAncestor, {
    addedNodes: [unrelatedSibling],
    type: "childList",
  });
  harness.flushSettleTimers();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.sent.some((message) => message.type === "RESULTS"), false);

  harness.elements.headings.splice(
    0,
    1,
    harness.visibleElement("No Result Found"),
  );
  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
  assert.equal(outcome.candidates.length, 0);
});

test("ECI driver accepts a pre-existing no-result node only after post-submit reuse", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  const marker = harness.visibleElement("No Result Found");
  harness.elements.headings.push(marker);
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const submission = harness.submitWithObservation(200, { render: "none" });
  await new Promise((resolve) => setImmediate(resolve));
  marker.hidden = true;
  harness.mutate(marker);
  marker.hidden = false;
  harness.mutate(marker);
  harness.flushSettleTimers();

  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
  assert.equal(outcome.candidates.length, 0);
});

test("ECI driver accepts a pre-existing table only after post-submit reuse", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  const table = harness.makeTable(1);
  harness.elements.table = table;
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const submission = harness.submitWithObservation(200, { render: "none" });
  await new Promise((resolve) => setImmediate(resolve));
  table.hidden = true;
  harness.mutate(table);
  table.hidden = false;
  harness.mutate(table);
  harness.flushSettleTimers();

  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
  assert.equal(outcome.candidates.length, 1);
});

test("ECI driver ignores a hidden no-result template until it becomes visible", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const submission = harness.submitWithObservation(200, {
    render: "hidden-empty",
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.flushSettleTimers();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.sent.some((message) => message.type === "RESULTS"), false);

  harness.elements.headings[0].hidden = false;
  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
  assert.equal(outcome.candidates.length, 0);
});

test("ECI driver ignores a hidden result table until it becomes visible", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const submission = harness.submitWithObservation(200, {
    render: "hidden-table",
    rowCount: 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.flushSettleTimers();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.sent.some((message) => message.type === "RESULTS"), false);

  harness.elements.table.hidden = false;
  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
  assert.equal(outcome.candidates.length, 1);
});

test("ECI driver ignores stale and hidden validation markers", async () => {
  for (const hidden of [false, true]) {
    const harness = createHarness();
    harness.elements.alerts.push(
      harness.visibleElement("Invalid CAPTCHA", { error: true, hidden }),
    );
    await harness.fill({
      state: "west_bengal",
      name: "Example Voter",
      relativeName: "Example Relative",
      age: 42,
      gender: "male",
    });
    const { outcome } = await harness.submitWithObservation(200);
    assert.equal(outcome.type, "RESULTS");
    assert.equal(outcome.candidates.length, 0);
  }
});

test("ECI driver rejects a validation marker changed after submission", async () => {
  const harness = createHarness();
  harness.elements.alerts.push(
    harness.visibleElement("Invalid CAPTCHA", { error: true }),
  );
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const { outcome } = await harness.submitWithObservation(200, {
    render: "changed-error",
  });
  assert.equal(outcome.type, "ECI_ERROR");
  assert.match(outcome.error, /displayed a validation error after HTTP 200/);
});

test("ECI driver treats a 2xx validation marker as a failed attempt", async () => {
  const harness = createHarness();
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const { outcome } = await harness.submitWithObservation(200, { render: "error" });
  assert.equal(outcome.type, "ECI_ERROR");
  assert.match(outcome.error, /displayed a validation error after HTTP 200/);
});

test("ECI driver rejects a fresh error-class toast without relying on its text", async () => {
  const harness = createHarness();
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const { outcome } = await harness.submitWithObservation(200, {
    render: "neutral-error",
  });
  assert.equal(outcome.type, "ECI_ERROR");
  assert.match(outcome.error, /displayed a validation error after HTTP 200/);
});

test("ECI driver requires four stable polls and resets after a table mutation", async () => {
  const harness = createHarness({ deferSettleTimer: true });
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  harness.setPollTimersDeferred(true);
  const submission = harness.submitWithObservation(200, {
    render: "table",
    rowCount: 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.flushSettleTimers();

  const flushPoll = async () => {
    assert.equal(harness.flushNextPollTimer(), true);
    await new Promise((resolve) => setImmediate(resolve));
  };
  await flushPoll();
  await flushPoll();
  assert.equal(harness.sent.some((message) => message.type === "RESULTS"), false);

  const nameCell = harness.elements.table.rows[0].cells[0];
  nameCell.textContent = "Updated Voter";
  harness.mutate(nameCell, { type: "characterData" });
  await flushPoll();
  await flushPoll();
  await flushPoll();
  assert.equal(harness.sent.some((message) => message.type === "RESULTS"), false);

  await flushPoll();
  const { outcome } = await submission;
  assert.equal(outcome.type, "RESULTS");
  assert.equal(outcome.candidates[0].displayName, "Updated Voter");
});

test("ECI driver relays a fresh official CAPTCHA after clicking the refresh control", async () => {
  const harness = createHarness();
  await harness.fill({
    state: "west_bengal",
    name: "Example Voter",
    relativeName: "Example Relative",
    age: 42,
    gender: "male",
  });
  const refreshedImage = `data:image/png;base64,${"B".repeat(600)}`;
  harness.elements.captchaRefresh.onClick = () => {
    harness.elements.captcha.src = refreshedImage;
  };

  const outcome = await harness.refreshCaptcha();
  assert.equal(outcome.type, "CAPTCHA_READY");
  assert.equal(outcome.captchaImage, refreshedImage);
  assert.equal(harness.elements.captchaRefresh.clicked, true);

  // The refreshed case must still allow exactly one submission.
  const { outcome: submitted } = await harness.submitWithObservation(200);
  assert.equal(submitted.type, "RESULTS");
  assert.equal(submitted.candidates.length, 0);
});

test("ECI driver ignores a CAPTCHA refresh outside the pending-CAPTCHA phase", async () => {
  const harness = createHarness();
  harness.messageListener({
    source: "sir-assist-extension",
    type: "REFRESH_CAPTCHA",
    requestId,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(
    harness.sent.some(
      (message) =>
        message.type === "CAPTCHA_READY" || message.type === "ECI_ERROR",
    ),
    false,
  );
  assert.equal(harness.elements.captchaRefresh.clicked, false);
});

test("ECI driver reports when the ten-candidate privacy limit is reached", async () => {
  for (const { rowCount, expectedLimit, expectedCandidates } of [
    { rowCount: 9, expectedLimit: false, expectedCandidates: 9 },
    { rowCount: 10, expectedLimit: true, expectedCandidates: 10 },
    { rowCount: 11, expectedLimit: true, expectedCandidates: 10 },
  ]) {
    const harness = createHarness();
    await harness.fill({
      state: "west_bengal",
      name: "Example Voter",
      relativeName: "Example Relative",
      age: 42,
      gender: "male",
    });
    const { outcome } = await harness.submitWithObservation(200, {
      render: "table",
      rowCount,
    });
    assert.equal(outcome.type, "RESULTS");
    assert.equal(outcome.candidates.length, expectedCandidates);
    assert.equal(outcome.resultLimitReached, expectedLimit);
  }
});
