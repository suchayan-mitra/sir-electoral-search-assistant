# SIR Assist Browser Companion

This Manifest V3 extension runs one deterministic ECI search in the user's normal browser. It does not use an LLM, OCR, a CAPTCHA solver, proxy, or Cloudflare Browser Run.

## Why SIR Assist needs a browser companion

The official ECI search runs on ECI's webpage and requires a fresh CAPTCHA entered by a person. SIR Assist deliberately does not send voter-search details through its Worker. The companion provides the narrow local bridge needed to:

1. open the official ECI page in the user's browser;
2. fill one spelling and birth-detail combination the user approved;
3. show the untouched ECI CAPTCHA back in SIR Assist for the user to type; and
4. return only a minimized possible-match summary.

AI-first spelling generation occurs in the web app after the user chooses its clearly labelled action; a dictionary-free offline alternative is also available. AI never operates this extension, sees official-search details or results, or interprets a CAPTCHA.

## Install the development build

1. Download and unzip `sir-assist-browser-companion.zip`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped folder containing `manifest.json`.
5. Reload the SIR Assist page that was already open.

The companion requires Chrome 111 or later (or a compatible Chromium browser) for its narrow main-world content script.

SIR Assist should now show **Browser companion connected**. If it does not, confirm that the extension is enabled, reload the SIR Assist tab, and use **Check connection again**.

The production manifest runs content scripts only on the deployed SIR Assist origin and `https://electoralsearch.eci.gov.in/`. It does not request cookies, browsing history, web-request interception, debugger access, or access to unrelated sites.

Requested Chrome permissions:

- `tabs`: open and close the one ECI tab used for an approved attempt;
- `storage`: keep short-lived case state in `chrome.storage.session` only;
- `alarms`: expire and clean up abandoned cases;
- ECI host access: fill the official form, relay its CAPTCHA image unchanged, and read the minimized result table;
- SIR Assist page access: exchange strictly validated messages with the web app.

## Flow

1. SIR Assist displays a user-approved queue capped at eighteen name/relative/birth-detail combinations.
2. For each attempt, SIR Assist sends one voter-name spelling, one relative-name spelling and exactly one DOB or age criterion to the extension.
3. The extension opens a background ECI tab, fills the official Search by Details form, and verifies that ECI retained the selected fields.
4. Only after that verification, the official CAPTCHA image is relayed to SIR Assist without interpretation. If the image is unreadable, SIR Assist can ask the companion to click ECI's own CAPTCHA-refresh control and relay the fresh image; the companion never requests a challenge from the gateway itself.
5. The user types the answer in SIR Assist; the extension submits it once to the same ECI tab.
6. The extension returns minimized candidates, closes the ECI tab, and SIR Assist offers the next approved attempt with a fresh CAPTCHA.

After the human authorizes step 5, a document-start script in ECI's page context observes the one official encrypted search request. It uses the page's existing `fetch` and `XMLHttpRequest` calls; it does not replay, alter, decrypt, or proxy them. The observer is dormant before submission, accepts only the exact `POST` to `https://gateway-voters.eci.gov.in/api/v1/elastic/search-by-details-from-state-display-v1`, and disarms after its first matching response.

Only bounded, value-free diagnostics cross the extension bridge: transport, method, exact origin and path, query-key names, HTTP status, and encrypted-envelope key names. Response metadata arrays are required to remain empty; the observer never reads a response body. Headers, sizes, query values, names, relatives, DOB or age values, CAPTCHA data or answers, request bodies, and response bodies never cross the observer event. Diagnostics remain transient and are discarded with the active attempt.

Version 1.5 adds the official CAPTCHA-refresh relay described above and keeps the one-submission-per-case rule unchanged. Version 1.4 classifies status 0, HTTP 429, other 4xx and 5xx failures separately. A 2xx response is not enough to record an empty search: the official page must expose a fresh `No Result Found` marker that stays structurally stable across repeated checks. A result table must likewise be fresh, stable and contain at least one row. When the ten-summary privacy limit is reached, the extension sends only a boolean limit flag—never a raw row count—so the app can warn the user to narrow the official search.

Transient case state uses `chrome.storage.session` for up to three minutes and is removed on completion, failure, cancellation, timeout, or tab closure. CAPTCHA answers are forwarded directly and are never stored.

## Building a public fork

Change the app origin in both `manifest.json` and `protocol.js`, then run `npm run package:extension` from the repository root. The resulting ZIP contains the complete extension source and GPL license. Keep permissions narrow and never add CAPTCHA-solving, proxy, debugger, cookie, browsing-history, or all-sites access.

## License

SIR Assist Browser Companion is licensed under `GPL-3.0-or-later`. The downloadable ZIP includes a `LICENSE` file containing the complete GNU GPLv3 text and the preferred source files for the extension.

Created and authored by **Suchayan Mitra**, with development assistance from **AI Copilot**. Copyright © 2026 Suchayan Mitra.
