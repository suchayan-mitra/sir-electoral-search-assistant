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
      getAttribute(name) {
        return name === "src" ? captchaImage : null;
      },
    },
    captchaAnswer: new FakeInput({ name: "captcha" }),
    search: new FakeButton(),
    headings: [],
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
    ['input[name="captcha"][aria-label="Enter Captcha"]', elements.captchaAnswer],
    ['button[aria-label="Search"]', elements.search],
  ]);

  const sent = [];
  const context = {
    CustomEvent: FakeCustomEvent,
    Event: FakeEvent,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
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
        return selectorMap.get(selector) ?? null;
      },
      querySelectorAll(selector) {
        return selector === "h4" ? elements.headings : [];
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

  async function submitWithObservation(status) {
    const startedAt = sent.length;
    elements.search.onClick = () => {
      elements.spinnerReads = 1;
      const control = [...documentEvents]
        .reverse()
        .find((event) => event.type === "sir-assist-api-observer-control");
      const controlDetail = JSON.parse(control.detail);
      elements.headings.push({ textContent: "No Result Found" });
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
    sent,
    submitWithObservation,
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
  assert.match(outcome.error, /rejected the submission/);
  assert.equal(messages.some((message) => message.type === "RESULTS"), false);
  assert.deepEqual(
    messages.filter((message) => ["API_OBSERVATION", "ECI_ERROR"].includes(message.type)).map(
      (message) => message.type,
    ),
    ["API_OBSERVATION", "ECI_ERROR"],
  );
});
