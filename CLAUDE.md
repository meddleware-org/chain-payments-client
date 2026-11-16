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
npm ci && npm run type-check && npm run lint && npm test && npm run build
```

Commit messages: one short line, no body, no trailer.
