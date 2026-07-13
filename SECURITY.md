# Security policy

## Reporting a vulnerability

Do not include real voter details, CAPTCHA images or answers, credentials, tokens, or private URLs in a public issue. Until a dedicated security contact is published, prepare a minimal reproduction using synthetic names and report it privately to the repository owner through the Git hosting provider's private vulnerability-reporting feature.

## Supported version

Security fixes are applied to the latest version on the default branch. Public forks and unpacked-extension builds are maintained by their respective operators.

## Security invariants

- A CAPTCHA is always displayed to and entered by a person.
- One CAPTCHA permits at most one official submission.
- Search queues are visible, user-selected, deduplicated, and capped at eighteen.
- The extension may access only the configured SIR Assist origin and official ECI origin.
- No cookie, debugger, browsing-history, `webRequest`, proxy, or all-sites permission is allowed.
- The local observer may run only for the human-authorized submission, must match the exact official search endpoint and encrypted request envelope, and may relay only method, status, and envelope key names. It must not read the response body.
- Official results remain minimized; sensitive voter fields are neither returned nor stored.
- Optional AI receives names and state only and never controls the official page.

Changes that weaken an invariant should not be merged.
