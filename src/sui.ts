/**
 * Sui: the payment transaction for a quote. One Move call, `chain_payments::pay<T>`, with a coin of exactly the quoted
 * amount (`coinWithBalance`, which draws from the gas coin for SUI and merges the payer's coins of other types), so the
 * payer is charged exactly what the quote says. The package also returns any change in the same transaction.
 */
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import type { ChainModule } from './index.js'
import type { Quote } from './types.js'

const MAX_U64 = (1n << 64n) - 1n
const CLOCK = '0x6'

function u64(name: string, v: string | number): bigint {
  const s = String(v)
  if (!/^[0-9]{1,20}$/.test(s)) throw new Error(`${name} is not an unsigned integer`)
  const n = BigInt(s)
  if (n > MAX_U64) throw new Error(`${name} is out of range`)
  return n
}

function objectId(name: string, v: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw new Error(`${name} is not an object id`)
  return v.toLowerCase()
}

function hexBytes(name: string, v: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/.test(v)) throw new Error(`${name} is not hex`)
  return Uint8Array.from(v.match(/../g)!.map((b) => parseInt(b, 16)))
}

const utf8 = (s: string) => new TextEncoder().encode(s)

/** Builds the transaction that pays `quote` (Sui methods only). */
export function buildPayTransaction(quote: Quote, now: number = Date.now()): Transaction {
  const m = quote.method
  if (m.chain !== 'sui') throw new Error(`not a Sui method: ${m.id}`)
  if (u64('expiresMs', quote.expiresMs) <= BigInt(now)) throw new Error('the quote has expired; ask for a new one')
  const amount = u64('amount', quote.amount)
  if (amount === 0n) throw new Error('the amount is zero')
  if (!/^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(m.coinType)) throw new Error('not a coin type')
  const pkg = objectId('packageId', m.packageId)
  const tx = new Transaction()
  const coin = coinWithBalance({ type: m.coinType, balance: amount })
  const bytes = (b: Uint8Array) => tx.pure.vector('u8', Array.from(b))
  tx.moveCall({
    target: `${pkg}::chain_payments::pay`,
    typeArguments: [m.coinType],
    arguments: [
      tx.object(objectId('merchantObject', m.merchantObject)),
      bytes(utf8(quote.session)),
      tx.pure.u64(amount),
      tx.pure.u64(u64('units', quote.units)),
      tx.pure.u64(u64('periodMs', quote.periodMs)),
      bytes(utf8(quote.subscriptionRef)),
      tx.pure.u64(u64('expiresMs', quote.expiresMs)),
      bytes(utf8(quote.nonce)),
      bytes(hexBytes('signature', quote.signature)),
      coin,
      tx.object(CLOCK),
    ],
  })
  return tx
}

export const suiChain: ChainModule<Transaction> = {
  chain: 'sui',
  buildPayment: (quote) => buildPayTransaction(quote),
}
