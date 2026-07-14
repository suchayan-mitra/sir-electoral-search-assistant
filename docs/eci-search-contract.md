# Official ECI search contract audit

This is a read-only interoperability note for the local SIR Assist browser companion. It is not a public API specification and must not be used to replay, bypass, or proxy the protected service.

Audit date: 2026-07-13

Official sources inspected:

- <https://electoralsearch.eci.gov.in/>
- <https://electoralsearch.eci.gov.in/static/js/main.63a3a33c.js>
- audited bundle SHA-256: `ad31686662e5d8b22680917e91418cdfd44b611898cd6719ea0bfb5cec3ae345`

## Browser flow

The official Search by Details page obtains a challenge with:

```text
GET https://gateway-voters.eci.gov.in/api/v1/captcha-service/getCaptcha/sir
```

After a person enters that challenge, the official client performs:

```text
POST https://gateway-voters.eci.gov.in/api/v1/elastic/search-by-details-from-state-display-v1
```

Before its request interceptor runs, the official form object contains state, name, relative name, exactly one selected birth mode, gender, optional district/assembly fields, CAPTCHA data, and a fixed security sentinel. One POST carries one exact age; trying ages 42 and 43 requires two separate user-approved searches and two fresh CAPTCHAs.

The official client encrypts that form object before transmission. The wire body is a JSON envelope with only these top-level keys:

```text
encryptedPayload
encryptedKey
iv
```

Consequently, a browser observer can verify the official URL, method, completion, and HTTP status, but it cannot validate the name or age from the transmitted body. SIR Assist verifies those values in the official form before enabling submission, then observes only sanitized metadata for the expected POST.

## Result handling caveat

The audited official frontend catches rejected requests, clears its result state, and may subsequently render `No Result Found`. DOM text alone therefore cannot reliably distinguish a valid zero-hit response from an incorrect/expired CAPTCHA or another failed request. SIR Assist requires an observed successful official POST plus a fresh, structurally stable result state before recording an attempt as completed. An empty outcome requires a fresh explicit `No Result Found` marker; a table outcome requires at least one fresh row. A pre-existing marker, empty table, non-2xx response, validation alert, or unstable render fails closed and is not counted as zero.

Status 0, HTTP 429, other 4xx and 5xx observations are reported as separate failure classes. This classification is diagnostic: because the observer intentionally does not read the response body, a semantically rejected request that returns HTTP 2xx can only be caught through the official page's visible validation state. “Official API call observed” must therefore not be presented as a server-side attestation.

## DOM compatibility controls

The audited bundle currently exposes the details form through `#detail`, `#stateID`, `#firstNameID`, `#relFirstNameID`, the named birth and gender controls, `.captcha-div`, and the labelled Search button. Inside `.captcha-div`, the official page also renders a `role="button"` control labelled `Captcha Refresh` (audited live on 2026-07-13); the companion clicks only that official control to obtain a replacement challenge and never calls the CAPTCHA service directly. Result observation uses `.globalSpinnerDiv`, `table#table-id`, an exact visible `No Result Found` heading, and visible Toastify or `role="alert"` validation messages. Header text—not CSS class names—selects the four approved table columns.

The 500 ms post-response delay is only a settling floor. After it expires, the companion still requires the same fresh visible table or no-result node to remain structurally unchanged for four consecutive 150 ms polls, and it waits up to 30 seconds in total. This reduces mid-render reads if the spinner changes, but it does not make undocumented selectors permanent. An unknown, hidden, stale, empty, or unstable state times out and fails closed rather than being recorded as zero.

## Privacy boundary

The companion must never relay or persist encrypted payload values, keys, IV values, headers, CAPTCHA data, voter identifiers, the uncapped/original official row count, or raw results. Its observation is restricted to the exact endpoint, method, HTTP status, and the three encrypted-envelope key names; it does not read the response body. The app receives that observation locally through the extension bridge; the SIR Assist Worker does not receive it. Result transport contains at most ten minimized candidate summaries plus a boolean stating that the ten-summary privacy threshold was reached.

Because the official frontend can change without notice, re-audit the current official bundle before modifying selectors, endpoint validation, or response classification.
