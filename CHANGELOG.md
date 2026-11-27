# Changelog

## Unreleased

## [0.0.2] - 2026-11-27

- Documentation: every file is annotated line by line and has a header; added `CONTRIBUTING.md`; README Development section; CLAUDE.md Gotchas and Related; `SECURITY.md` now says the package id is
  pinned (it has been since 0.0.1) and that the merchant object is not.
- `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, the workflows and Dependabot configuration carry comments. No behaviour change: the declarations and the source's compiled output are identical.

## 0.0.1 — 2026-11-17 (first npm release)

After the first pass of the security audit:

- The testnet package is `0x610cf31f…6af2` (fresh, immutable, with the platform fee). `pay<T>` takes its
  `PlatformConfig` (`SUI_PLATFORM_CONFIGS`, built in) as the first argument.
- `readPlatformFee(client, quote)` reads the rate and treasury from the chain and computes the fee, which is part of the
  quoted amount, not on top of it. It refuses any other object, a rate above the package's 1 % ceiling, or a missing field.
- A payment status `unapplied`: the transaction paid a checkout that was already paid or cancelled; the merchant credits
  or refunds it.
- The Chain Payments package ids are built in per network (`SUI_PACKAGES`). A method that names another package, or a
  network without a package in this release, is refused, so the service cannot choose the code the wallet calls.
- Chain names from the service are looked up as own keys only (`Object.hasOwn`), so `constructor` or `__proto__` never
  resolve to a prototype member.
- A payment status other than `pending`, `confirmed` or `rejected`, or a reply that is not a JSON object, is an error.
- Tests: the `pay<T>` call is checked argument by argument (values and Move order), not only by count.

First built 2026-11-16:

- First release: the session client (read, quote, submit, wait), on-demand chain modules, the Sui payment builder
  (`chain_payments::pay<T>` with `coinWithBalance`). A client-built transaction was executed on testnet
  (`AkJZej7Bto2iCcX26Ab4CTQaBaVzKKUzN3ywTfwBmLZw`).
