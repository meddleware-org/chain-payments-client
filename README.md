# @meddleware/chain-payments-client

Checkout-side SDK for [Chain Payments](https://github.com/meddleware-org/chain-payments-service): read a checkout session,
get an exact signed quote, build the payment transaction for the buyer's wallet, submit the digest, wait for confirmation.

```ts
import { createSessionClient, loadChain } from '@meddleware/chain-payments-client'

const pay = createSessionClient({ baseUrl: 'https://chain-payments.example.org' })
const session = await pay.getSession(sessionId)
const quote = await pay.requestQuote(sessionId, session.methods[0].id)   // exact amount, valid ~2 minutes
const chain = await loadChain(quote.method.chain)                       // 'sui' → a @mysten/sui Transaction
const tx = chain.buildPayment(quote)
const { digest } = await wallet.signAndExecuteTransaction({ transaction: tx })
await pay.submitPayment(sessionId, quote.nonce, digest)
const status = await pay.waitForPayment(sessionId, digest)             // 'confirmed'
```

The Sui module (`@meddleware/chain-payments-client/sui`) calls `chain_payments::pay<T>` with a coin of exactly the quoted
amount; the package takes exactly that and returns change in the same transaction. `@mysten/sui` is a peer dependency.

## Development

The package ships its TypeScript source and the declarations (`dist/`). The checks all run in CI on every push (`.github/workflows/node-ci.yml`):

```bash
npm ci                           # install exactly the lockfile
npm run type-check               # tsc over src/ and tests/
npm run lint                     # eslint (typescript-eslint recommended)
npm test                         # 9 offline unit tests: the session client against a fake fetch, and the Sui builder decoded argument by argument
npm run build                    # the declarations in dist/
npm audit --audit-level=high     # the dependency check
```

How to propose a change: [CONTRIBUTING.md](CONTRIBUTING.md).

Licence: [0BSD](LICENSE).

## Open standards

What this project speaks, what is planned and where you can extend it: [docs/INTEROP.md](docs/INTEROP.md).
