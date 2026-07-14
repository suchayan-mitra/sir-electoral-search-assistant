/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const transportSource = await readFile(
  new URL("../lib/client/extension-transport.ts", import.meta.url),
  "utf8",
);
const transpiled = ts.transpileModule(transportSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "extension-transport.ts",
  reportDiagnostics: true,
});
assert.deepEqual(
  (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  ),
  [],
);
const transport = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
);

const appOrigin = "https://sir-electoral-search-assistant.jukulda.workers.dev";
const windowMock = { location: { origin: appOrigin } };
globalThis.window = windowMock;

test("API observation transport contains no logging or persistence path", () => {
  assert.doesNotMatch(
    transportSource,
    /console\.|localStorage|sessionStorage|indexedDB/,
  );
});

function validObservation() {
  return {
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
  };
}

function eventFor(observation, overrides = {}) {
  return {
    source: windowMock,
    origin: appOrigin,
    data: {
      channel: transport.EXTENSION_CHANNEL,
      direction: "to-page",
      source: "sir-assist-extension",
      type: "API_OBSERVATION",
      requestId: "34c1364c-eb60-4384-b8da-4fc5f7815939",
      observation,
      ...overrides,
    },
  };
}

function resultsEvent(overrides = {}) {
  return {
    source: windowMock,
    origin: appOrigin,
    data: {
      channel: transport.EXTENSION_CHANNEL,
      direction: "to-page",
      source: "sir-assist-extension",
      type: "RESULTS",
      requestId: "34c1364c-eb60-4384-b8da-4fc5f7815939",
      candidates: [
        {
          displayName: "Example Voter",
          ageBand: "40–44",
          district: "Kolkata",
          constituency: "Example Assembly Constituency",
          matchedOn: ["selected name", "relative name", "birth detail"],
        },
      ],
      resultLimitReached: false,
      ...overrides,
    },
  };
}

test("accepts bounded value-free official API metadata", () => {
  assert.deepEqual(
    transport.parseExtensionMessage(eventFor(validObservation())),
    {
      type: "API_OBSERVATION",
      requestId: "34c1364c-eb60-4384-b8da-4fc5f7815939",
      observation: validObservation(),
    },
  );
});

test("rejects API metadata for any non-official endpoint origin", () => {
  const observation = validObservation();
  observation.endpoint.origin = "https://example.com";
  assert.equal(transport.parseExtensionMessage(eventFor(observation)), null);
});

test("rejects other paths and methods even on the official gateway", () => {
  const otherPath = validObservation();
  otherPath.endpoint.path = "/api/v1/captcha-service/generateCaptcha";
  assert.equal(transport.parseExtensionMessage(eventFor(otherPath)), null);

  const otherMethod = validObservation();
  otherMethod.method = "GET";
  assert.equal(transport.parseExtensionMessage(eventFor(otherMethod)), null);
});

test("rejects observation envelopes carrying raw request or response values", () => {
  const observationWithRawRequest = {
    ...validObservation(),
    request: {
      ...validObservation().request,
      rawBody: "must never cross the bridge",
    },
  };
  assert.equal(
    transport.parseExtensionMessage(eventFor(observationWithRawRequest)),
    null,
  );

  const eventWithExtraTopLevelValue = eventFor(validObservation(), {
    captchaAnswer: "must never cross the bridge",
  });
  assert.equal(
    transport.parseExtensionMessage(eventWithExtraTopLevelValue),
    null,
  );

  const unexpectedRequestKey = validObservation();
  unexpectedRequestKey.request.topLevelKeys = ["name", "encryptedKey", "iv"];
  assert.equal(
    transport.parseExtensionMessage(eventFor(unexpectedRequestKey)),
    null,
  );

  const queryValueCarrier = validObservation();
  queryValueCarrier.endpoint.queryKeys = ["search"];
  assert.equal(
    transport.parseExtensionMessage(eventFor(queryValueCarrier)),
    null,
  );
});

test("rejects response schema names that could encode private values", () => {
  const forgedTopLevel = validObservation();
  forgedTopLevel.response.topLevelKeys = ["ABC123VOTERID"];
  assert.equal(
    transport.parseExtensionMessage(eventFor(forgedTopLevel)),
    null,
  );

  const forgedNested = validObservation();
  forgedNested.response.schemaKeys = ["$[].content.ABC123VOTERID"];
  assert.equal(
    transport.parseExtensionMessage(eventFor(forgedNested)),
    null,
  );

  const forgedArrayPath = validObservation();
  forgedArrayPath.response.arrayLengths = [
    { path: "$[].content.ABC123VOTERID", length: 1 },
  ];
  assert.equal(
    transport.parseExtensionMessage(eventFor(forgedArrayPath)),
    null,
  );
});

test("rejects oversized, duplicate and malformed schema metadata", () => {
  const tooManyKeys = validObservation();
  tooManyKeys.response.schemaKeys = Array.from(
    { length: 65 },
    (_, index) => `field${index}`,
  );
  assert.equal(transport.parseExtensionMessage(eventFor(tooManyKeys)), null);

  const duplicateKeys = validObservation();
  duplicateKeys.request.topLevelKeys = ["iv", "iv"];
  assert.equal(transport.parseExtensionMessage(eventFor(duplicateKeys)), null);

  const malformedPath = validObservation();
  malformedPath.endpoint.path = "/search?secret=value";
  assert.equal(transport.parseExtensionMessage(eventFor(malformedPath)), null);
});

test("rejects observation messages from the wrong page origin or source", () => {
  assert.equal(
    transport.parseExtensionMessage({
      ...eventFor(validObservation()),
      origin: "https://example.com",
    }),
    null,
  );
  assert.equal(
    transport.parseExtensionMessage(
      eventFor(validObservation(), { source: "unknown-extension" }),
    ),
    null,
  );
  assert.equal(
    transport.parseExtensionMessage(
      eventFor(validObservation(), { requestId: "not-a-case-id" }),
    ),
    null,
  );
});

test("accepts only bounded result messages with explicit limit metadata", () => {
  assert.deepEqual(
    transport.parseExtensionMessage(resultsEvent()),
    {
      type: "RESULTS",
      requestId: "34c1364c-eb60-4384-b8da-4fc5f7815939",
      candidates: [
        {
          id: "candidate-01",
          displayName: "Example Voter",
          match: "possible",
          ageBand: "40–44",
          district: "Kolkata",
          constituency: "Example Assembly Constituency",
          matchedOn: ["selected name", "relative name", "birth detail"],
        },
      ],
      resultLimitReached: false,
    },
  );
  assert.equal(
    transport.parseExtensionMessage(resultsEvent({ resultLimitReached: "yes" })),
    null,
  );
  assert.equal(
    transport.parseExtensionMessage(
      resultsEvent({ extraResultMetadata: "must not cross" }),
    ),
    null,
  );
});
