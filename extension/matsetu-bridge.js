/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
  "use strict";

  const protocol = globalThis.MatsetuProtocol;
  if (window.top !== window || !protocol.APP_ORIGINS.includes(location.origin)) {
    return;
  }

  const pageTypes = new Set(["PING", "START", "SUBMIT", "CANCEL"]);
  const extensionTypes = new Set([
    "READY",
    "STARTED",
    "CAPTCHA_READY",
    "RESULTS",
    "ERROR",
  ]);

  function postToPage(message) {
    if (!protocol.isPlainObject(message) || !extensionTypes.has(message.type)) {
      return;
    }
    window.postMessage(
      {
        channel: protocol.CHANNEL,
        direction: "to-page",
        ...message,
      },
      location.origin,
    );
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !protocol.isPlainObject(event.data) ||
      event.data.channel !== protocol.CHANNEL ||
      event.data.direction !== "to-extension" ||
      !pageTypes.has(event.data.type)
    ) {
      return;
    }
    let serialized;
    try {
      serialized = JSON.stringify(event.data);
    } catch {
      return;
    }
    if (serialized.length > 4_096) return;

    chrome.runtime
      .sendMessage({ ...event.data, source: "matsetu-page" })
      .then((response) => postToPage(response))
      .catch(() =>
        postToPage({
          type: "ERROR",
          requestId: event.data.requestId,
          error: "The Matsetu browser companion is unavailable. Reload the page.",
        }),
      );
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.source === "matsetu-extension") postToPage(message);
  });
})();
