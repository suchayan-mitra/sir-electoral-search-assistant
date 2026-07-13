# SIR Assist privacy boundary

SIR Assist — Electoral Search Companion is designed to help a person try a small, visible set of spelling and birth-detail combinations against the official ECI electoral-search page. It is not a voter-data repository.

## Data paths

- Deterministic name variants are generated in the web app.
- Optional AI suggestions send only the selected state, voter name, and entered relative names to the SIR Assist Cloudflare Worker and its Workers AI binding.
- DOB, age, gender, district, CAPTCHA data, ECI results, and search selections are rejected from the AI boundary.
- Official-search details pass locally from the SIR Assist page to the browser companion and the ECI tab. They are not sent through the SIR Assist Worker.
- Extension state uses `chrome.storage.session` and is deleted on completion, failure, cancellation, timeout, or tab closure.
- CAPTCHA answers are forwarded once to the active ECI tab and are never stored.

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
