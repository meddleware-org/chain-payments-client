# Open standards and interoperability: chain-payments-client

TypeScript SDK for the checkout session API.

This page lists what the project speaks today, what is planned, what was considered and does not apply, where someone else can extend it, and what proves each claim. The platform-wide list is [Standards we use](https://meddleware.dev/platform/standards). A row appears there in the same change that turns a standard on.

## Spoken today

- A documented session API with signed quotes and webhooks (EdDSA, RFC 8032)

## Planned

- Open Payments (GNAP with RFC 9421 signatures)

## Considered, not applicable

- none

## Extension points

- The session API is the interface; the SDK is one implementation

## What proves it

- its unit tests

_Maintained centrally with the platform's interoperability map; changes go through it so every repository says the same thing._
