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

Licence: [0BSD](LICENSE).
