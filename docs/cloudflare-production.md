# Cloudflare deployment and browser-companion architecture

## Production deployment

- Worker: `sir-electoral-search-assistant`
- URL: <https://sir-electoral-search-assistant.jukulda.workers.dev>
- Routing: default isolated `workers.dev` URL only; no custom domain or zone route

Cloudflare serves the SIR Assist — Electoral Search Companion UI, extension archive, and static assets. The primary “Generate AI spelling variants” action sends only state and entered names to the Workers AI Kimi binding. The visible offline action sends no names to the Worker. DOB, ages, gender, district, electoral results and CAPTCHA data stay outside the AI endpoint. Cloudflare does not drive the official ECI page.

The previous project-named Worker is a preserved legacy deployment. Renaming to SIR Assist must not overwrite or delete that Worker, its routes, or any unrelated Cloudflare application.

## Request path

```text
SIR Assist page
  -> exact-origin content-script bridge
  -> Manifest V3 background worker
  -> temporary official ECI tab
  <- official CAPTCHA data image
  -> user-entered answer, forwarded once
  <- sanitized official search POST metadata
  <- minimized CandidateSummary[]
```

The extension keeps short-lived coordination state in `chrome.storage.session`. The answer is forwarded directly and is not added to the stored session. Immediately before the approved submission, a main-world observer is armed for the exact ECI details-search endpoint. It relays only endpoint, method, status, and encrypted-envelope key names to the app; it does not read the response body or relay request values. The official tab closes and state is cleared on completion, failure, cancellation, timeout, or tab closure.

## Why the architecture changed

On 2026-07-12, the ECI CAPTCHA endpoint returned HTTP 500 inside authenticated Cloudflare Browser Run while responding normally in a user browser. SIR Assist did not add proxying, header evasion, CAPTCHA solving, or protected gateway replay. Instead, the production search path moved to a local browser companion. The legacy Worker route is disabled with HTTP 410.

## Production configuration

The vinext build emits `dist/server/wrangler.json` with the Worker entry point and Static Assets directory. Browser Run and Durable Objects are not used by the extension-driven search path. Because the initial deployed Worker registered `BrowserSession`, its class and bindings are retained as dormant compatibility resources rather than issuing a destructive delete-class migration. The disabled `/api/search` route cannot invoke them.

```bash
npm run build
npm test
npm run typecheck
npm run lint
npx wrangler deploy --config dist/server/wrangler.json
```

Deploy only to the approved `sir-electoral-search-assistant` Worker. Do not overwrite or delete the preserved legacy Worker. Do not add custom domains, zone routes, DNS records, or modify unrelated Cloudflare applications without separate approval.

## Extension distribution

The SIR Assist Browser Companion archive is built from the allowlisted files in `extension/` and served as `/sir-assist-browser-companion.zip`. It requests only `alarms`, `storage`, and `tabs`, plus access to the official ECI origin. Its SIR Assist content script is restricted to the exact deployed Worker URL.

Before broad public use, publish a reviewed extension through an official browser store so users do not need developer mode. Store review should verify that the package contains no remote code, unrelated host access, CAPTCHA interpretation, browsing-history access, or result export.

## Release verification

1. Confirm the public UI and ZIP asset return HTTP 200.
2. Confirm `/api/search` returns HTTP 410 and cannot launch a cloud browser.
3. Confirm `/api/variants` rejects requests without the explicit AI-request flag or with extra fields, prioritizes validated AI output, and uses generic dictionary-free fallback on invalid model output.
4. Install the reviewed extension and reload the SIR Assist tab.
5. Verify the app reports the companion version.
6. Start a synthetic case and stop when the official CAPTCHA image appears in SIR Assist.
7. A human may enter the challenge for a real authorized search; tests must never solve it automatically.
8. Verify the app shows an observation of the expected official `POST` and HTTP status using sanitized local metadata, with no CAPTCHA or voter-detail values.
9. Verify completion returns only the approved minimized fields, closes the ECI tab, and allows the next queued spelling.
10. Confirm the visible plan never exceeds eighteen combinations and candidates are deduplicated across attempts.
