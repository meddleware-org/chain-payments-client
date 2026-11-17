/**
 * Sui: the payment transaction for a quote. One Move call, `chain_payments::pay<T>`, with a coin of exactly the quoted
 * amount (`coinWithBalance`, which draws from the gas coin for SUI and merges the payer's coins of other types), so the
 * payer is charged exactly what the quote says. The package also returns any change in the same transaction.
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
  const pkg = Object.hasOwn(SUI_PACKAGES, m.network) ? SUI_PACKAGES[m.network]! : undefined
  if (!pkg) throw new Error(`no Chain Payments package on Sui ${m.network} in this release`)
  if (objectId('packageId', m.packageId).replace(/^0x0*/, '') !== pkg.replace(/^0x0*/, '')) {
    throw new Error(`the service names package ${m.packageId}, not this release's ${pkg} on ${m.network}`)
  }
  const tx = new Transaction()
  const coin = coinWithBalance({ type: m.coinType, balance: amount })
  const bytes = (b: Uint8Array) => tx.pure.vector('u8', Array.from(b))
  const config = SUI_PLATFORM_CONFIGS[m.network]!
  tx.moveCall({
    target: `${pkg}::chain_payments::pay`,
    typeArguments: [m.coinType],
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

export const suiChain: ChainModule<Transaction> = {
  chain: 'sui',
  buildPayment: (quote) => buildPayTransaction(quote),
}

/** The part of a Sui client this needs (`SuiGrpcClient` and the wallet adapter's client both have it). */
export interface SuiObjectReader {
  core: {
    getObject(options: { objectId: string; include?: { json?: boolean } }): Promise<{
      object: { objectId: string; type?: string; json?: Record<string, unknown> | null }
    }>
  }
}

/** What a payment pays the platform: read from this release's `PlatformConfig` on the chain. */
export interface PlatformFee {
  treasury: string
  feeBps: number
  /** In the coin's smallest unit; part of the quoted amount, not on top of it. */
  fee: bigint
}

const bareId = (a: string) => a.toLowerCase().replace(/^0x/, '').replace(/^0+/, '')

/**
 * The platform fee a quote's payment will pay, read from the chain (show it before signing, and read it again just
 * before). The object must be this release's `PlatformConfig` of this release's package, with a rate inside the
 * package's 1 % ceiling; anything else is an error, never a guess.
 */
export async function readPlatformFee(client: SuiObjectReader, quote: Quote): Promise<PlatformFee> {
  const network = quote.method.network
  const pkg = Object.hasOwn(SUI_PACKAGES, network) ? SUI_PACKAGES[network]! : undefined
  const id = Object.hasOwn(SUI_PLATFORM_CONFIGS, network) ? SUI_PLATFORM_CONFIGS[network]! : undefined
  if (!pkg || !id) throw new Error(`no Chain Payments package on Sui ${network} in this release`)
  const { object } = await client.core.getObject({ objectId: id, include: { json: true } })
  const [addr, mod, name] = (object?.type ?? '').split('::')
  if (!addr || bareId(addr) !== bareId(pkg) || mod !== 'chain_payments' || name !== 'PlatformConfig') {
    throw new Error(`${id} is not this release's PlatformConfig`)
  }
  // A missing field is an error, never a default (a missing rate must not read as "no fee").
  const raw = object.json?.fee_bps
  const treasury = typeof object.json?.treasury === 'string' ? object.json.treasury : ''
  const bps = (typeof raw === 'string' && /^[0-9]{1,3}$/.test(raw)) || (typeof raw === 'number' && Number.isInteger(raw)) ? Number(raw) : NaN
  if (!(bps >= 0 && bps <= 100) || !/^0x[0-9a-fA-F]{1,64}$/.test(treasury)) {
    throw new Error('the PlatformConfig could not be read')
  }
  return { treasury: treasury.toLowerCase(), feeBps: bps, fee: (u64('amount', quote.amount) * BigInt(bps)) / 10_000n }
}
