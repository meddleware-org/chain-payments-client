# Changelog

## Unreleased (first pass of the security audit, 2026-11-17; ships in the first npm release, 0.0.1)

- The Chain Payments package ids are built in per network (`SUI_PACKAGES`). A method that names another package, or a
  network without a package in this release, is refused, so the service cannot choose the code the wallet calls.
- Chain names from the service are looked up as own keys only (`Object.hasOwn`), so `constructor` or `__proto__` never
  resolve to a prototype member.
- A payment status other than `pending`, `confirmed` or `rejected`, or a reply that is not a JSON object, is an error.
- Tests: the `pay<T>` call is checked argument by argument (values and Move order), not only by count.

## 0.0.1 — 2026-11-16

- First release: the session client (read, quote, submit, wait), on-demand chain modules, the Sui payment builder
  (`chain_payments::pay<T>` with `coinWithBalance`). A client-built transaction was executed on testnet
  (`AkJZej7Bto2iCcX26Ab4CTQaBaVzKKUzN3ywTfwBmLZw`).
