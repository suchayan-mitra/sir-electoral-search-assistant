# SIR Assist Browser Companion

This Manifest V3 extension runs one deterministic ECI search in the user's normal browser. It does not use an LLM, OCR, a CAPTCHA solver, proxy, or Cloudflare Browser Run.

## Why SIR Assist needs a browser companion

The official ECI search runs on ECI's webpage and requires a fresh CAPTCHA entered by a person. SIR Assist deliberately does not send voter-search details through its Worker. The companion provides the narrow local bridge needed to:

1. open the official ECI page in the user's browser;
2. fill one spelling and birth-detail combination the user approved;
3. show the untouched ECI CAPTCHA back in SIR Assist for the user to type; and
4. return only a minimized possible-match summary.

Cloudflare Workers AI is optional and can suggest name spellings in the web app. It never operates this extension, sees official-search details or results, or interprets a CAPTCHA.

## Install the development build

1. Download and unzip `sir-assist-browser-companion.zip`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped folder containing `manifest.json`.
5. Reload the SIR Assist page that was already open.

SIR Assist should now show **Browser companion connected**. If it does not, confirm that the extension is enabled, reload the SIR Assist tab, and use **Check connection again**.

The production manifest runs only on the deployed SIR Assist origin and `https://electoralsearch.eci.gov.in/`. It does not request cookies, browsing history, web-request interception, debugger access, or access to unrelated sites.

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
4. Only after that verification, the official CAPTCHA image is relayed to SIR Assist without interpretation.
5. The user types the answer in SIR Assist; the extension submits it once to the same ECI tab.
6. The extension returns minimized candidates, closes the ECI tab, and SIR Assist offers the next approved attempt with a fresh CAPTCHA.

Transient case state uses `chrome.storage.session` for up to three minutes and is removed on completion, failure, cancellation, timeout, or tab closure. CAPTCHA answers are forwarded directly and are never stored.

## Building a public fork

Change the app origin in both `manifest.json` and `protocol.js`, then run `npm run package:extension` from the repository root. The resulting ZIP contains the complete extension source and GPL license. Keep permissions narrow and never add CAPTCHA-solving, proxy, debugger, cookie, browsing-history, or all-sites access.

## License

SIR Assist Browser Companion is licensed under `GPL-3.0-or-later`. The downloadable ZIP includes a `LICENSE` file containing the complete GNU GPLv3 text and the preferred source files for the extension.

Created and authored by **Suchayan Mitra**, with development assistance from **AI Copilot**. Copyright © 2026 Suchayan Mitra.
