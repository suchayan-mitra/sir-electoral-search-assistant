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

function createHarness() {
  const formControls = [];
  let messageListener;

  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = Boolean(options.bubbles);
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
  ]);

  const sent = [];
  const context = {
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
      querySelector(selector) {
        return selectorMap.get(selector) ?? null;
      },
      querySelectorAll() {
        return [];
      },
    },
    location: { origin: "https://electoralsearch.eci.gov.in" },
    setTimeout(callback) {
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

  return { elements, fill, sent };
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
