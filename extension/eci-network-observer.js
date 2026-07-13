/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  "use strict";

  const PAGE_ORIGIN = "https://electoralsearch.eci.gov.in";
  const SEARCH_ORIGIN = "https://gateway-voters.eci.gov.in";
  const SEARCH_PATH = "/api/v1/elastic/search-by-details-from-state-display-v1";
  const CONTROL_EVENT = "sir-assist-api-observer-control";
  const OBSERVATION_EVENT = "sir-assist-api-observation";
  const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/;
  const MAX_SCHEMA_KEYS = 48;
  const MAX_DEPTH = 4;
  const MAX_EVENT_LENGTH = 8_192;
  const encoder = new TextEncoder();
  let activeToken = "";

  if (window.top !== window || location.origin !== PAGE_ORIGIN) return;

  function parseControl(detail) {
    if (typeof detail !== "string" || detail.length > 160) return null;
    try {
      const value = JSON.parse(detail);
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => key !== "enabled" && key !== "token") ||
        typeof value.enabled !== "boolean" ||
        typeof value.token !== "string" ||
        !TOKEN_PATTERN.test(value.token)
      ) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  document.addEventListener(CONTROL_EVENT, (event) => {
    const control = parseControl(event.detail);
    if (!control) return;
    if (control.enabled) activeToken = control.token;
    else if (control.token === activeToken) activeToken = "";
  });

  function cleanKey(value) {
    return typeof value === "string" && KEY_PATTERN.test(value) ? value : "";
  }

  function endpointFrom(value) {
    try {
      const url = new URL(String(value), location.href);
      if (url.origin !== SEARCH_ORIGIN || url.pathname !== SEARCH_PATH) return null;
      if (url.search !== "") return null;
      return {
        origin: SEARCH_ORIGIN,
        path: SEARCH_PATH,
        queryKeys: [],
      };
    } catch {
      return null;
    }
  }

  function schemaOf(value) {
    const topLevelKeys = [];
    const schemaKeys = [];
    const nestedKeys = [];
    const seenSchema = new Set();
    const seenNested = new Set();
    const seenObjects = new WeakSet();

    function addSchema(path) {
      if (!path || seenSchema.has(path) || schemaKeys.length >= MAX_SCHEMA_KEYS) return;
      seenSchema.add(path);
      schemaKeys.push(path);
    }

    function addNested(path) {
      if (!path || seenNested.has(path) || nestedKeys.length >= MAX_SCHEMA_KEYS) return;
      seenNested.add(path);
      nestedKeys.push(path);
    }

    function visit(current, path, depth) {
      if (!current || typeof current !== "object" || depth > MAX_DEPTH) return;
      if (seenObjects.has(current)) return;
      seenObjects.add(current);

      if (Array.isArray(current)) {
        if (current.length > 0) visit(current[0], path ? `${path}[]` : "$[]", depth + 1);
        return;
      }

      for (const rawKey of Object.keys(current)) {
        const key = cleanKey(rawKey);
        if (!key) continue;
        const keyPath = path ? `${path}.${key}` : key;
        if (
          depth === 0 &&
          topLevelKeys.length < 32 &&
          !topLevelKeys.includes(key)
        ) {
          topLevelKeys.push(key);
        }
        addSchema(keyPath);
        if (depth > 0) addNested(keyPath);
        visit(current[rawKey], keyPath, depth + 1);
        if (
          schemaKeys.length >= MAX_SCHEMA_KEYS &&
          nestedKeys.length >= MAX_SCHEMA_KEYS
        ) {
          break;
        }
      }
    }

    visit(value, "", 0);
    return { topLevelKeys, schemaKeys, nestedKeys };
  }

  function isBoundedBase64(value, maxLength) {
    return (
      typeof value === "string" &&
      value.length >= 4 &&
      value.length <= maxLength &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value)
    );
  }

  function requestBodySummary(body) {
    if (body === undefined || body === null) {
      return {
        metadata: { topLevelKeys: [], nestedKeys: [], byteLength: 0 },
        validEnvelope: false,
      };
    }

    let byteLength = 0;
    let value = null;
    if (typeof body === "string") {
      byteLength = body.length > 128_000 ? 128_001 : encoder.encode(body).byteLength;
      try {
        if (byteLength <= 128_000) value = JSON.parse(body);
      } catch {
        value = null;
      }
    } else if (body instanceof ArrayBuffer) {
      byteLength = body.byteLength;
    } else if (ArrayBuffer.isView(body)) {
      byteLength = body.byteLength;
    } else if (typeof Blob !== "undefined" && body instanceof Blob) {
      byteLength = body.size;
    }

    const schema = schemaOf(value);
    return {
      metadata: {
        topLevelKeys: schema.topLevelKeys,
        nestedKeys: schema.nestedKeys,
        byteLength: Math.max(0, byteLength),
      },
      validEnvelope:
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 3 &&
        isBoundedBase64(value.encryptedPayload, 120_000) &&
        isBoundedBase64(value.encryptedKey, 4_096) &&
        isBoundedBase64(value.iv, 512),
    };
  }

  function isExpectedRequest(request) {
    return (
      request.validEnvelope &&
      request.metadata.byteLength > 0 &&
      request.metadata.byteLength <= 128_000 &&
      request.metadata.nestedKeys.length === 0 &&
      request.metadata.topLevelKeys.length === 3 &&
      ["encryptedPayload", "encryptedKey", "iv"].every((key) =>
        request.metadata.topLevelKeys.includes(key),
      )
    );
  }

  function emit(token, observation) {
    if (!token || token !== activeToken) return;
    let serialized = JSON.stringify({ token, observation });
    if (serialized.length > MAX_EVENT_LENGTH) {
      observation = {
        ...observation,
        response: { topLevelKeys: [], schemaKeys: [], arrayLengths: [] },
      };
      serialized = JSON.stringify({ token, observation });
    }
    if (serialized.length > MAX_EVENT_LENGTH) return;
    activeToken = "";
    document.dispatchEvent(
      new CustomEvent(OBSERVATION_EVENT, {
        detail: serialized,
      }),
    );
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      const token = activeToken;
      if (!token) return Reflect.apply(originalFetch, this, args);
      const input = args[0];
      const init = args[1];
      const endpoint = endpointFrom(input instanceof Request ? input.url : input);
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!endpoint || method !== "POST") return Reflect.apply(originalFetch, this, args);
      const request = requestBodySummary(init?.body);
      if (!isExpectedRequest(request)) return Reflect.apply(originalFetch, this, args);
      return Promise.resolve(Reflect.apply(originalFetch, this, args)).then(
        (response) => {
          emit(token, {
            transport: "fetch",
            method,
            endpoint,
            status: Number(response.status) || 0,
            request: {
              topLevelKeys: request.metadata.topLevelKeys,
              nestedKeys: request.metadata.nestedKeys,
            },
            response: { topLevelKeys: [], schemaKeys: [], arrayLengths: [] },
          });
          return response;
        },
        (error) => {
          emit(token, {
            transport: "fetch",
            method,
            endpoint,
            status: 0,
            request: {
              topLevelKeys: request.metadata.topLevelKeys,
              nestedKeys: request.metadata.nestedKeys,
            },
            response: { topLevelKeys: [], schemaKeys: [], arrayLengths: [] },
          });
          throw error;
        },
      );
    };
  }

  const xhrMetadata = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    xhrMetadata.set(this, {
      endpoint: endpointFrom(url),
      method: String(method || "GET").toUpperCase(),
    });
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const metadata = xhrMetadata.get(this);
    const token = activeToken;
    if (!token || !metadata?.endpoint || metadata.method !== "POST") {
      return Reflect.apply(originalSend, this, [body]);
    }
    const request = requestBodySummary(body);
    if (isExpectedRequest(request)) {
      this.addEventListener(
        "loadend",
        () => {
          emit(token, {
            transport: "xhr",
            method: metadata.method,
            endpoint: metadata.endpoint,
            status: Number(this.status) || 0,
            request: {
              topLevelKeys: request.metadata.topLevelKeys,
              nestedKeys: request.metadata.nestedKeys,
            },
            response: { topLevelKeys: [], schemaKeys: [], arrayLengths: [] },
          });
        },
        { once: true },
      );
    }
    return Reflect.apply(originalSend, this, [body]);
  };
})();
