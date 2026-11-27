# CLAUDE.md — chain-payments-client

The TypeScript SDK of Chain Payments (checkout side): the session client and one module per chain that builds the payment
transaction for a quote. Apps never build payment transactions themselves (ADR-0001 in the operator's workspace); they
call `loadChain(method.chain)` and hand the result to their wallet.

## Invariants

- **No secrets, no credentials.** The session API needs none; every request is `credentials: 'omit'`, `no-store`.
- **Exact amounts.** u64 values travel as strings and are checked (`^[0-9]{1,20}$`, ≤ 2^64−1); numbers above 2^53 never
  pass through `number`.
- **The transaction is one `chain_payments::pay<T>` call** with a `coinWithBalance` coin of exactly the quoted amount; the
  argument order mirrors the Move function (`sources/chain_payments.move` in chain-payments-sui). A change there is a change
  here, in the same release wave.
- **Chains load on demand** (`CHAINS`); a new chain is a new subpath plus an entry, nothing else.
- Verified live on testnet (a client-built transaction executed with the Sui CLI keystore; see CHANGELOG 0.0.1).

## Commands

```bash
npm ci && npm run type-check && npm run lint && npm test && npm run build   # the core of what the `check` CI job runs
npm audit --audit-level=high                                                # the dependency check (this repo does not use mw-audit-gate)
```

Release: bump `version`, push, tag `v<version>`; `npm-publish.yml` re-runs the checks on the tagged commit and publishes with npm trusted publishing.
Commit messages: one short line, no body, no trailer.

## Gotchas

- **The package ids are built in.** `SUI_PACKAGES` and `SUI_PLATFORM_CONFIGS` (`src/sui.ts`) name this release's Chain Payments package and its `PlatformConfig` per network, and the builder
  refuses a method that names another package. Every new Move package is a new client release (the package is immutable), in the same wave as the kit and the service's method registry.
- **The merchant object is not pinned**: it comes from the service's method, because the merchant is whoever the service says (a host that knows its own should compare it before signing; SECURITY.md).
- **Everything is a string above 2^53.** `amount`, `periodMs` and `expiresMs` are strings and go through `u64()` to a `bigint`; never read them as `number`.
- **The package ships TypeScript source** (`exports.default` is `./src/*.ts`) and `dist/` holds declarations only, so a consumer's bundler compiles it.
- **`@mysten/sui` is an optional peer**: only `./sui` imports it, and `CHAINS` loads that module on demand.
- **There is no `mw-audit-gate`.** This repository does not depend on `@meddleware/frontend-config`; CI runs `npm audit --audit-level=high`.

## Documentation rules (workspace documentation standard, D144)

Every file has a header and every declaration a TSDoc comment (private declarations included); comments say why. `node scripts/check-docs.mjs --report chain-payments-client` (in the workspace repository) is the gate. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Related

- The audit: [`docs/audit/chain-payments-client-audit.md`](docs/audit/chain-payments-client-audit.md).
- How to propose a change: [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Consumers: `chain-payments-kit` (peer `^0.0.1`, dev `0.0.1`) and `link-in-bio-ui` (`^0.0.1`). The signing service: `chain-payments-service`; the Move package this builds calls for: `chain-payments-sui`.

## Interoperability

- [docs/INTEROP.md](docs/INTEROP.md): the standards this project speaks, what is planned, where to extend it, and what proves each claim.
