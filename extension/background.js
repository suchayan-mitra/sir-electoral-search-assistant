/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

importScripts("protocol.js");

const protocol = globalThis.SirAssistProtocol;
const ECI_URL = `${protocol.ECI_ORIGIN}/`;
const SESSION_KEY = "sirAssistSessions";
const ALARM_PREFIX = "sir-assist:";
const SESSION_TTL_MS = 90_000;
const sessions = new Map();

const hydrated = chrome.storage.session.get(SESSION_KEY).then((stored) => {
  const values = stored?.[SESSION_KEY];
  if (!values || typeof values !== "object") return;
  for (const [requestId, session] of Object.entries(values)) {
    if (
      protocol.isRequestId(requestId) &&
      protocol.isPlainObject(session) &&
      Number(session.expiresAt) > Date.now()
    ) {
      sessions.set(requestId, session);
    }
  }
});

async function persistSessions() {
  await chrome.storage.session.set({
    [SESSION_KEY]: Object.fromEntries(sessions),
  });
}

function allowedAppUrl(value) {
  try {
    return protocol.APP_ORIGINS.includes(new URL(value).origin);
  } catch {
    return false;
  }
}

function isEciUrl(value) {
  try {
    return new URL(value).origin === protocol.ECI_ORIGIN;
  } catch {
    return false;
  }
}

function pageMessage(message) {
  return { source: "sir-assist-extension", ...message };
}

async function sendToApp(session, message) {
  const tab = await chrome.tabs.get(session.appTabId).catch(() => null);
  if (!tab || !allowedAppUrl(tab.url) || new URL(tab.url).origin !== session.appOrigin) {
    return;
  }
  await chrome.tabs.sendMessage(session.appTabId, pageMessage(message)).catch(() => undefined);
}

async function cleanup(requestId, closeOfficial = true) {
  const session = sessions.get(requestId);
  sessions.delete(requestId);
  await persistSessions();
  await chrome.alarms.clear(`${ALARM_PREFIX}${requestId}`);
  if (closeOfficial && session?.officialTabId) {
    await chrome.tabs.remove(session.officialTabId).catch(() => undefined);
  }
}

function minimizeCandidates(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 10).map((row, index) => ({
    id: `candidate-${String(index + 1).padStart(2, "0")}`,
    displayName: protocol.cleanText(row?.displayName, `Candidate ${index + 1}`),
    match: "possible",
    ageBand: protocol.cleanText(row?.ageBand),
    district: protocol.cleanText(row?.district),
    constituency: protocol.cleanText(row?.constituency),
    matchedOn: ["selected name", "relative name", "birth detail"],
  }));
}

async function handleAppMessage(message, sender) {
  if (!sender.tab?.id || !allowedAppUrl(sender.tab.url)) return undefined;
  const appOrigin = new URL(sender.tab.url).origin;

  if (message.type === "PING") {
    for (const [requestId, session] of sessions) {
      if (session.appTabId === sender.tab.id && session.appOrigin === appOrigin) {
        await cleanup(requestId);
      }
    }
    return pageMessage({ type: "READY", version: chrome.runtime.getManifest().version });
  }

  if (message.type === "START") {
    if (!protocol.isRequestId(message.requestId) || !protocol.validSearch(message.search)) {
      return pageMessage({ type: "ERROR", error: "The search request was invalid." });
    }
    if (
      sessions.has(message.requestId) ||
      [...sessions.values()].some((session) => session.appTabId === sender.tab.id)
    ) {
      return pageMessage({
        type: "ERROR",
        requestId: message.requestId,
        error: "This SIR Assist tab already has an active case.",
      });
    }
    const officialTab = await chrome.tabs.create({ url: ECI_URL, active: false });
    if (!officialTab.id) {
      return pageMessage({
        type: "ERROR",
        requestId: message.requestId,
        error: "The official ECI tab could not be opened.",
      });
    }
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(message.requestId, {
      appTabId: sender.tab.id,
      appOrigin,
      officialTabId: officialTab.id,
      phase: "opening",
      expiresAt,
      search: message.search,
    });
    await persistSessions();
    await chrome.alarms.create(`${ALARM_PREFIX}${message.requestId}`, { when: expiresAt });
    return pageMessage({ type: "STARTED", requestId: message.requestId });
  }

  if (!protocol.isRequestId(message.requestId)) return undefined;
  const session = sessions.get(message.requestId);
  if (!session || session.appTabId !== sender.tab.id || session.appOrigin !== appOrigin) {
    return pageMessage({
      type: "ERROR",
      requestId: message.requestId,
      error: "This browser case no longer exists.",
    });
  }

  if (message.type === "SUBMIT") {
    if (session.phase !== "captcha") {
      return pageMessage({
        type: "ERROR",
        requestId: message.requestId,
        error: "This case has already used its one submission.",
      });
    }
    if (typeof message.captchaAnswer !== "string" || !/^[A-Za-z0-9]{4,12}$/.test(message.captchaAnswer)) {
      return pageMessage({
        type: "ERROR",
        requestId: message.requestId,
        error: "Enter the characters shown in the official CAPTCHA.",
      });
    }
    session.phase = "submitting";
    delete session.search;
    await persistSessions();
    try {
      await chrome.tabs.sendMessage(
        session.officialTabId,
        {
          source: "sir-assist-extension",
          type: "SUBMIT",
          requestId: message.requestId,
          captchaAnswer: message.captchaAnswer,
        },
      );
    } catch {
      await cleanup(message.requestId);
      return pageMessage({
        type: "ERROR",
        requestId: message.requestId,
        error: "The official ECI tab was unavailable. Start a new case.",
      });
    }
    return undefined;
  }

  if (message.type === "CANCEL") {
    await cleanup(message.requestId);
    return undefined;
  }
  return undefined;
}

async function handleEciMessage(message, sender) {
  if (!sender.tab?.id || !isEciUrl(sender.tab.url)) return undefined;
  const sessionEntry = [...sessions.entries()].find(
    ([, session]) => session.officialTabId === sender.tab.id,
  );
  if (!sessionEntry) return undefined;
  const [requestId, session] = sessionEntry;

  if (message.type === "ECI_READY" && session.phase === "opening") {
    await chrome.tabs.sendMessage(session.officialTabId, {
      source: "sir-assist-extension",
      type: "FILL",
      requestId,
      search: session.search,
    });
    return undefined;
  }

  if (message.requestId !== requestId) return undefined;
  if (message.type === "CAPTCHA_READY" && session.phase === "opening") {
    if (
      !protocol.isCaptchaDataImage(message.captchaImage)
    ) {
      await sendToApp(session, {
        type: "ERROR",
        requestId,
        error: "The official CAPTCHA image was invalid.",
      });
      await cleanup(requestId);
      return undefined;
    }
    session.phase = "captcha";
    delete session.search;
    await persistSessions();
    await sendToApp(session, {
      type: "CAPTCHA_READY",
      requestId,
      captchaImage: message.captchaImage,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
    return undefined;
  }

  if (message.type === "RESULTS" && session.phase === "submitting") {
    const candidates = minimizeCandidates(message.candidates);
    if (!candidates) {
      await sendToApp(session, {
        type: "ERROR",
        requestId,
        error: "The official results could not be safely minimized.",
      });
    } else {
      await sendToApp(session, { type: "RESULTS", requestId, candidates });
    }
    await cleanup(requestId);
    return undefined;
  }

  if (message.type === "ECI_ERROR") {
    await sendToApp(session, {
      type: "ERROR",
      requestId,
      error:
        typeof message.error === "string"
          ? message.error.slice(0, 240)
          : "The official ECI page could not complete this case.",
    });
    await cleanup(requestId);
  }
  return undefined;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await hydrated;
    if (message?.source === "sir-assist-page") {
      return handleAppMessage(message, sender);
    }
    if (message?.source === "eci-driver") {
      return handleEciMessage(message, sender);
    }
    return undefined;
  })()
    .then(sendResponse)
    .catch(() =>
      sendResponse(
        pageMessage({
          type: "ERROR",
          requestId: message?.requestId,
          error: "The browser companion could not complete this step.",
        }),
      ),
    );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const requestId = alarm.name.slice(ALARM_PREFIX.length);
  void hydrated.then(async () => {
    const session = sessions.get(requestId);
    if (session) {
      await sendToApp(session, {
        type: "ERROR",
        requestId,
        error: "The CAPTCHA session expired. Start a new case.",
      });
      await cleanup(requestId);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void hydrated.then(async () => {
    for (const [requestId, session] of sessions) {
      if (session.appTabId === tabId) await cleanup(requestId);
      else if (session.officialTabId === tabId) {
        await sendToApp(session, {
          type: "ERROR",
          requestId,
          error: "The official ECI tab was closed. Start a new case.",
        });
        await cleanup(requestId, false);
      }
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isEciUrl(tab.url)) return;
  void hydrated.then(async () => {
    const sessionEntry = [...sessions.entries()].find(
      ([, session]) =>
        session.officialTabId === tabId && session.phase === "opening",
    );
    if (!sessionEntry) return;
    const [requestId, session] = sessionEntry;
    await chrome.tabs
      .sendMessage(tabId, {
        source: "sir-assist-extension",
        type: "FILL",
        requestId,
        search: session.search,
      })
      .catch(() => undefined);
  });
});
