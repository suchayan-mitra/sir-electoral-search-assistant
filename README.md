# SIR Assist

**SIR Assist — Electoral Search Companion** is an independent, privacy-minded electoral-search assistant for Karnataka, West Bengal, and Odisha. It generates bounded spelling/transliteration variants and uses a local browser companion to complete a user-approved sequence of human-controlled searches on the official Election Commission of India (ECI) page.

Deployed beta: <https://sir-electoral-search-assistant.jukulda.workers.dev>

SIR Assist is not affiliated with, endorsed by, or operated by ECI. Its minimized summaries are not authoritative voter records.

## Working flow

1. The web app collects state, name, one or more relative names, exact DOB and/or age alternatives, gender, and optional district.
2. It generates bounded variants and builds a visible queue of at most eighteen unique name/relative/birth-detail combinations selected by the user.
3. The installed SIR Assist Browser Companion opens the official ECI page and fills the first planned query.
4. The extension relays the official CAPTCHA image without interpreting it; the user types it and the extension submits once.
5. After submission, the companion observes whether the official protected search `POST` completed and reports only sanitized network metadata: endpoint, method, HTTP status, and encrypted-envelope key names.
6. SIR Assist records the attempt, aggregates and deduplicates minimized candidates, then offers the next approved spelling.
7. Every additional combination starts a fresh official case with a new human CAPTCHA.

The extension never uses OCR, an LLM, a CAPTCHA-solving service, proxying, header evasion, or protected gateway replay.

## Optional AI variant generation

Deterministic variants remain the default. With explicit UI opt-in, `POST /api/variants` sends only state, voter name and entered relative names to the SIR Assist Worker&apos;s Cloudflare Workers AI binding using `@cf/moonshotai/kimi-k2.6`. DOB, ages, gender, district, ECI results and CAPTCHA data are rejected from this boundary. Output is strict JSON, sanitized, grouped under opaque IDs for each relative identity, merged with deterministic variants and hard-capped. The server assigns provenance labels; AI suggestions are unchecked until the user explicitly selects them. The LLM never drives the official page or interprets a CAPTCHA. The legacy `/api/search` cloud-browser route returns HTTP 410 and cannot start Browser Run.

## Install the companion

The companion is required for the official-search and CAPTCHA steps. ECI's search runs on its protected webpage with a human challenge; SIR Assist does not proxy that search through its server. The extension therefore opens ECI in the user's normal browser, fills exactly one approved attempt, relays the official CAPTCHA for human entry, and returns only a minimized possible-match summary.

Download `sir-assist-browser-companion.zip` from the app, unzip it, then load the folder through Chrome or Edge's **Load unpacked** developer-mode action. Reload any SIR Assist tab that was already open after installation. See [`extension/README.md`](extension/README.md) for first-run instructions, requested permissions, and troubleshooting.

The unpacked-extension step is for the MVP. A Chrome Web Store release is the appropriate distribution path before broad public use.

## Local development and verification

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run lint
```

`npm run build` deterministically rebuilds the downloadable extension ZIP from an explicit allowlist and includes the complete GPL license. Generated builds, Cloudflare state, screenshots and environment files are not committed.

The production extension is restricted to the deployed SIR Assist origin and the official ECI origin. Automated tests do not solve or submit a CAPTCHA. A live end-to-end test requires installing the extension and a person entering the current official challenge.

## Architecture

```text
SIR Assist web UI on Cloudflare
  -> optional name-only Kimi variant endpoint (explicit opt-in)
  -> local extension bridge
  -> extension background worker (short-lived chrome.storage.session state)
  -> official ECI tab in the user's browser
  <- official CAPTCHA image
  -> human-entered CAPTCHA, one submission
  <- sanitized official POST metadata (local only)
  <- minimized candidate summaries
```

- **Cloudflare Worker:** renders the UI, serves assets, and exposes the opt-in, name-only `/api/variants` Workers AI boundary.
- **Variant generator:** deterministic logic in `lib/variants.mjs`, optionally augmented by sanitized Kimi suggestions.
- **Extension transport:** strict same-page message validation in `lib/client/extension-transport.ts`.
- **Browser companion:** Manifest V3 code in `extension/`, restricted to the exact SIR Assist and ECI origins. A main-world observer is armed only for the human-authorized submission and reports the endpoint, method, status, and encrypted-envelope key names; it does not read the response body or expose request values.
- **Storage:** transient `chrome.storage.session` state only; CAPTCHA answers are never stored.

The current protected request contract and the reason a successful network response is required before recording zero matches are documented in [`docs/eci-search-contract.md`](docs/eci-search-contract.md).

## Privacy and safety guardrails

- Never interpret or automatically solve a CAPTCHA.
- Accept exactly one official submission per CAPTCHA-backed case.
- Show and cap the approved combination queue at eighteen; never run an unbounded Cartesian search.
- Never log or persist names, relatives, dates of birth, CAPTCHA images/answers, or raw results.
- Observe only the exact official details-search endpoint after submission, and relay only method, status, and encrypted-envelope key names locally to the app.
- Return only display name, age band, district, constituency, and fixed match reasons.
- Omit EPIC number, address, polling station, part/serial details, email, and export.
- Clear transient state on completion, failure, cancellation, timeout, or tab closure.

## Cloudflare deployment

```bash
npm run build
npx wrangler deploy --config dist/server/wrangler.json
```

The extension search does not use Browser Run or Durable Objects. The existing `BrowserSession` class and bindings remain in the Worker only as dormant, non-destructive compatibility resources from the initial deployment; `/api/search` is disabled and cannot invoke them.

Deploy SIR Assist only as the `sir-electoral-search-assistant` Worker. The previous project-named Worker is a preserved legacy deployment; do not overwrite or delete it during this rename.

Public forks must replace the SIR Assist origin in both `extension/manifest.json` and `extension/protocol.js`, run `npm run package:extension`, and deploy under their own Cloudflare account and Worker name. Never reuse another project's Worker, route, domain, Durable Object, or AI rate-limit namespace.

## Public-source policy

- Read [PRIVACY.md](PRIVACY.md) before changing data flows or candidate fields.
- Report security concerns using [SECURITY.md](SECURITY.md), not a public issue containing personal data.
- Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md).
- The bundled `public/og.png` social card is project artwork distributed under the same GPL terms as this repository.

## License

SIR Assist is free software licensed under the **GNU General Public License, version 3 or any later version** (`GPL-3.0-or-later`). See [LICENSE](LICENSE). Third-party components retain their respective licenses.

## Author and copyright

SIR Assist was created and authored by **Suchayan Mitra**, with development assistance from **AI Copilot**.

Copyright © 2026 Suchayan Mitra. See [AUTHORS.md](AUTHORS.md) and [NOTICE](NOTICE).
