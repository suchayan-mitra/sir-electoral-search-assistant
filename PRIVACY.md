# SIR Assist privacy boundary

SIR Assist — Electoral Search Companion is designed to help a person try a small, visible set of spelling and birth-detail combinations against the official ECI electoral-search page. It is not a voter-data repository.

## Data paths

- Choosing “Generate AI spelling variants” sends only the selected state, voter name, and entered relative names to the SIR Assist Cloudflare Worker and its Workers AI binding.
- Choosing “Use offline transliteration” sends no names to the Worker. The same generic, dictionary-free fallback is used when AI is unavailable or its output fails validation.
- DOB, age, gender, district, CAPTCHA data, ECI results, and search selections are rejected from the AI boundary.
- Official-search details pass locally from the SIR Assist page to the browser companion and the ECI tab. They are not sent through the SIR Assist Worker.
- Extension state uses `chrome.storage.session` and is deleted on completion, failure, cancellation, timeout, or tab closure.
- CAPTCHA answers are forwarded once to the active ECI tab and are never stored.
- Immediately before that one submission, the companion arms a local observer for the exact official details-search endpoint. It relays only the endpoint, method, HTTP status, and encrypted-envelope key names back to the SIR Assist tab. It does not read the response body or relay request values, headers, identifiers, or the CAPTCHA, and nothing from this observation is sent to the SIR Assist Worker or persisted.
- Candidate transport may include at most ten minimized summaries plus a bounded boolean stating that the ten-summary privacy threshold was reached. The uncapped/original official row count is not logged, persisted, or sent to the Worker.

## Result minimization

SIR Assist accepts and displays only:

- display name;
- age band;
- district;
- assembly constituency; and
- which approved search returned the candidate.

EPIC number, address, polling station, part or serial information, email, raw tables, downloads, and exports are intentionally excluded.

## Logs and retention

Application code must not log or persist voter names, relative names, dates of birth, ages, gender, district, CAPTCHA images or answers, official results, or extension messages. Infrastructure providers may maintain their own operational logs under their policies; public deployments should configure the minimum practical retention.

## Contributor rule

Any change that expands collection, transmission, storage, logging, result fields, host permissions, or AI inputs requires explicit documentation, focused tests, and security review before release.
