# Security policy

## Reporting a vulnerability

Do not include real voter details, CAPTCHA images or answers, credentials, tokens, or private URLs in a public issue. Until a dedicated security contact is published, prepare a minimal reproduction using synthetic names and report it privately to the repository owner through the Git hosting provider's private vulnerability-reporting feature.

## Supported version

Security fixes are applied to the latest version on the default branch. Public forks and unpacked-extension builds are maintained by their respective operators.

## Security invariants

- A CAPTCHA is always displayed to and entered by a person.
- One CAPTCHA permits at most one official submission.
- Search queues are visible, user-selected, deduplicated, and capped at eighteen.
- The extension may access only the configured Matsetu origin and official ECI origin.
- No cookie, debugger, browsing-history, web-request interception, proxy, or all-sites permission is allowed.
- Official results remain minimized; sensitive voter fields are neither returned nor stored.
- Optional AI receives names and state only and never controls the official page.

Changes that weaken an invariant should not be merged.
