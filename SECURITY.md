# Security Policy

## Scope

`@meddleware/chain-payments-client`: the session client (`.`) and the Sui payment builder (`./sui`), from this repository's
`main` and its npm releases. Out of scope: the Chain Payments service, the Move package and the kit (their own policies),
wallets.

## Security model

- The SDK builds transactions from quotes the Chain Payments service signs; the Move package verifies the signature, so a
  tampered quote cannot pay a different amount, session or reference than the service signed.
- The Chain Payments package id is built into each release (`SUI_PACKAGES`), and the builder refuses a method that names another package or a network without one, so the service
  cannot choose the code the wallet calls. The merchant object is still the service's: the SDK does not pin it, so a host that knows its merchant object should compare it with
  `quote.method.merchantObject` before signing.
- The SDK checks every field it puts into the transaction (u64 ranges, hex, coin type and object id shapes, expiry), refuses
  replies that are not JSON objects or carry an unknown payment status, sends no credentials (`credentials: 'omit'`) and
  caches nothing. Every request has a timeout.

## Supported versions

The latest npm release. Older releases are not patched.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository. Please do not open a public issue. Expect an
acknowledgement within a week.

## Disclosure

Coordinated: a fixed release is published first; the report and the fix are then described in `CHANGELOG.md` and the
audit's re-verification log.
