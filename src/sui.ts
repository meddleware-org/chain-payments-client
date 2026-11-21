/**
 * Sui: the payment transaction for a quote. One Move call, `chain_payments::pay<T>`, with a coin of exactly the quoted
 * amount (`coinWithBalance`, which draws from the gas coin for SUI and merges the payer's coins of other types), so the
 * payer is charged exactly what the quote says. The package also returns any change in the same transaction.
 *
 * Role: the `./sui` subpath, the Sui entry of the chain registry (`CHAINS` in `src/index.ts` loads it on demand). It builds a `Transaction` and reads one object from
 * the chain through a reader the host supplies; it signs nothing, executes nothing and holds no key. The buyer's wallet resolves, signs and executes the transaction.
 *
 * Main exports: `buildPayTransaction`, `suiChain`, `readPlatformFee`, `SUI_PACKAGES`, `SUI_PLATFORM_CONFIGS`, and the types `SuiObjectReader` and `PlatformFee`.
 *
 * Related: the Move function `pay<T>` in `chain-payments-sui` (`sources/chain_payments.move`; the argument order below mirrors it and `tests/client.test.ts` checks every
 * argument), `src/types.ts` (the `Quote`), and the service that signs the quote (`chain-payments-service`).
 */
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import type { ChainModule } from './index.js'
import type { Quote } from './types.js'

/**
 * The Chain Payments package on each Sui network, built into this release. Every package release is a fresh, immutable
 * package (its UpgradeCap burned), so a new package means a new client release. The service's method must name this
 * package: a service that names another one is refused, so a compromised service cannot have the wallet call other code.
 */
export const SUI_PACKAGES: Readonly<Record<string, string>> = Object.freeze({
  testnet: '0x610cf31fa9455893f1d0d139e6aa6ca4559a9f2acf07391c0d47c4e86a9c6af2',
})

/** Each package's shared `PlatformConfig` (the platform fee's rate and treasury), passed to every payment. */
export const SUI_PLATFORM_CONFIGS: Readonly<Record<string, string>> = Object.freeze({
  testnet: '0x7e3b9a5c5346850d0703df88fcab044644c3e92b84a65e59b4661ef0e7b96106',
})

/** The largest value a Move `u64` holds, 2^64 − 1. */
const MAX_U64 = (1n << 64n) - 1n
/** The Sui system `Clock` object, a fixed address the package reads the time from. */
const CLOCK = '0x6'

/**
 * Parses a u64 from the string (or number) the service sent.
 *
 * @param name - the field's name, for the error message.
 * @param v - the value: decimal digits only, at most 20 of them (the length of 2^64 − 1).
 * @returns the value as a `bigint`, so a number above 2^53 is never rounded.
 * @throws if the text is not decimal digits, or is larger than a u64.
 */
function u64(name: string, v: string | number): bigint {
  const s = String(v)
  // The digit pattern rejects a sign, a decimal point and an exponent (`1e9`) before `BigInt` is called (`BigInt` itself accepts a sign, `0x` hex and surrounding spaces).
  if (!/^[0-9]{1,20}$/.test(s)) throw new Error(`${name} is not an unsigned integer`)
  const n = BigInt(s)
  if (n > MAX_U64) throw new Error(`${name} is out of range`)
  return n
}

/**
 * Checks that the text is a Sui object id (`0x` and 1 to 64 hex digits) and returns it lower-cased.
 *
 * @param name - the field's name, for the error message.
 * @param v - the text from the service.
 * @throws if it has any other shape.
 */
function objectId(name: string, v: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(v)) throw new Error(`${name} is not an object id`)
  return v.toLowerCase()
}

/**
 * Decodes lower-case hex (an even number of digits, at least two) into bytes.
 *
 * @param name - the field's name, for the error message.
 * @param v - the hex text.
 * @throws if it is not lower-case hex of even length.
 */
function hexBytes(name: string, v: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/.test(v)) throw new Error(`${name} is not hex`)
  // The pattern above guarantees at least one pair, so `match` cannot return `null` here and the non-null assertion is safe.
  return Uint8Array.from(v.match(/../g)!.map((b) => parseInt(b, 16)))
}

/** The UTF-8 bytes of a string; the session id, reference and nonce are ASCII, which UTF-8 leaves unchanged (the service signs the same bytes). */
const utf8 = (s: string) => new TextEncoder().encode(s)

/**
 * Builds the transaction that pays `quote` (Sui methods only).
 *
 * @param quote - a quote from the service, for a method on Sui.
 * @param now - the current time in milliseconds; a parameter so a test can fix it, defaults to the real clock.
 * @returns an unsigned `Transaction` with one `chain_payments::pay<T>` call, for the buyer's wallet to resolve and sign.
 * @throws if the quote is not for Sui, has expired, has a zero or malformed amount, names a coin type, object id or signature of the wrong shape, or names a
 *   package other than the one built into this release for its network.
 */
export function buildPayTransaction(quote: Quote, now: number = Date.now()): Transaction {
  const m = quote.method
  if (m.chain !== 'sui') throw new Error(`not a Sui method: ${m.id}`)
  // An expired quote is refused here so the buyer is not asked to sign a payment the package would reject (`EQuoteExpired`).
  if (u64('expiresMs', quote.expiresMs) <= BigInt(now)) throw new Error('the quote has expired; ask for a new one')
  const amount = u64('amount', quote.amount)
  if (amount === 0n) throw new Error('the amount is zero')
  // A coin type is `0x<package>::<module>::<Name>`; anything else is not passed to the chain.
  if (!/^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(m.coinType)) throw new Error('not a coin type')
  // The network name comes from the service, so the table is read by own key only (`constructor` is not a network).
  const pkg = Object.hasOwn(SUI_PACKAGES, m.network) ? SUI_PACKAGES[m.network]! : undefined
  if (!pkg) throw new Error(`no Chain Payments package on Sui ${m.network} in this release`)
  // The service's package id must be this release's package. Leading zeros are dropped on both sides, because `0x00ab…` and `0xab…` are the same address.
  if (objectId('packageId', m.packageId).replace(/^0x0*/, '') !== pkg.replace(/^0x0*/, '')) {
    throw new Error(`the service names package ${m.packageId}, not this release's ${pkg} on ${m.network}`)
  }
  const tx = new Transaction()
  // A coin of exactly the quoted amount, assembled when the transaction is resolved: from the gas coin for SUI, from the payer's coins of that type otherwise.
  const coin = coinWithBalance({ type: m.coinType, balance: amount })
  const bytes = (b: Uint8Array) => tx.pure.vector('u8', Array.from(b))
  // Set for every network in `SUI_PACKAGES`: the two tables have the same keys, and `pkg` passed above.
  const config = SUI_PLATFORM_CONFIGS[m.network]!
  tx.moveCall({
    // The package id from this release, not the service's (they were just checked equal).
    target: `${pkg}::chain_payments::pay`,
    typeArguments: [m.coinType],
    // The order is that of `pay<T>` in the Move package: config, merchant, session, amount, units, period_ms, subscription_ref, expires_ms, nonce, signature,
    // payment coin, clock. The package re-verifies the signature over these values, so the order and the values must be exactly the service's.
    arguments: [
      tx.object(config),
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

/** The Sui entry of the chain registry: what `loadChain('sui')` returns. */
export const suiChain: ChainModule<Transaction> = {
  chain: 'sui',
  buildPayment: (quote) => buildPayTransaction(quote),
}

/** The part of a Sui client this needs (`SuiGrpcClient` and the wallet adapter's client both have it). */
export interface SuiObjectReader {
  core: {
    /** Reads one object; with `include.json` the reply carries the object's fields as JSON. */
    getObject(options: { objectId: string; include?: { json?: boolean } }): Promise<{
      object: { objectId: string; type?: string; json?: Record<string, unknown> | null }
    }>
  }
}

/** What a payment pays the platform: read from this release's `PlatformConfig` on the chain. */
export interface PlatformFee {
  /** The address the fee is sent to, lower-cased. */
  treasury: string
  /** The fee rate in basis points (hundredths of a percent); the package allows at most 100 (1 %). */
  feeBps: number
  /** In the coin's smallest unit; part of the quoted amount, not on top of it. */
  fee: bigint
}

/** An address or object id without its `0x` prefix, leading zeros or letter case, so two spellings of one address compare equal. */
const bareId = (a: string) => a.toLowerCase().replace(/^0x/, '').replace(/^0+/, '')

/**
 * The platform fee a quote's payment will pay, read from the chain (show it before signing, and read it again just
 * before). The object must be this release's `PlatformConfig` of this release's package, with a rate inside the
 * package's 1 % ceiling; anything else is an error, never a guess.
 *
 * @param client - anything with `core.getObject` (a gRPC client or the wallet adapter's client).
 * @param quote - the quote whose payment is about to be signed; its network picks the package and its amount the fee.
 * @returns the treasury, the rate and the fee, which the package rounds down.
 * @throws if the network has no package in this release, the object is not this release's `PlatformConfig`, or its rate or treasury cannot be read.
 */
export async function readPlatformFee(client: SuiObjectReader, quote: Quote): Promise<PlatformFee> {
  const network = quote.method.network
  // Own keys only, as in the builder: the network name is the service's.
  const pkg = Object.hasOwn(SUI_PACKAGES, network) ? SUI_PACKAGES[network]! : undefined
  const id = Object.hasOwn(SUI_PLATFORM_CONFIGS, network) ? SUI_PLATFORM_CONFIGS[network]! : undefined
  if (!pkg || !id) throw new Error(`no Chain Payments package on Sui ${network} in this release`)
  const { object } = await client.core.getObject({ objectId: id, include: { json: true } })
  // The object's type is `<package>::chain_payments::PlatformConfig`; a look-alike from another package is refused.
  const [addr, mod, name] = (object?.type ?? '').split('::')
  if (!addr || bareId(addr) !== bareId(pkg) || mod !== 'chain_payments' || name !== 'PlatformConfig') {
    throw new Error(`${id} is not this release's PlatformConfig`)
  }
  // A missing field is an error, never a default (a missing rate must not read as "no fee").
  const raw = object.json?.fee_bps
  const treasury = typeof object.json?.treasury === 'string' ? object.json.treasury : ''
  // The rate arrives as a string (a u64 in JSON); a whole number is accepted too. Either becomes a number only if it is a whole number, else NaN.
  const bps = (typeof raw === 'string' && /^[0-9]{1,3}$/.test(raw)) || (typeof raw === 'number' && Number.isInteger(raw)) ? Number(raw) : NaN
  // `NaN` fails both comparisons, so an unreadable rate is an error. 100 basis points is the package's own ceiling.
  if (!(bps >= 0 && bps <= 100) || !/^0x[0-9a-fA-F]{1,64}$/.test(treasury)) {
    throw new Error('the PlatformConfig could not be read')
  }
  // Integer division rounds down, as the package's `platform_fee` does.
  return { treasury: treasury.toLowerCase(), feeBps: bps, fee: (u64('amount', quote.amount) * BigInt(bps)) / 10_000n }
}
