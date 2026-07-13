/*
 * Copyright (C) 2026 Suchayan Mitra
 * Author: Suchayan Mitra
 * Development assistance: AI Copilot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DurableObject } from "cloudflare:workers";
import puppeteer, {
  type Browser,
  type BrowserWorker,
  type Page,
} from "@cloudflare/puppeteer";
import type {
  CandidateSummary,
  SearchRequest,
} from "../lib/server/official-api-adapter";

export interface WorkerEnv {
  ASSETS: Fetcher;
  BROWSER: BrowserWorker;
  BROWSER_SESSION: DurableObjectNamespace;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

type SessionPhase = "starting" | "captcha" | "submitting";

type StoredSession = {
  phase: SessionPhase;
  sessionId?: string;
  expiresAt: number;
};

type RateState = {
  starts: number[];
};

type AdmissionState = {
  leases: Record<string, number>;
};

type EciTableRow = {
  displayName: string;
  exactAge: string;
  district: string;
  constituency: string;
};

const ECI_SEARCH_URL = "https://electoralsearch.eci.gov.in/";
const SEARCH_RESPONSE_PATH =
  "/api/v1/elastic/search-by-details-from-state-display-v1";
const SESSION_KEY = "session";
const RATE_KEY = "rate";
const ADMISSION_KEY = "admission";
const SESSION_TTL_MS = 90_000;
const BROWSER_KEEP_ALIVE_MS = 120_000;
const SUBMISSION_CLEANUP_GRACE_MS = 30_000;
const ADMISSION_TTL_MS = 120_000;
const MAX_CONCURRENT_SESSIONS = 2;
const MAX_RESULTS = 10;

const stateCodes: Record<SearchRequest["state"], string> = {
  karnataka: "S10",
  west_bengal: "S25",
  odisha: "S18",
};

const genderCodes: Record<SearchRequest["gender"], string> = {
  female: "F",
  male: "M",
  other: "T",
};

const districtAliases: Record<string, string> = {
  BENGALURUURBAN: "BANGALOREURBAN",
  BELAGAVI: "BELGAUM",
  MYSURU: "MYSORE",
  SHIVAMOGGA: "SHIMOGA",
};

class SessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function apiJson(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store, private",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function normalizeDistrict(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return districtAliases[normalized] ?? normalized;
}

function ageBand(value: string): string {
  const age = Number.parseInt(value, 10);
  if (!Number.isFinite(age)) return "Not stated";
  return `${Math.max(18, age - 2)}–${age + 2}`;
}

function sanitizeText(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, 120);
  return cleaned || fallback;
}

function minimizeRows(rows: EciTableRow[]): CandidateSummary[] {
  return rows.slice(0, MAX_RESULTS).map((row, index) => ({
    id: `candidate-${String(index + 1).padStart(2, "0")}`,
    displayName: sanitizeText(row.displayName, `Candidate ${index + 1}`),
    match: "possible",
    ageBand: ageBand(row.exactAge),
    district: sanitizeText(row.district, "Not stated"),
    constituency: sanitizeText(row.constituency, "Not stated"),
    matchedOn: ["selected name", "relative name", "birth detail"],
  }));
}

async function getEciPage(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const page = pages.find((candidate) =>
    candidate.url().startsWith(ECI_SEARCH_URL),
  );
  if (!page) {
    throw new SessionError(
      "The official search session expired. Start a new case.",
      410,
    );
  }
  return page;
}

async function chooseDistrict(page: Page, district: string): Promise<void> {
  await page.waitForFunction(
    () => {
      const select = document.querySelector(
        'select[aria-label="Select District"]',
      ) as unknown as { options: { length: number } } | null;
      return Boolean(select && select.options.length > 1);
    },
    { timeout: 12_000 },
  );

  const requested = normalizeDistrict(district);
  const optionValue = await page.$eval(
    'select[aria-label="Select District"]',
    (element, expected) => {
      const select = element as unknown as HTMLSelectElement;
      const normalizedExpected = String(expected);
      const option = Array.from(select.options).find(
        (candidate) =>
          (candidate.textContent ?? "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "") === normalizedExpected,
      );
      return option?.value ?? null;
    },
    requested,
  );

  if (!optionValue) {
    throw new SessionError(
      "That district name was not found on the official ECI form. Leave district blank or use the official district spelling.",
      400,
    );
  }
  await page.select('select[aria-label="Select District"]', optionValue);
}

async function setDateValue(page: Page, dob: string): Promise<void> {
  await page.$eval(
    'input[type="date"][name="date"]',
    (element, value) => {
      const input = element as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    dob,
  );
}

async function prepareOfficialPage(
  browser: Browser,
  search: SearchRequest,
): Promise<{ page: Page; captchaImage: string }> {
  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());
  await page.setViewport({ width: 1280, height: 900 });
  const captchaResponsePromise = page
    .waitForResponse(
      (response) => response.url().includes("/captcha-service/getCaptcha/sir"),
      { timeout: 30_000 },
    )
    .catch(() => null);
  await page.goto(ECI_SEARCH_URL, {
    waitUntil: "networkidle2",
    timeout: 35_000,
  });
  await page.waitForSelector('#detail[aria-label="Search By Details"]', {
    timeout: 20_000,
  });
  await page.click('#detail[aria-label="Search By Details"]');
  await page.waitForSelector("#firstNameID", { timeout: 15_000 });

  await page.select("#stateID", stateCodes[search.state]);
  await page.type("#firstNameID", search.name, { delay: 12 });
  await page.type("#relFirstNameID", search.relativeName, { delay: 12 });

  if (search.dob) {
    await page.click('input[type="radio"][name="date"][value="dob"]');
    await setDateValue(page, search.dob);
  } else if (search.age) {
    await page.click('input[type="radio"][name="date"][value="age"]');
    await page.select("select#ageID", String(search.age));
  }

  await page.click(
    `input[type="radio"][name="gender"][value="${genderCodes[search.gender]}"]`,
  );

  if (search.district) await chooseDistrict(page, search.district);

  const captchaSelector =
    '.captcha-div img[src^="data:image/jpg;base64,"]';
  try {
    await page.waitForFunction(
      (selector) => {
        const image = document.querySelector(selector) as unknown as {
          getAttribute(name: string): string | null;
        } | null;
        const source = image?.getAttribute("src") ?? "";
        return source.startsWith("data:image/jpg;base64,") && source.length > 500;
      },
      { timeout: 20_000 },
      captchaSelector,
    );
  } catch {
    await captchaResponsePromise;
    throw new SessionError(
      "The official ECI CAPTCHA could not be loaded through the controlled browser. Try again later.",
      502,
    );
  }
  const captchaImage = await page.$eval(captchaSelector, (element) =>
    (element as HTMLImageElement).getAttribute("src"),
  );
  if (
    !captchaImage?.startsWith("data:image/jpg;base64,") ||
    captchaImage.length <= 500
  ) {
    throw new SessionError(
      "The official ECI CAPTCHA could not be loaded. Try again shortly.",
      502,
    );
  }
  return { page, captchaImage };
}

async function readMinimizedTable(page: Page): Promise<CandidateSummary[]> {
  await page.waitForFunction(
    () => {
      const hasTable = Boolean(document.querySelector("table#table-id"));
      const hasNoResult = Array.from(document.querySelectorAll("h4")).some(
        (element) => (element.textContent ?? "").trim() === "No Result Found",
      );
      const hasOfficialError = Boolean(
        document.querySelector(".Toastify__toast--error"),
      );
      return hasTable || hasNoResult || hasOfficialError;
    },
    { timeout: 10_000 },
  );

  const outcome = await page.evaluate(() => ({
    hasTable: Boolean(document.querySelector("table#table-id")),
    hasNoResult: Array.from(document.querySelectorAll("h4")).some(
      (element) => (element.textContent ?? "").trim() === "No Result Found",
    ),
    hasOfficialError: Boolean(
      document.querySelector(".Toastify__toast--error"),
    ),
  }));
  if (outcome.hasOfficialError) {
    throw new SessionError(
      "The official site did not accept the CAPTCHA. The one search attempt is closed; start a new case.",
      422,
    );
  }
  if (outcome.hasNoResult && !outcome.hasTable) return [];
  if (!outcome.hasTable) {
    throw new SessionError(
      "The official ECI results page did not reach a recognized result state.",
      502,
    );
  }

  const rows = await page.$eval("table#table-id", (element) => {
    const tableElement = element as HTMLTableElement;
    const headers = Array.from(tableElement.querySelectorAll("thead th, thead td")).map(
      (header) =>
        (header.textContent ?? "").trim().toUpperCase().replace(/\s+/g, " "),
    );
    const nameIndex = headers.findIndex(
      (header) => header === "NAME" || (header.endsWith("NAME") && !header.includes("RELATIVE")),
    );
    const ageIndex = headers.findIndex((header) => header === "AGE");
    const districtIndex = headers.findIndex((header) =>
      header.includes("DISTRICT"),
    );
    const constituencyIndex = headers.findIndex((header) =>
      header.includes("ASSEMBLY CONSTITUENCY"),
    );

    if (
      nameIndex < 0 ||
      ageIndex < 0 ||
      districtIndex < 0 ||
      constituencyIndex < 0
    ) {
      return null;
    }

    return Array.from(tableElement.querySelectorAll("tbody tr"))
      .slice(0, 10)
      .map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        return {
          displayName: cells[nameIndex]?.textContent ?? "",
          exactAge: cells[ageIndex]?.textContent ?? "",
          district: cells[districtIndex]?.textContent ?? "",
          constituency: cells[constituencyIndex]?.textContent ?? "",
        };
      });
  });

  if (!rows) {
    throw new SessionError(
      "The official ECI results page changed and could not be safely minimized.",
      502,
    );
  }
  return minimizeRows(rows);
}

export class BrowserSession extends DurableObject<WorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (body.action === "rate") return await this.rateLimit();
      if (body.action === "admit") {
        return await this.admit(String(body.caseId ?? ""));
      }
      if (body.action === "release") {
        return await this.release(String(body.caseId ?? ""));
      }
      if (body.action === "start") {
        return await this.start(body.search as SearchRequest);
      }
      if (body.action === "submit") {
        return await this.submit(String(body.captchaAnswer ?? ""));
      }
      if (body.action === "cancel") return await this.cancel();
      return apiJson({ error: "Unknown case action." }, 400);
    } catch (error) {
      if (error instanceof SessionError) {
        return apiJson({ error: error.message }, error.status);
      }
      return apiJson(
        {
          error:
            "The controlled browser could not complete this step. The official site may be unavailable or may have changed.",
        },
        502,
      );
    }
  }

  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<StoredSession>(SESSION_KEY);
    if (!stored) {
      const admission = await this.ctx.storage.get<AdmissionState>(ADMISSION_KEY);
      if (admission) {
        const now = Date.now();
        const leases = Object.fromEntries(
          Object.entries(admission.leases).filter(([, expiry]) => expiry > now),
        );
        const expiries = Object.values(leases);
        if (expiries.length > 0) {
          await this.ctx.storage.put<AdmissionState>(ADMISSION_KEY, { leases });
          await this.ctx.storage.setAlarm(Math.min(...expiries));
        } else {
          await this.ctx.storage.delete(ADMISSION_KEY);
        }
        return;
      }
      await this.ctx.storage.deleteAll();
      return;
    }
    if (stored.phase === "submitting") {
      const cleanupAt = stored.expiresAt + SUBMISSION_CLEANUP_GRACE_MS;
      if (Date.now() < cleanupAt) {
        await this.ctx.storage.setAlarm(
          Math.min(Date.now() + 10_000, cleanupAt),
        );
        return;
      }
    }
    await this.closeStoredBrowser(stored);
    await this.ctx.storage.deleteAll();
  }

  private async rateLimit(): Promise<Response> {
    const now = Date.now();
    const existing = await this.ctx.storage.get<RateState>(RATE_KEY);
    const starts = (existing?.starts ?? []).filter(
      (timestamp) => now - timestamp < 60 * 60 * 1000,
    );
    const last = starts.at(-1) ?? 0;
    if (now - last < 20_000 || starts.length >= 10) {
      return apiJson(
        { error: "Please wait before starting another official browser session." },
        429,
      );
    }
    starts.push(now);
    await this.ctx.storage.put(RATE_KEY, { starts });
    await this.ctx.storage.setAlarm(now + 60 * 60 * 1000);
    return apiJson({ allowed: true });
  }

  private async admit(caseId: string): Promise<Response> {
    if (!/^[0-9a-f-]{36}$/i.test(caseId)) {
      throw new SessionError("The browser admission request was invalid.", 400);
    }
    const now = Date.now();
    const existing = await this.ctx.storage.get<AdmissionState>(ADMISSION_KEY);
    const leases = Object.fromEntries(
      Object.entries(existing?.leases ?? {}).filter(([, expiry]) => expiry > now),
    );
    if (Object.keys(leases).length >= MAX_CONCURRENT_SESSIONS) {
      throw new SessionError(
        "All controlled browser slots are busy. Try again shortly.",
        503,
      );
    }
    leases[caseId] = now + ADMISSION_TTL_MS;
    await this.ctx.storage.put<AdmissionState>(ADMISSION_KEY, { leases });
    await this.ctx.storage.setAlarm(Math.min(...Object.values(leases)));
    return apiJson({ admitted: true });
  }

  private async release(caseId: string): Promise<Response> {
    const existing = await this.ctx.storage.get<AdmissionState>(ADMISSION_KEY);
    if (!existing) return apiJson({ released: true });
    delete existing.leases[caseId];
    const expiries = Object.values(existing.leases);
    if (expiries.length > 0) {
      await this.ctx.storage.put(ADMISSION_KEY, existing);
      await this.ctx.storage.setAlarm(Math.min(...expiries));
    } else {
      await this.ctx.storage.delete(ADMISSION_KEY);
    }
    return apiJson({ released: true });
  }

  private async start(search: SearchRequest): Promise<Response> {
    if (await this.ctx.storage.get(SESSION_KEY)) {
      throw new SessionError("This case has already been started.", 409);
    }

    const expiresAt = Date.now() + SESSION_TTL_MS;
    await this.ctx.storage.put<StoredSession>(SESSION_KEY, {
      phase: "starting",
      expiresAt,
    });
    await this.ctx.storage.setAlarm(expiresAt);

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch(this.env.BROWSER, {
        keep_alive: BROWSER_KEEP_ALIVE_MS,
      });
      const { captchaImage } = await prepareOfficialPage(browser, search);
      const sessionId = browser.sessionId();
      await this.ctx.storage.put<StoredSession>(SESSION_KEY, {
        phase: "captcha",
        sessionId,
        expiresAt,
      });
      await this.ctx.storage.setAlarm(expiresAt);
      browser.disconnect();
      browser = undefined;
      return apiJson({ captchaImage, expiresAt: new Date(expiresAt).toISOString() });
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      const stored = await this.ctx.storage.get<StoredSession>(SESSION_KEY);
      if (stored?.phase === "starting") await this.ctx.storage.deleteAll();
    }
  }

  private async submit(captchaAnswer: string): Promise<Response> {
    const stored = await this.ctx.storage.get<StoredSession>(SESSION_KEY);
    if (!stored?.sessionId) {
      throw new SessionError("This official search session no longer exists.", 410);
    }
    if (stored.phase !== "captcha") {
      throw new SessionError("This case has already used its one search attempt.", 409);
    }
    if (stored.expiresAt <= Date.now()) {
      await this.closeStoredBrowser(stored);
      await this.ctx.storage.deleteAll();
      throw new SessionError("The CAPTCHA expired. Start a new case.", 410);
    }
    if (!/^[A-Za-z0-9]{4,12}$/.test(captchaAnswer.trim())) {
      throw new SessionError("Enter the characters shown in the CAPTCHA image.", 400);
    }

    await this.ctx.storage.put<StoredSession>(SESSION_KEY, {
      ...stored,
      phase: "submitting",
    });

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.connect(this.env.BROWSER, stored.sessionId);
      const page = await getEciPage(browser);
      await page.type('input[name="captcha"][aria-label="Enter Captcha"]', captchaAnswer.trim());
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(SEARCH_RESPONSE_PATH) &&
          response.request().method() === "POST",
        { timeout: 30_000 },
      );
      await page.click('button[aria-label="Search"]');
      const officialResponse = await responsePromise;
      if (!officialResponse.ok()) {
        throw new SessionError(
          "The official site did not verify that CAPTCHA. The one search attempt is closed; start a new case.",
          422,
        );
      }
      const candidates = await readMinimizedTable(page);
      return apiJson({ candidates });
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      await this.ctx.storage.deleteAll();
    }
  }

  private async cancel(): Promise<Response> {
    const stored = await this.ctx.storage.get<StoredSession>(SESSION_KEY);
    if (stored) await this.closeStoredBrowser(stored);
    await this.ctx.storage.deleteAll();
    return apiJson({ cancelled: true });
  }

  private async closeStoredBrowser(stored: StoredSession): Promise<void> {
    if (!stored.sessionId) return;
    try {
      const browser = await puppeteer.connect(this.env.BROWSER, stored.sessionId);
      await browser.close();
    } catch {
      // Browser Run may already have expired the remote session.
    }
  }
}

export const searchRuntimeConstants = {
  stateCodes,
  sessionTtlMs: SESSION_TTL_MS,
  maxResults: MAX_RESULTS,
};
