# Contributing to Matsetu

Thank you for helping improve Matsetu. Contributions must preserve the project's human-control, privacy, and public-service boundaries.

## Before opening a change

1. Use synthetic test identities; never commit real voter details, CAPTCHA material, credentials, Cloudflare state, or raw ECI responses.
2. Keep search attempts bounded and explicitly selected by the user.
3. Do not add CAPTCHA solving, OCR, evasion, proxying, protected API replay, or unbounded automation.
4. Do not expand extension host permissions or returned voter fields without a documented privacy and security review.
5. For a fork, replace both hard-coded Matsetu origins in the extension before packaging.

## Validate

```bash
npm install
npm test
npm run typecheck
npm run lint
```

Tests must not solve or submit a CAPTCHA. Live testing requires a person to enter the current official challenge.

## Licensing

By contributing, you agree that your contribution is licensed under `GPL-3.0-or-later`, consistent with the repository's [LICENSE](LICENSE).

Preserve the original `Copyright (C) 2026 Suchayan Mitra` and SPDX notices. Contributors retain credit for their own additions and may add themselves to [AUTHORS.md](AUTHORS.md) without removing the creator attribution.
