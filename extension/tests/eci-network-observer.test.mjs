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
const [observerSource, protocolSource] = await Promise.all([
  readFile(new URL("eci-network-observer.js", extensionRoot), "utf8"),
  readFile(new URL("protocol.js", extensionRoot), "utf8"),
]);

const pageOrigin = "https://electoralsearch.eci.gov.in";
const searchUrl =
  "https://gateway-voters.eci.gov.in/api/v1/elastic/search-by-details-from-state-display-v1";
const controlEvent = "sir-assist-api-observer-control";
const observationEvent = "sir-assist-api-observation";
const token = "34c1364c-eb60-4384-b8da-4fc5f7815939";
const privateEnvelopeValues = {
  encryptedPayload: Buffer.from("PRIVATE-VOTER-AND-CAPTCHA-PAYLOAD").toString("base64"),
  encryptedKey: Buffer.from("PRIVATE-KEY-MATERIAL").toString("base64"),
  iv: Buffer.from("PRIVATE-IV-MATERIAL").toString("base64"),
};

function requestBody() {
  return JSON.stringify(privateEnvelopeValues);
}

function createObserverHarness() {
  const listeners = new Map();
  const dispatched = [];

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const document = {
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };

  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = new Map();
      this.responseType = "";
      this.responseText = "";
      this.status = 0;
    }

    open(method, url) {
      this.opened = { method, url };
    }

    send(body) {
      this.sent = body;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    finish(status, responseText) {
      this.status = status;
      this.responseText = responseText;
      this.listeners.get("loadend")?.();
    }
  }

  const originalFetch = async () =>
    new Response(
      JSON.stringify({
        hits: { hits: [], total: { value: 0 } },
        privateResultValue: "PRIVATE-RESPONSE-VALUE",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const context = {
    ArrayBuffer,
    Blob,
    CustomEvent: FakeCustomEvent,
    FormData,
    JSON,
    Request,
    Response,
    Set,
    TextEncoder,
    URL,
    URLSearchParams,
    WeakMap,
    XMLHttpRequest: FakeXMLHttpRequest,
    document,
    fetch: originalFetch,
    location: { href: `${pageOrigin}/`, origin: pageOrigin },
  };
  context.globalThis = context;
  context.window = context;
  context.top = context;

  vm.createContext(context);
  vm.runInContext(observerSource, context, { filename: "eci-network-observer.js" });

  function activate(detail = { enabled: true, token }) {
    document.dispatchEvent(
      new FakeCustomEvent(controlEvent, { detail: JSON.stringify(detail) }),
    );
  }

  function observations() {
    return dispatched
      .filter((event) => event.type === observationEvent)
      .map((event) => JSON.parse(event.detail));
  }

  return { activate, context, observations };
}

test("observer is dormant before the human-authorized submission", async () => {
  const { context, observations } = createObserverHarness();
  const init = { method: "POST" };
  Object.defineProperty(init, "body", {
    get() {
      throw new Error("Dormant observer must not inspect a request body.");
    },
  });
  await context.fetch(searchUrl, init);
  assert.deepEqual(observations(), []);
});

test("fetch observer emits one value-free exact-endpoint trace and disarms", async () => {
  const { activate, context, observations } = createObserverHarness();
  activate();
  await context.fetch(searchUrl, { method: "POST", body: requestBody() });
  await context.fetch(searchUrl, { method: "POST", body: requestBody() });

  const events = observations();
  assert.equal(events.length, 1);
  assert.equal(events[0].token, token);
  assert.deepEqual(events[0].observation, {
    transport: "fetch",
    method: "POST",
    endpoint: {
      origin: "https://gateway-voters.eci.gov.in",
      path: "/api/v1/elastic/search-by-details-from-state-display-v1",
      queryKeys: [],
    },
    status: 200,
    request: {
      topLevelKeys: ["encryptedPayload", "encryptedKey", "iv"],
      nestedKeys: [],
    },
    response: {
      topLevelKeys: [],
      schemaKeys: [],
      arrayLengths: [],
    },
  });
  const serialized = JSON.stringify(events[0]);
  for (const forbidden of [
    ...Object.values(privateEnvelopeValues),
    "PRIVATE-RESPONSE-VALUE",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("XHR observer reports status without reading raw response values", () => {
  const { activate, context, observations } = createObserverHarness();
  activate();
  const xhr = new context.XMLHttpRequest();
  xhr.open("POST", searchUrl);
  xhr.send(requestBody());
  xhr.finish(
    422,
    JSON.stringify({
      error: { code: "PRIVATE-CODE", message: "PRIVATE-MESSAGE" },
      SuchayanMitra: "PRIVATE-DYNAMIC-KEY-VALUE",
    }),
  );

  const events = observations();
  assert.equal(events.length, 1);
  assert.equal(events[0].observation.transport, "xhr");
  assert.equal(events[0].observation.status, 422);
  assert.deepEqual(events[0].observation.response, {
    topLevelKeys: [],
    schemaKeys: [],
    arrayLengths: [],
  });
  assert.doesNotMatch(
    JSON.stringify(events[0]),
    /PRIVATE-CODE|PRIVATE-MESSAGE|SuchayanMitra|PRIVATE-DYNAMIC-KEY-VALUE/,
  );
});

test("XHR observer never reads or reports root-array response bodies", () => {
  const { activate, context, observations } = createObserverHarness();
  activate();
  const xhr = new context.XMLHttpRequest();
  xhr.open("POST", searchUrl);
  xhr.send(requestBody());
  xhr.finish(
    200,
    JSON.stringify([
      {
        content: { items: [] },
        SuchayanMitra: "PRIVATE-ROW-VALUE",
      },
    ]),
  );

  const observation = observations()[0].observation;
  assert.deepEqual(observation.response, {
    topLevelKeys: [],
    schemaKeys: [],
    arrayLengths: [],
  });
  assert.doesNotMatch(JSON.stringify(observation), /SuchayanMitra|PRIVATE-ROW-VALUE/);
});

test("observer ignores query-bearing, non-POST and non-envelope requests", async () => {
  const { activate, context, observations } = createObserverHarness();
  activate();
  await context.fetch(`${searchUrl}?name=PRIVATE-QUERY-VALUE`, {
    method: "POST",
    body: requestBody(),
  });
  await context.fetch(searchUrl, { method: "GET" });
  await context.fetch(searchUrl, {
    method: "POST",
    body: JSON.stringify({ name: "PRIVATE-NAME", captcha: "PRIVATE-CAPTCHA" }),
  });
  assert.deepEqual(observations(), []);
});

test("observer rejects oversized encrypted envelopes instead of clamping them valid", async () => {
  const { activate, context, observations } = createObserverHarness();
  activate();
  await context.fetch(searchUrl, {
    method: "POST",
    body: JSON.stringify({
      encryptedPayload: "A".repeat(128_000),
      encryptedKey: privateEnvelopeValues.encryptedKey,
      iv: privateEnvelopeValues.iv,
    }),
  });
  assert.deepEqual(observations(), []);
});

test("protocol accepts only the bounded encrypted search observation", () => {
  const context = { Date, Set };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(protocolSource, context, { filename: "protocol.js" });

  const valid = {
    transport: "xhr",
    method: "POST",
    endpoint: {
      origin: "https://gateway-voters.eci.gov.in",
      path: "/api/v1/elastic/search-by-details-from-state-display-v1",
      queryKeys: [],
    },
    status: 200,
    request: {
      topLevelKeys: ["encryptedPayload", "encryptedKey", "iv"],
      nestedKeys: [],
    },
    response: {
      topLevelKeys: [],
      schemaKeys: [],
      arrayLengths: [],
    },
  };
  assert.equal(context.SirAssistProtocol.isApiObservation(valid), true);
  assert.equal(
    context.SirAssistProtocol.isApiObservation({ ...valid, rawResponse: "PRIVATE" }),
    false,
  );
  assert.equal(
    context.SirAssistProtocol.isApiObservation({
      ...valid,
      request: { ...valid.request, rawBody: "PRIVATE" },
    }),
    false,
  );
  assert.equal(
    context.SirAssistProtocol.isApiObservation({
      ...valid,
      endpoint: { ...valid.endpoint, origin: "https://example.com" },
    }),
    false,
  );
  assert.equal(
    context.SirAssistProtocol.isApiObservation({
      ...valid,
      response: {
        ...valid.response,
        schemaKeys: ["SuchayanMitra.privateIdentifier"],
      },
    }),
    false,
  );
});
