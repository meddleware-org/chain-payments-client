# Security Policy

## Scope

`@meddleware/chain-payments-client`: the session client (`.`) and the Sui payment builder (`./sui`), from this repository's
`main` and its npm releases. Out of scope: the Chain Payments service, the Move package and the kit (their own policies),
wallets.

## Security model

- The SDK builds transactions from quotes the Chain Payments service signs; the Move package verifies the signature, so a
  tampered quote cannot pay a different amount, session or reference than the service signed.
- The service is trusted for the quote's package id and merchant object: the SDK does not yet pin them (see the audit,
  FU-0123). A host that knows its merchant object should compare it with `quote.method.merchantObject` before signing.
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
