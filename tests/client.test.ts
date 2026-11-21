/**
 * Offline unit tests for the session client (`src/index.ts`) and the Sui payment builder and fee reader (`src/sui.ts`).
 *
 * Role: the package's only test file. Nothing here touches a network or a chain: the HTTP side runs against a fake `fetch`, and the transaction is built and
 * decoded in memory. The live proof is not here: a client-built transaction was executed on testnet on 2026-11-16 (CHANGELOG 0.0.1).
 *
 * Related: `docs/audit/chain-payments-client-audit.md` (F1, F2, F3 and the invariants these tests prove), the Move `pay<T>` in `chain-payments-sui`.
 */
import { describe, expect, it, vi } from 'vitest'
import { ChainPaymentsError, createSessionClient, loadChain, supported } from '../src/index'
import { SUI_PLATFORM_CONFIGS, buildPayTransaction, readPlatformFee } from '../src/sui'
import type { Quote } from '../src/types'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils'

// A session id in the service's shape (32 lowercase hex characters).
const SESSION = '0123456789abcdef0123456789abcdef'

/**
 * A `fetch` stand-in: answers from a table keyed by `METHOD /path`, and records every call.
 *
 * @param routes - the reply for each route as `[status, JSON body]`; a route not in the table answers 404 `not found`.
 * @returns the fake and the list of calls it received.
 */
function fakeFetch(routes: Record<string, [number, unknown]>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`
    const [status, body] = routes[key] ?? [404, { error: 'not found' }]
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { f, calls }
}

// A well-formed testnet quote: the package id is the one built into this release, and the expiry is in the future so the builder accepts it.
const quote: Quote = {
  nonce: 'fedcba9876543210fedcba9876543210',
  session: SESSION,
  method: {
    id: 'sui-testnet:SUI', chain: 'sui', network: 'testnet', symbol: 'SUI', decimals: 9, coinType: '0x2::sui::SUI',
    packageId: '0x610cf31fa9455893f1d0d139e6aa6ca4559a9f2acf07391c0d47c4e86a9c6af2',
    merchantObject: '0xd92a3ce208124219667d5b17a939617cc4dc816c093b91fd80f1f164e635d5e5',
  },
  amount: '5542213191',
  amountText: '5.542213191 SUI',
  priceText: '£3.00',
  units: 1,
  periodMs: '2629800000',
  subscriptionRef: 'acct',
  expiresMs: String(Date.now() + 100_000),
  signature: 'ab'.repeat(64),
}

describe('session client', () => {
  // The happy path of the three calls a checkout makes, and that none of them carries credentials.
  it('reads, quotes and submits without credentials', async () => {
    const { f, calls } = fakeFetch({
      [`GET /v1/sessions/${SESSION}`]: [200, { id: SESSION, status: 'open', methods: [] }],
      [`POST /v1/sessions/${SESSION}/quotes`]: [200, quote],
      [`POST /v1/sessions/${SESSION}/payments`]: [200, { status: 'confirmed' }],
    })
    const c = createSessionClient({ baseUrl: 'https://pay.example.org/ignored/path', fetch: f })
    expect((await c.getSession(SESSION)).status).toBe('open')
    expect((await c.requestQuote(SESSION, 'sui-testnet:SUI')).amount).toBe('5542213191')
    expect(await c.submitPayment(SESSION, quote.nonce, 'D1')).toBe('confirmed')
    // Only the origin of `baseUrl` is used: the `/ignored/path` is dropped.
    expect(calls[0]!.url).toBe(`https://pay.example.org/v1/sessions/${SESSION}`)
    expect(calls.every((c) => c.init?.credentials === 'omit')).toBe(true)
  })

  // The checks that stop the client trusting what it was not given: ids, quotes, transport and error replies.
  it('refuses bad ids, mismatched quotes, plain http and errors', async () => {
    const { f } = fakeFetch({ [`POST /v1/sessions/${SESSION}/quotes`]: [200, { ...quote, session: 'other' }] })
    const c = createSessionClient({ baseUrl: 'https://pay.example.org', fetch: f })
    // A session id that is not 32 hex characters never reaches a URL.
    await expect(c.getSession('../admin')).rejects.toBeInstanceOf(ChainPaymentsError)
    // The route answers a quote for another session: refused before a wallet could see it.
    await expect(c.requestQuote(SESSION, 'sui-testnet:SUI')).rejects.toThrow('does not match')
    // An unknown route answers 404 with an `error` text: the service's text is what the error carries.
    await expect(c.paymentStatus(SESSION, 'X')).rejects.toThrow('not found')
    expect(() => createSessionClient({ baseUrl: 'http://pay.example.org' })).toThrow('https')
  })

  // The registry resolves only its own keys.
  it('loads only supported chains', async () => {
    expect((await loadChain('sui')).chain).toBe('sui')
    await expect(loadChain('solana')).rejects.toThrow('cannot pay on solana')
    expect(supported([{ chain: 'sui' }, { chain: 'eth' }])).toEqual([true, false])
    // Names from the service never reach Object.prototype.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(supported([{ chain: name }])).toEqual([false])
      await expect(loadChain(name)).rejects.toThrow('cannot pay on')
    }
  })

  // A status the client does not know is an error, never a final answer; a body that is an array is not a reply.
  it('never reads an unknown payment status, or a reply that is not an object, as an answer', async () => {
    const { f } = fakeFetch({
      [`POST /v1/sessions/${SESSION}/payments`]: [200, { status: 'paid' }],
      [`GET /v1/sessions/${SESSION}/payments/D1`]: [200, ['confirmed']],
      [`GET /v1/sessions/${SESSION}/payments/D2`]: [200, { status: 'confirmed' }],
    })
    const c = createSessionClient({ baseUrl: 'https://pay.example.org', fetch: f })
    await expect(c.submitPayment(SESSION, quote.nonce, 'D1')).rejects.toThrow('unknown payment status')
    await expect(c.paymentStatus(SESSION, 'D1')).rejects.toThrow('not an object')
    expect(await c.paymentStatus(SESSION, 'D2')).toBe('confirmed')
  })
})

describe('Sui payment', () => {
  // The coarse check: one `pay` call on the `chain_payments` module with the coin type as its type argument, and twelve arguments.
  it('builds one pay call with the exact amount', () => {
    const tx = buildPayTransaction(quote)
    const data = tx.getData()
    const call = data.commands.find((c) => c.$kind === 'MoveCall')
    expect(call?.MoveCall?.function).toBe('pay')
    expect(call?.MoveCall?.module).toBe('chain_payments')
    expect(call?.MoveCall?.typeArguments).toEqual(['0x2::sui::SUI'])
    expect(call?.MoveCall?.arguments).toHaveLength(12)
  })

  it('passes every argument of pay<T> in the Move order, with the quote values', () => {
    // chain_payments::pay<T>(config, merchant, session, amount, units, period_ms, subscription_ref, expires_ms, nonce,
    //                        signature, payment: Coin<T>, clock)
    const data = buildPayTransaction(quote).getData()
    const call = data.commands.find((c) => c.$kind === 'MoveCall')!.MoveCall!
    expect(normalizeSuiAddress(call.package)).toBe(normalizeSuiAddress(quote.method.packageId))
    // The `i`-th argument as a transaction input (throws if it is a result of another command, which none of these is except the coin).
    const input = (i: number) => {
      const a = call.arguments[i]!
      if (a.$kind !== 'Input') throw new Error(`argument ${i} is not an input`)
      return data.inputs[a.Input]!
    }
    // An object argument's id, whether it was left unresolved or already resolved to a shared object.
    const object = (i: number) => {
      const x = input(i)
      return normalizeSuiAddress(x.UnresolvedObject?.objectId ?? x.Object?.SharedObject?.objectId ?? '')
    }
    // A pure (by-value) argument's bytes, decoded from the base64 the transaction data holds.
    const pure = (i: number) => fromBase64(input(i).Pure!.bytes)
    // A pure argument read back as a u64 (a string, as BCS parses it), and as a byte vector decoded to text.
    const u64 = (i: number) => bcs.u64().parse(pure(i))
    const bytes = (i: number) => new TextDecoder().decode(Uint8Array.from(bcs.vector(bcs.u8()).parse(pure(i))))
    expect(object(0)).toBe(normalizeSuiAddress(SUI_PLATFORM_CONFIGS.testnet!))
    expect(object(1)).toBe(normalizeSuiAddress(quote.method.merchantObject))
    expect(bytes(2)).toBe(quote.session)
    expect(u64(3)).toBe(quote.amount)
    expect(u64(4)).toBe(String(quote.units))
    expect(u64(5)).toBe(quote.periodMs)
    expect(bytes(6)).toBe(quote.subscriptionRef)
    expect(u64(7)).toBe(quote.expiresMs)
    expect(bytes(8)).toBe(quote.nonce)
    expect(Uint8Array.from(bcs.vector(bcs.u8()).parse(pure(9)))).toEqual(Uint8Array.from({ length: 64 }, () => 0xab))
    // The coin comes from coinWithBalance (an intent resolved at build time), never a raw object of the payer's choosing.
    expect(call.arguments[10]!.$kind).not.toBe('Input')
    expect(object(11)).toBe(normalizeSuiAddress('0x6'))
  })

  // Every refusal the builder makes before a wallet is asked to sign.
  it('refuses expired, malformed and foreign quotes', () => {
    expect(() => buildPayTransaction({ ...quote, expiresMs: '1' })).toThrow('expired')
    expect(() => buildPayTransaction({ ...quote, amount: '1e9' })).toThrow('amount')
    expect(() => buildPayTransaction({ ...quote, amount: '0' })).toThrow('zero')
    expect(() => buildPayTransaction({ ...quote, signature: 'zz' })).toThrow('signature')
    expect(() => buildPayTransaction({ ...quote, method: { ...quote.method, chain: 'eth' } })).toThrow('not a Sui method')
    expect(() => buildPayTransaction({ ...quote, method: { ...quote.method, packageId: 'evil' } })).toThrow('packageId')
    // A well-formed id of another package (a compromised or misconfigured service) is refused, as is an unknown network.
    expect(() => buildPayTransaction({ ...quote, method: { ...quote.method, packageId: `0x${'ab'.repeat(32)}` } })).toThrow('not this release')
    expect(() => buildPayTransaction({ ...quote, method: { ...quote.method, network: 'mainnet' } })).toThrow('no Chain Payments package')
    expect(() => buildPayTransaction({ ...quote, method: { ...quote.method, network: 'constructor' } })).toThrow('no Chain Payments package')
  })
})

describe('platform fee', () => {
  // A reader that returns the given object, with the call recorded.
  const reader = (object: { objectId: string; type?: string; json?: Record<string, unknown> }) => ({
    core: { getObject: vi.fn(async () => ({ object })) },
  })
  // The platform's config object as a node returns it: this release's type, a 0.2 % rate (20 basis points) and a mixed-case treasury address.
  const config = {
    objectId: SUI_PLATFORM_CONFIGS.testnet!,
    type: '0x610cf31fa9455893f1d0d139e6aa6ca4559a9f2acf07391c0d47c4e86a9c6af2::chain_payments::PlatformConfig',
    json: { fee_bps: '20', treasury: '0xA991ae11b0785718cd3ad1c616e804a4c083f431b3144bb845bdec651164864a' },
  }

  // 5542213191 × 20 / 10 000 = 11 084 426.38, rounded down as the package does.
  it('reads the rate and treasury from the chain and computes the fee out of the quoted amount', async () => {
    const r = reader(config)
    const f = await readPlatformFee(r, quote)
    expect(r.core.getObject).toHaveBeenCalledWith({ objectId: SUI_PLATFORM_CONFIGS.testnet, include: { json: true } })
    expect(f).toEqual({ treasury: '0xa991ae11b0785718cd3ad1c616e804a4c083f431b3144bb845bdec651164864a', feeBps: 20, fee: 11084426n })
  })

  // Anything that is not this release's config, with a rate in range, is an error and not a guess.
  it('refuses another object, a rate above the ceiling and an unknown network', async () => {
    await expect(readPlatformFee(reader({ ...config, type: '0xbad::chain_payments::PlatformConfig' }), quote)).rejects.toThrow('not this release')
    await expect(readPlatformFee(reader({ ...config, json: { ...config.json, fee_bps: '101' } }), quote)).rejects.toThrow('could not be read')
    await expect(readPlatformFee(reader({ ...config, json: { treasury: config.json.treasury } }), quote)).rejects.toThrow('could not be read')
    await expect(readPlatformFee(reader(config), { ...quote, method: { ...quote.method, network: 'mainnet' } })).rejects.toThrow('no Chain Payments package')
  })
})
