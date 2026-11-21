# Security Audit — `chain-payments-client`

**Classification:** Internal security review (first pass, awaiting external review)
**Project:** chain-payments-client  (`@meddleware/chain-payments-client`: the checkout side of Chain Payments — a session
  client for the public API (read, quote, submit, follow) and per-chain payment builders loaded on demand; `./sui` builds
  the `chain_payments::pay<T>` transaction)
**Project type:** TS SDK (npm package)
**Template:** AUDIT_TEMPLATE.md (2026-11-01) + AUDIT_TEMPLATE_TS.md (2026-11-01) + AUDIT_TEMPLATE_SUI_CLIENT.md (2026-10-08)
  - **Added 2026-11-21 (Part B documentation pass):** AUDIT_TEMPLATE_DOCS.md (2026-11-20); AUDIT_TEMPLATE_RFC.md (2026-11-19), partial: URLs, HTTP semantics, JSON and the Move
    argument encodings; AUDIT_TEMPLATE_IOP.md (2026-11-19), partial: public API, versioning, the service dependency; AUDIT_TEMPLATE_PRIV.md (2026-11-20), partial: nothing is
    stored, one origin is called.
**Deployment status:** *(Current, 2026-11-21: npm **`0.0.1` is `latest`** (published 2026-11-17; tag `v0.0.1` = `52c35c8`); one commit since the tag, `ecea4ef` (the interoperability page), nothing under
  `src/`. The tarball is 11 files, 26.9 kB unpacked, 8.5 kB packed (`npm pack --dry-run`). Two packages depend on it: `chain-payments-kit` (peer `^0.0.1`, dev `0.0.1`) and `link-in-bio-ui` (`^0.0.1`).
  One Dependabot pull request is open (#1, vitest 5.0.5 → 5.1.0).)* Was, at the first pass (2026-11-17): unpublished (`package.json` 0.0.1; no tag; `npm view` found nothing). A client-built transaction
  was executed on testnet on 2026-11-16 (`AkJZej7Bto2iCcX26Ab4CTQaBaVzKKUzN3ywTfwBmLZw`, CHANGELOG).
**Review date:** 2026-11-17
**Reviewer:** Internal review
**Severity ceiling:** Medium — the SDK builds the transaction a buyer signs, but the Move package re-verifies every field
  against the service's signature and takes only the quoted amount. A builder flaw can make a payment fail or go to
  whatever package or merchant the service names. It cannot overpay a correct quote. Realised ceiling at this pass:
  **Low**.
**Status:** first-pass baseline; documentation pass 2026-11-21 (below)

**Front matter (DOCS, RFC, IOP and PRIV lenses, added 2026-11-21):**

| Field | Value |
| --- | --- |
| Documentation status | ledger (workspace `docs/audit/DOCS_LEDGER.tsv`): 23 tracked files, 20 done (19 measured against the thresholds), 3 excluded (the lockfile, `LICENSE`, the generated `docs/INTEROP.md`), 0 pending, 0 fu (2026-11-21 pass) |
| Required documents | README, CHANGELOG, SECURITY, CONTRIBUTING (added 2026-11-21), LICENSE (0BSD), CLAUDE.md, AGENTS.md: all present |
| Doc lints | `check-docs.mjs` (workspace) is the gate. The shared `eslint-plugin-jsdoc` fragment is switched on here after the Phase 5 release of `@meddleware/eslint-config` |
| Standards spoken | URL syntax (RFC 3986) and HTTPS — keeps only the origin of `baseUrl`, https required (loopback excepted), the digest percent-encoded into its path; HTTP semantics (RFC 9110) and the Fetch API (WHATWG) — a non-2xx reply is an error, no credentials, no cache; JSON (RFC 8259) — every reply must be an object; Ed25519 (RFC 8032) — the quote's signature is passed through as bytes and verified by the Move package, not here; base 16 and UTF-8 (RFC 4648, RFC 3629) — the signature and the identifiers; BCS (through `@mysten/sui`'s `tx.pure`) — the `pay<T>` arguments; SPDX `0BSD`, Sigstore / SLSA — as the other packages |
| Deviations | none |
| Drafts relied on | none. Open Payments (GNAP with RFC 9421 signatures) is planned, FU-0119 |
| Data a person can take away | none held: the package builds a transaction from what it is given |
| Personal data | none held; the addresses and ids it handles are public chain data, and nothing is stored |

**Package manager / lockfile:** npm; `package-lock.json` committed
**Module format:** ESM (`"type": "module"`)
**Publish model:** ships TS source (`default: ./src/*.ts`) with `.d.ts` declarations (`types: ./dist/*.d.ts`), as
  walrus-storage-client does
**Runtime targets:** browser (the kit), Node ≥ 22 for tests
**Peer dependencies:** `@mysten/sui ^2.35.0` (optional: only `./sui` needs it)
**Sui SDK:** `@mysten/sui` 2.39.1 (dev); peer `^2.35.0`, within the ADR-0001 baseline `^2.33.1`; `npm ls` shows one copy
**Transport:** none to the chain. The SDK builds a `Transaction`; the host's wallet resolves and executes it. HTTP goes
  to the Chain Payments public API only.
**Networks:** whatever network the service's method names (testnet today)
**On-chain packages consumed:** *(Current, 2026-11-21, F12:)* the `chain_payments` package and its `PlatformConfig` per network, **built into the release** (`SUI_PACKAGES`,
  `SUI_PLATFORM_CONFIGS` in `src/sui.ts`; testnet only), and the merchant object **from the service's quote** (`quote.method.merchantObject`, not pinned); `0x6` (Clock), hardcoded. Was, at
  the first pass: package and merchant both from the service's quote (F4).

---

## Executive summary

The SDK is small: `src/index.ts` (session client, chain registry) and `src/sui.ts` (one builder). The builder mirrors
`pay<T>` argument for argument:

- every u64 is validated as a decimal of at most 20 digits and below 2⁶⁴, and handled as a `bigint`;
- identifiers go in as UTF-8 bytes, which matches the service (they are ASCII hex);
- the signature must be hex;
- the coin type and object ids must have the right shape;
- an expired quote or a zero amount is refused before building;
- the coin is `coinWithBalance` of exactly the quoted amount, and the package returns any change.

The HTTP client:

- refuses non-https origins (except localhost);
- puts a 15 s timeout on every call;
- sends no credentials and caches nothing;
- caps replies at 64 KiB;
- checks that a quote matches the session and method it asked for.

**This pass fixed inline (7 tests pass):**

- **F1:** chain names from the service resolved against `Object.prototype` (`constructor`, `toString` …).
- **F2:** an unknown payment status, or a reply that is not a JSON object, was passed on as an answer.
- **F3:** the builder's test counted the `pay` arguments but checked neither their values nor their order. It now decodes
  every argument.
- **F5:** `SECURITY.md` gained its required sections.

**Open:** F4 (Low) — the package id and the merchant object are whatever the service says. A deployments export and a
check belong in the SDK before mainnet (FU-0123).

**Dispositions (11 findings):** RESOLVED 4 · ADJUDICATED 2 · DEFERRED 1 · Positive 4.
**Counts by severity:** Low 5 · Info 2 · Positive 4.

**Posture:** a careful, minimal builder with on-chain re-verification behind it. The one structural gap is that it trusts
the service for on-chain ids.

**Update 2026-11-21 (documentation pass, F12):** the gap is half closed. Release 0.0.1 built the package id and `PlatformConfig` per network into the client and refuses a method that names another
package or a network without one (F4's package part, FU-0123 done 2026-11-17; OQ1). The merchant object is still the service's. There are 9 tests (7 at the first pass), and the package is on npm (F10).
The dispositions are now: RESOLVED 7 · ADJUDICATED 1 · DEFERRED 0 · Positive 4 (12 findings); Low 6 · Info 2 · Positive 4.

## Threat model / trust boundaries

| Actor | Controls | Can do | Bounded by |
| --- | --- | --- | --- |
| Chain Payments service (the `baseUrl` origin) | sessions, quotes, method descriptions (package id, merchant object, coin type, decimals), payment status | choose what the buyer is asked to sign | https; the Move package's signature check (only a quote the merchant's key signed pays); package id and merchant not pinned (F4) |
| Buyer's wallet | signing and execution | sign or refuse; resolve the coin | the wallet shows the transaction; the kit shows the amount and network |
| Host application (the kit or another checkout) | `baseUrl`, the injected `fetch` | point the SDK anywhere | https-only `baseUrl` (localhost excepted) |
| Network attacker | — | — | TLS |
| Dependency authors | `@mysten/sui` | everything in the PTB | lockfile; peer dependency; `npm audit` gate |

### Supply chain & input matrix (TS lens)

| Actor / source | Controls | Bounded by |
| --- | --- | --- |
| Dependency authors | install, build and runtime code | lockfile; no install scripts in the package; `npm audit --audit-level=high` in CI and in publish |
| Registry | the tarball | lockfile integrity; provenance on publish |
| CI runner | build, publish | base §B.2 (OIDC trusted publishing) |
| Service replies | every parsed field | object check, size cap, status allowlist, builder validation (F2, F6) |
| Embedding host | globals | no global side effects (`sideEffects: false`) |

### On-chain dependency matrix (SC lens)

| Object / package | ID (testnet) | Sourced from | Used as | If stale, wrong or attacker-supplied | Fails |
| --- | --- | --- | --- | --- | --- |
| `chain_payments` package | `0x5f67…bc14` | service (`quote.method.packageId`) | call target | a wrong package receives the coin (F4) | open, to the service's choice |
| Merchant object | `0x29d6…63f8` | service (`merchantObject`) | first argument of `pay` | a different merchant with a different key would refuse the quote; a merchant whose key the service also controls would not | closed for a forged quote; open to the service |
| Coin type | `0x2::sui::SUI`, native USDC | service | type argument and `coinWithBalance` type | the wrong coin is refused on-chain (not accepted, or the signature differs) | closed |
| Clock | `0x6` | hardcoded | last argument | — | — |

## Severity scale

Critical / High / Medium / Low / Info / Positive.

## Scope

**In scope (`main` = `fe598f5` plus this pass's changes):** `src/{index,sui,types}.ts`, `tests/client.test.ts`,
`package.json`, `package-lock.json`, `tsconfig*.json`, `eslint.config.ts`, `vitest.config.ts`,
`.github/workflows/{node-ci,npm-publish}.yml`, `.github/dependabot.yml`, `SECURITY.md`, `README.md`, `CHANGELOG.md`.

**Cross-repo evidence (read-only):** `chain-payments-sui/sources/chain_payments.move::pay` (the ABI);
`chain-payments-service/crates/service/src/{app,api}.rs` (the reply shapes); `chain-payments-kit/src/ChainCheckout.vue`
(the only consumer).

**Environment / commands (2026-11-17):**

| Command | Result |
| --- | --- |
| `npx vitest run` | **7 passed** (4 before this pass) |
| `npm run type-check` | clean (`strict`, `noUncheckedIndexedAccess`) |
| `npm run lint` | clean |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm ls @mysten/sui` | one copy, 2.39.1 |

## Findings

### F1 — Chain names from the service could resolve to prototype members

**Severity:** Low   **Disposition:** RESOLVED
**Where:** `src/index.ts::{loadChain, supported}` (`CHAINS[chain]`, `m.chain in CHAINS`).
**Issue:** `chain` comes from the service's method list. `'constructor' in CHAINS`, `'toString' in CHAINS` and
`'__proto__' in CHAINS` are all true. `loadChain('constructor')` called `Object()`, so a method was shown as payable and
"loaded" a non-module (TS lens §A *Caller-keyed lookups*).
**Impact:** A confusing failure only: the kit would offer a coin it cannot pay with, and building would throw.
**Remediation / evidence:** Lookups use `Object.hasOwn(CHAINS, chain)`. The test `loads only supported chains` checks
`constructor`, `__proto__`, `toString` and `hasOwnProperty`.

### F2 — Unknown payment statuses and non-object replies were passed on

**Severity:** Low   **Disposition:** RESOLVED
**Where:** `src/index.ts::{call, submitPayment, paymentStatus}`.
**Issue:** `JSON.parse(text) as Record<string, unknown>` and `.status` were returned as `PaymentStatus` unchecked. A reply of
`null` or an array threw a `TypeError` on `.error`. A status such as `"paid"` ended `waitForPayment` as if it were final.
**Impact:** A checkout could show an outcome the service never gave. This is the TS-M2 runtime-validation rule on the one
field that decides "paid" in the UI.
**Remediation / evidence:** Every reply must be a JSON object. `paymentStatus` accepts only `pending`, `confirmed` or
`rejected` and otherwise throws `ChainPaymentsError`. Test: `never reads an unknown payment status, or a reply that is not
an object, as an answer`.

### F3 — The builder's test did not check argument values or order

**Severity:** Low   **Disposition:** RESOLVED
**Where:** `tests/client.test.ts` (`toHaveLength(11)`).
**Issue:** SC lens §A *ABI mirroring*: "a test asserting the target **and** the argument values and order (not only
argument counts)". Swapping `units` and `periodMs`, or `session` and `nonce`, would have passed.
**Remediation / evidence:** The new test `passes every argument of pay<T> in the Move order, with the quote values` decodes
each input:

- the merchant object;
- session, reference and nonce as UTF-8 bytes;
- amount, units, `period_ms` and `expires_ms` as u64;
- the 64-byte signature;
- the coin from `coinWithBalance` (not a raw input);
- Clock `0x6`.

It also checks the package. The order is that of `chain_payments::pay<T>`.

### F4 — The package id and the merchant object come from the service, unpinned

**Severity:** Low   **Disposition:** RESOLVED for the package id (0.0.1, 2026-11-17, FU-0123 done); the merchant object is still the service's (see the update at the end of this finding)
**Where:** `src/sui.ts::buildPayTransaction` (`quote.method.packageId`, `merchantObject`).
**Issue:** SC lens §A *Package-ID semantics* and ADR-0001: the domain client should carry the package's ids (a `deployments`
export traced to `chain-payments-sui/deployments.json`). Here they come from the same origin that signs the quote.
**Impact:** A compromised service, or a host misconfigured to a hostile `baseUrl`, could name its own package or merchant
and have the buyer pay it the quoted amount. Prices are already the service's, so this adds the destination, not the
amount. Today the quote must still be signed by a key that merchant trusts, and the service holds the only real one.
**Remediation / evidence:**

- Generate `src/deployments.ts` from `chain-payments-sui/deployments.json` (published-at and original-id per network).
- Have `buildPayTransaction` refuse a quote whose `(network, packageId)` is not the latest published-at for that network,
  unless the caller passes an explicit `allowPackageIds` (self-hosted operators, localnet).
- Let the host pass `expectedMerchant` to check `merchantObject`.
- Add the published-at / original-id split together with the service's (FU-0123).
- Until then, `SECURITY.md` tells hosts to compare `merchantObject`.

**Update 2026-11-21 (verified against `src/sui.ts` and `tests/client.test.ts`):** release 0.0.1 built the ids into the client instead of generating a `deployments` file: `SUI_PACKAGES` and
`SUI_PLATFORM_CONFIGS` hold the testnet package and its `PlatformConfig`, `buildPayTransaction` refuses a method whose `packageId` is not this release's (leading zeros ignored) or whose network has no entry
(looked up by own key), and the test `refuses expired, malformed and foreign quotes` covers a foreign package, an unknown network and `constructor`. The maintainer decided against an `allowPackageIds`
option (OQ1). `expectedMerchant` was not added: the merchant object remains the service's, and `SECURITY.md` (corrected in this pass, F12) says so. The Move package's signature check bounds what a
hostile service can do with it, as in the threat model above.

### F5 — `SECURITY.md` lacked the required sections

**Severity:** Low   **Disposition:** RESOLVED
**Where:** `SECURITY.md`.
**Issue:** One paragraph: no Scope, Supported versions or Disclosure. It said the SDK "validates every field", but replies
other than quotes were not validated (F2).
**Remediation / evidence:** Rewritten with the five sections and an accurate model: what is checked, what the service is
trusted for (F4), and that nothing is cached.

### F6 — Value encoding and the exact coin

**Severity:** Positive
**Where:** `src/sui.ts`.

- `u64()` accepts only `^[0-9]{1,20}$` and `≤ 2⁶⁴ − 1`, so it never wraps. Amounts stay `bigint` into `tx.pure.u64`.
- An expired quote (`expiresMs ≤ now`) and a zero amount are refused.
- The coin type must match `0x<hex>::<ident>::<ident>`, and object ids `0x<1–64 hex>`.
- The signature must be even-length lowercase hex.
- Identifiers are UTF-8 encoded, exactly as the service signs them (ASCII).
- `coinWithBalance({type, balance: amount})` draws exactly the quoted amount (from the gas coin for SUI), and nothing else
  is transferred. The package returns any change in the same transaction.

### F7 — Network I/O

**Severity:** Positive
**Where:** `src/index.ts::{createSessionClient, call}`.

- The origin is parsed with `new URL`; non-https origins are refused, except `localhost` and `127.0.0.1`.
- Every request has a 15 s `AbortController` timeout, `credentials: 'omit'` and `cache: 'no-store'`.
- Paths are built from validated parts: the session id `^[0-9a-f]{32}$`, the digest `encodeURIComponent`, and the method id
  in the JSON body.
- `requestQuote` refuses a quote for another session or method.

### F8 — The reply size is checked after the body is read

**Severity:** Info   **Disposition:** ADJUDICATED
**Where:** `call` (`await r.text()`, then `text.length > 64 KiB`).
**Issue:** TS lens: check size before parsing. That holds (the check comes before `JSON.parse`), but the whole body is read
into memory first.
**Impact:** None that matters in a browser talking to its own payment service over TLS. A streamed cap would add code for no
real gain.

### F9 — Packaging and supply-chain gates

**Severity:** Positive
**Where:** `package.json` (`files: [src, dist, CHANGELOG.md, SECURITY.md]`, `sideEffects: false`, no lifecycle scripts except
`prepublishOnly: build`); `.github/workflows/node-ci.yml` (`npm ci`, `npm ls --all`, `npm audit --audit-level=high`,
type-check, lint, test, build, and a tarball assertion that fails on any file outside the whitelist);
`npm-publish.yml` (verify = `node-ci.yml`, OIDC trusted publishing with `--provenance`, npm pinned to 11.20.0, tag-gated,
idempotent check against the registry); `.github/dependabot.yml` (npm, Actions).
B.TS-2 install-time code: `prepublishOnly` (build declarations) only; no `overrides`.

### F10 — Not yet on npm

**Severity:** Info   **Disposition:** RESOLVED (published 2026-11-17: `0.0.1` is `latest`; FU-0129 covers the kit's CI)
**Where:** npm registry.
**Issue:** The kit depends on it through `file:../chain-payments-client` until the first publish (kit audit F5).
**Impact:** None for buyers. The kit's CI cannot install on a clean runner until 0.0.1 is published (FU-0129).

**Update 2026-11-21:** `npm view @meddleware/chain-payments-client dist-tags` gives `latest: 0.0.1`; the kit and `link-in-bio-ui` depend on it from the registry.

### F11 — Chain-access layering

**Severity:** Positive
**Where:** the package as a whole.
This package is the domain client for `chain_payments` (ADR-0001). The kit builds no transaction of its own and calls
`loadChain(...).buildPayment(quote)`. No JSON-RPC is used, and no chain reads are made at all: the service verifies.

### Part B documentation pass (2026-11-21)

Scope: every tracked file read against the workspace's `docs/operations/DOCUMENTATION_STANDARD.md` and annotated (Part B Phase 1, the fourteenth repository, the seventh of the clients); the DOCS, RFC,
IOP and PRIV lenses applied for the first time. Before and after editing: `npm ci`, type-check, lint, the 9 tests, the declaration build and `npm audit --audit-level=high` (exit 0) passed. The
diff is comment-only except the documents: the TypeScript compiles to identical output with comments removed, and the YAML, `.gitignore` and the JSON configurations parse alike. No defect was found
in the code.

### F12 — Documentation drift found by the documentation pass
**Severity:** Low   **Disposition:** RESOLVED (2026-11-21, unreleased)
**Where:** `SECURITY.md`, this audit, `README.md`, `CLAUDE.md`, `.github/workflows/npm-publish.yml`.
**Issue:** (1) `SECURITY.md` said "the SDK does not yet pin" the package id, although 0.0.1 pins it, and the audit still called F4 deferred, I4 a gap, SC-M1 not holding, the package unpublished (F10) and
the test count 7, and gave the old package id in B.SC-1 and an eleven-argument `pay<T>` (it takes twelve, since the `PlatformConfig`); (2) the README had no Development section and CLAUDE.md no Gotchas or
Related; (3) there was no `CONTRIBUTING.md`; (4) `npm-publish.yml`'s header listed a "deployment ids" step the CI workflow does not have; (5) the three source files had few doc comments.
**Impact:** none on the shipped code. A reader of the security policy was told a protection was missing that is in place, and the audit said the package was unpublished.
**Remediation / evidence:** the facts above are checked against `src/sui.ts`, the tests, npm and the consumers' manifests; the documents and the audit are corrected; every declaration is documented.
`npm audit --audit-level=high` exits 0 (2026-11-21).

## Section A — Invariant verification matrix

| # | Invariant | Enforced at | Proven by | Status |
| --- | --- | --- | --- | --- |
| I1 | ABI mirroring: `pay<T>` target, type argument, twelve arguments in Move order with the quote's values | `buildPayTransaction` | `passes every argument of pay<T> in the Move order…` (F3) | HOLDS |
| I2 | u64 values are `bigint`, range-checked, never wrapped | `u64()` | `refuses expired, malformed and foreign quotes` (`1e9`) | HOLDS |
| I3 | The coin is exactly the quoted amount; no other transfer | `coinWithBalance`; one `moveCall` | the argument test (coin from an intent), `builds one pay call…` | HOLDS |
| I4 | Call target and merchant traced to the canonical record | `SUI_PACKAGES`, `SUI_PLATFORM_CONFIGS`, `buildPayTransaction` | `refuses expired, malformed and foreign quotes` | HOLDS for the package and `PlatformConfig` (F4, 0.0.1); the merchant object is the service's (not pinned) |
| I5 | Network binding: ids, client and wallet chain from one network value | the method carries its network; the SDK selects no RPC | — | N/A (the SDK holds no RPC client; the kit shows the network and the host's wallet executes) |
| I6 | Untrusted replies validated before use: object shape, size, status allowlist, quote ↔ request match | `call`, `paymentStatus`, `requestQuote`; builder validation | F2 and F6 tests | HOLDS |
| I7 | Caller-keyed lookups use own keys | `isChain` (`Object.hasOwn`) | `loads only supported chains` (F1) | HOLDS |
| I8 | Every fetch has a timeout; URLs built from parsed parts; https only | `call`, `createSessionClient` | `refuses bad ids, mismatched quotes, plain http and errors` | HOLDS |
| I9 | No credentials sent, nothing cached | `credentials: 'omit'`, `cache: 'no-store'` | `reads, quotes and submits without credentials` | HOLDS |
| I10 | Execution result: success decided on-chain by the service, not by "a digest came back" | the kit treats only `confirmed` as paid | kit tests | HOLDS |

## Section B — Supply-chain, publish-authority & capability matrix

### B.1 Dependency & CVE risk

| Dependency | Pinned version | Liveness dependency? | CVE / audit status | Notes |
| --- | --- | --- | --- | --- |
| `@mysten/sui` | peer `^2.35.0` (optional); dev `^2.39.1` → 2.39.1 | `./sui` builder | `npm audit` clean | one copy (`npm ls`) |
| `typescript` / `vitest` / `eslint` | `~6.0.3` / `~5.0.2` / `^10.11.0` | build and test only | clean | — |
| The Chain Payments public API | `baseUrl` | everything: **closed** (a thrown `ChainPaymentsError`) | — | — |

**Shared-dependency version matrix (TS lens).**

| Repo | `@mysten/sui` | `vue` | `typescript` | `vitest` | Deviation from ADR-0001 |
| --- | --- | --- | --- | --- | --- |
| chain-payments-client | peer `^2.35.0` (opt.), dev `^2.39.1` | — | `~6.0.3` | `~5.0.2` | none (baseline `^2.33.1`) |
| chain-payments-kit | dev `^2.39.1` (through the client) | peer `^3.5.0`, dev `^3.5.44` | `~6.0.0` | `~5.1.0` | none |

### B.2 Publish authority

| Authority | Where | Custody | Gates | Rotation |
| --- | --- | --- | --- | --- |
| npm publish | `npm-publish.yml` | GitHub OIDC trusted publishing (no token) | `v*` tags | n/a |

#### CI & release integrity

Actions pinned by SHA · `permissions: contents: read`, with `id-token: write` only on the publish job · OIDC with provenance
· tag-gated and idempotent · the verify job is `node-ci.yml` (release gate = CI) · Dependabot npm and Actions · no secrets ·
no real-chain jobs · no test-only build modes (tests inject `fetch`). All hold.

### B.TS-1 Packaging

| Check | State |
| --- | --- |
| `exports` / `types` | `.` and `./sui`: TS source as `default`, declarations as `types` (the workspace's ships-source pattern) |
| `files` | whitelist; CI asserts the tarball holds only `src/`, `dist/`, `package.json`, `LICENSE`, `README.md`, `CHANGELOG.md`, `SECURITY.md` |
| `sideEffects` | `false`, accurate (no module has import-time effects) |
| Ships-source | consumers compile the TS (Vite in the kit); `tsc --noEmit` is strict in CI |

### B.TS-2 Install-time code

`prepublishOnly: npm run build` (declarations). No `preinstall`, `install`, `postinstall`, `prepare`, `overrides` or
`allowScripts`.

### B.TS-3 Supply-chain gates

`npm ci` in every workflow; `npm audit --audit-level=high` in CI and in publish (through the verify job); no allowlist
needed (0 findings).

### B.SC-1 ID-constant trace

| Location | Network | Value | original-id / published-at | Matches latest |
| --- | --- | --- | --- | --- |
| `src/sui.ts` | all | `0x6` (Clock) | system | Y |
| `src/sui.ts` (`SUI_PACKAGES`) | testnet | `0x610cf31f…6af2` | fresh, immutable package (version 1: published-at is the original id) | Y |
| `src/sui.ts` (`SUI_PLATFORM_CONFIGS`) | testnet | `0x7e3b9a5c…6106` | the package's shared `PlatformConfig` | Y |
| `tests/client.test.ts` | testnet | the package above, a test merchant `0xd92a3ce2…d5e5` | test data | Y |
| (none in `src/`) | — | the merchant object comes from the service | — | not pinned |

### B.SC-2 Coupling table

| Move function | Builder | Test asserting target + arguments |
| --- | --- | --- |
| `chain_payments::pay<T>(&PlatformConfig, &mut Merchant, vector<u8>, u64, u64, u64, vector<u8>, u64, vector<u8>, vector<u8>, Coin<T>, &Clock)` | `buildPayTransaction` | `passes every argument of pay<T> in the Move order, with the quote values` |

### B.SC-3 Cross-implementation parity

| Behaviour | Implementation A | Implementation B | Shared vector / test |
| --- | --- | --- | --- |
| `pay` call | this builder | `chain-payments-service/scripts/e2e-testnet.sh` (CLI PTB) | both executed on testnet (2026-11-16); no shared fixture |
| Identifier encoding | UTF-8 bytes here | UTF-8 bytes in the service's signer | the service's vectors (ASCII); no client-side vector (the client never builds the message) |

### B.DOCS-1 Ledger state

23 tracked files: 20 done (19 measured against the thresholds), 3 excluded (lockfile, licence text, generated `docs/INTEROP.md`), 0 pending, 0 `fu:` rows (2026-11-21, commit recorded in the ledger). Gate: `node scripts/check-docs.mjs --report chain-payments-client` gives 19 measured, 19 meeting the standard, header 100 %, declaration docs 100 %, comment ratio 0.57, no TODOs, no broken links.

### B.DOCS-2 Commands run

Every command in the README's Development section, CLAUDE.md's Commands section and CONTRIBUTING.md was run on 2026-11-21 and gave what the documents say: `npm ci`, `npm run type-check`,
`npm run lint`, `npm test` (9 tests), `npm run build`, `npm audit --audit-level=high` (exit 0) and `npm pack --dry-run` (11 files).

### B.DOCS-3 Generated documentation

`docs/INTEROP.md` is generated by the workspace's `scripts/interop/gen-interop.py` from `config/interop.yaml`. `dist/*.d.ts` is built by `npm run build` and not tracked.

### B.RFC-1 Standards inventory

| Interface | Standard (and version) | Role | Where | Conformance evidence | Deviation |
| --- | --- | --- | --- | --- | --- |
| Session API origin | URL syntax (RFC 3986), HTTPS | consumes | `createSessionClient` | `refuses bad ids, mismatched quotes, plain http and errors` | plain http only to a loopback host; only the origin of `baseUrl` is used |
| Requests and replies | HTTP semantics (RFC 9110), the Fetch API (WHATWG) | consumes | `call` | the fake-fetch tests (no credentials, status handling) | none |
| Reply bodies | JSON (RFC 8259) | consumes | `call` | `never reads an unknown payment status, or a reply that is not an object` | a body that is not an object is refused |
| Quote signature | Ed25519 (RFC 8032) | passes through; verified on chain, not here | `buildPayTransaction` (`hexBytes`) | the argument test | — |
| Transaction arguments | BCS (through `@mysten/sui`'s `tx.pure`), UTF-8 (RFC 3629), base 16 (RFC 4648) | produces | `src/sui.ts` | `passes every argument of pay<T> in the Move order, with the quote values` | the signature must be lower-case hex |
| Provenance | Sigstore / SLSA (npm provenance) | consumes | `npm-publish.yml` | `dist.attestations` on npm | — |

### B.IOP-1 Export and exit drill

Not applicable: the package holds no data. The contract it describes (the session API's routes and the `pay<T>` call) is published, and any other client can implement it: the Move function is public and
the quote's fields are in `src/types.ts`.

### B.IOP-2 Exit register entries

npm (publication) and GitHub Actions (CI). At run time the one dependency is the Chain Payments service the host points at (any origin that speaks the same API), and the Sui chain through the buyer's
wallet. The Move package `chain-payments-sui` is Meddleware's own and open (0BSD).

### B.IOP-3 API stability

The public API is everything exported from `src/index.ts` and `./sui`. Versioning is patch-only until mainnet (workspace policy), so a consumer's `^0.0.x` is an exact pin; a rename or removal is a
breaking change and is announced in `CHANGELOG.md`. A new Move package is a new client release (F4), made in the same wave as the kit and the service's method registry.

### B.PRIV-1 / B.PRIV-2 / B.PRIV-3 Privacy inventories

Personal data: none held. The client sends a session id, a method id, a nonce and a transaction digest to the one origin the host chooses, with no cookies or credentials and no caching; the addresses in a
quote are public chain data. Nothing is stored in a browser or on disk, and there is no analytics or logging. Recorded 2026-11-21.

## Section C — Test-coverage & hermetic/live split

### C.1 Coverage grade — B (9/9 vitest, 2026-11-21; 7/7 at the first pass)

| Dimension | Assessment |
| --- | --- |
| Happy path | read, quote, submit; builder target and every argument |
| Error paths | bad session id, mismatched quote, plain http, 404, unknown status, non-object reply, unsupported and prototype chain names |
| Boundaries | expired quote, zero amount, non-decimal amount, bad signature, foreign chain, malformed package id |
| Security-relevant | ABI order (F3); status allowlist (F2); own-key lookups (F1); no credentials |

Unit tests only. There are no env-gated integration tests: an ABI-drift test against the published package with
`GRPC_TESTNET=1` is a suggestion. There is no e2e test in this repository; the kit's gallery sweep runs the client.

### C.2 Hermetic vs live

| Path | Hermetic? | Deferred to | Tracking |
| --- | --- | --- | --- |
| Building the transaction | yes | — | — |
| Coin resolution (`coinWithBalance` for USDC) and execution | no (needs a wallet and a node) | testnet run 2026-11-16 (`AkJZej7B…LZw`, SUI) | USDC path: before mainnet |
| ABI drift against the published package | no | suggestion: normalized Move function read with `GRPC_TESTNET=1` | — |

## Section D — Deployment-readiness gates

### pre-localnet

- [x] strict type-check and lint green; no swallowed promises
- [x] untrusted parsers validate size, shape and the fields used (F2, F6)
- [x] every builder tested with target and arguments (F3)

### pre-testnet

- [x] `npm pack` contents asserted in CI; B.TS-2 inventory complete
- [x] shared-dependency matrix aligned with ADR-0001; audit gate in CI and publish
- [x] every test project runs in CI (one vitest project)
- [x] consumed ids traced to the canonical record: the package and `PlatformConfig` (F4, FU-0123 done); the merchant object is the service's (not pinned)
- [x] published on npm (F10; `0.0.1` is `latest` since 2026-11-17)

### pre-mainnet

- [x] every fetch has a timeout; no `btoa`/`atob`
- [x] no unjustified `any`, `as` or `!` at trust boundaries (the `as` casts follow the object check; the test's `!` is test-only)
- [ ] mainnet ids built into the release (F4): `SUI_PACKAGES` has no mainnet entry, so a mainnet method fails closed (`no Chain Payments package on Sui mainnet in this release`); the ids arrive with the mainnet release
- [ ] ABI-drift test against the mainnet package

## Cross-project themes

- **Supply chain & release integrity.** Lockfile committed, Actions pinned, OIDC with provenance, `npm audit` gate,
  Dependabot.
- **Wire-format coupling.** The SDK passes quote fields through. The message itself is pinned between the Move package and
  the service. The `pay` ABI is pinned here (F3).
- **On-chain-truth boundary.** The SDK decides nothing. "Confirmed" comes from the service's on-chain check, and amounts are
  the signed quote's.
- **Deployment readiness.** Section D.
- **Chain-access layering.** This package is the domain client (F11). Ids are not yet its own (F4).
- **Versioning.** First publish 0.0.1, with this pass's changes.

## Normative requirements (MUST / MUST NOT)

- SC-M1 — holds for the package and `PlatformConfig` (built in per network, F4, 2026-11-21); the merchant object is the service's.
- SC-M2 — n/a (the SDK reads no objects or events).
- SC-M3 — holds by delegation: only the service's `confirmed` counts.
- SC-M4 — holds (`bigint`; no address comparison).
- SC-M5 — n/a (no RPC client; the kit shows the network).
- SC-M6, M8, M9 — n/a.
- SC-M7 — n/a (the service binds digest-first).
- SC-M10 — holds (F11).
- TS-M1 — holds (`strict`, `noUncheckedIndexedAccess`).
- TS-M2 — holds for every field used (F2, F6).
- TS-M3 — holds.
- TS-M4 — holds (no empty catch).
- TS-M5 — holds (F7).
- TS-M6 — holds (errors carry the service's message or a fixed text, never a signature; no dynamic code).
- TS-M7 — holds (F9).
- TS-M8 — holds.
- TS-M9 — holds (`@mysten/sui` is a peer; declarations shipped).

**Lens baselines (DOCS, RFC, IOP, PRIV), first recorded 2026-11-21:**

| ID | Holds? | Evidence |
| --- | --- | --- |
| DOCS-M1 | yes (all seven documents; 0BSD; CHANGELOG with an Unreleased section) | B.DOCS-1 |
| DOCS-M2 | yes (every file's header and every declaration documented; ledger rows done) | `check-docs.mjs --report chain-payments-client` |
| DOCS-M3 | yes (the built-in ids, the unpinned merchant and the string amounts are in CLAUDE.md) | CLAUDE.md |
| DOCS-M4 | yes (commands run, links resolve, ids exist) | B.DOCS-2 |
| DOCS-M5 | yes (no TODO, FIXME, XXX or HACK) | `check-docs.mjs` |
| DOCS-M6 | yes (CLAUDE.md and SECURITY.md verified against the code, F12; AGENTS.md points to CLAUDE.md) | this pass |
| DOCS-M7 | yes (no secrets or private data; the ids in the code are public chain ids) | inspection |
| RFC-M1 to RFC-M7 | yes where they apply (B.RFC-1); M5 is the hosts', not a package's | B.RFC-1 |
| IOP-M3, IOP-M5 | yes (B.IOP-3; no data, no ads, no tracking); IOP-M1, M2, M4, M6, M7: not applicable (no data, no service) | B.IOP-1 to 3 |
| PRIV-M1 to PRIV-M8 | yes: nothing stored, nothing requested from any host but the host's own service | B.PRIV |

## Implementation suggestions (SHOULD / MAY)

- SHOULD add an env-gated ABI-drift test that compares `pay`'s normalized Move signature on testnet with the builder.
- SHOULD validate `getSession`'s reply shape too (status enum, `methods` array of objects), so the kit never renders an
  unexpected shape.
- MAY expose `expectedMerchant` on `buildPayTransaction` ahead of F4.

## Open questions (`OQ#`)

- **OQ1** — DECIDED 2026-11-17 (maintainer): no option to supply package ids. The ids are built into each release
  (`SUI_PACKAGES` in `src/sui.ts`), and a method naming another package is refused. A self-hosting developer can edit that
  table in their own fork; nothing configures it.

## Risks (residual)

- The service is trusted for the merchant object (the destination of the payment; the package id is pinned since 0.0.1), and for the price always (by design).
- Wallets: what the wallet displays and whether it executes on the network the quote is for. The kit shows the network;
  the host connects the wallet.
- `@mysten/sui`'s `coinWithBalance` resolution (third-party code on the signing path).

## Re-verification log

- 2026-11-17 — First pass at `fe598f5` plus this pass's changes:
  - read the source, tests, manifests and workflows;
  - 7/7 tests, type-check, lint, `npm audit` clean;
  - fixed F1, F2, F3 and F5 inline;
  - deferred F4 to FU-0123;
  - opened OQ1.
- 2026-11-21 — Part B documentation pass and first application of the DOCS, RFC, IOP and PRIV lenses (above, "Part B documentation pass"). Baseline before editing: `npm ci`, type-check, lint, 9 tests,
  the declaration build, `npm audit --audit-level=high`. Every tracked file annotated to the documentation standard (headers, doc comments on every declaration, a reason beside each statement group);
  `CONTRIBUTING.md` added; README Development section; CLAUDE.md Gotchas and Related; `SECURITY.md` corrected. Found and fixed **F12** (documentation drift). Re-verified F4 (package id pinned since 0.0.1:
  RESOLVED for the package, the merchant object remains the service's) and F10 (published: RESOLVED). Verified live: npm `0.0.1` latest; two consumers read from their manifests; Dependabot #1 open.
  No defect found in the code. Counts: F1 to F12.

## Pre-save consistency checklist (this pass)

- [x] Section A ↔ findings (I4 GAP → F4)
- [x] Finding header ↔ body
- [x] Template line
- [x] Closing structure in order
- [x] Open questions stay open
- [x] Section D ↔ dispositions
- [x] Executive summary matches the current dispositions
- [x] Counts re-measured (7 tests; one `@mysten/sui`)
- [x] Re-verification log entry
- [x] 2026-11-21: Template line cites DOCS, RFC, IOP and PRIV with their registry dates; their front-matter fields, Section B subsections and MUST rows added; F12 recorded in the findings and the log;
  F4, F10, I4, SC-M1, Section D, the deployment status, test counts and consumers current.
