import { describe, expect, it } from 'vitest'
import { ChainPaymentsError, createSessionClient, loadChain, supported } from '../src/index'
import { buildPayTransaction } from '../src/sui'
import type { Quote } from '../src/types'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils'

const SESSION = '0123456789abcdef0123456789abcdef'

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

const quote: Quote = {
  nonce: 'fedcba9876543210fedcba9876543210',
  session: SESSION,
  method: {
    id: 'sui-testnet:SUI', chain: 'sui', network: 'testnet', symbol: 'SUI', decimals: 9, coinType: '0x2::sui::SUI',
    packageId: '0x5f67109c6b436fc0c0415d7f3e63ca10d374d8c4bb5e3b1f087cabb1c785bc14',
    merchantObject: '0x30b6d544652d35d4a481fa7e45adf8e514b9ae1596377e837b6fdf36d967dae8',
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
    expect(calls[0]!.url).toBe(`https://pay.example.org/v1/sessions/${SESSION}`)
    expect(calls.every((c) => c.init?.credentials === 'omit')).toBe(true)
  })

  it('refuses bad ids, mismatched quotes, plain http and errors', async () => {
    const { f } = fakeFetch({ [`POST /v1/sessions/${SESSION}/quotes`]: [200, { ...quote, session: 'other' }] })
    const c = createSessionClient({ baseUrl: 'https://pay.example.org', fetch: f })
    await expect(c.getSession('../admin')).rejects.toBeInstanceOf(ChainPaymentsError)
    await expect(c.requestQuote(SESSION, 'sui-testnet:SUI')).rejects.toThrow('does not match')
    await expect(c.paymentStatus(SESSION, 'X')).rejects.toThrow('not found')
    expect(() => createSessionClient({ baseUrl: 'http://pay.example.org' })).toThrow('https')
  })

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
  it('builds one pay call with the exact amount', () => {
    const tx = buildPayTransaction(quote)
    const data = tx.getData()
    const call = data.commands.find((c) => c.$kind === 'MoveCall')
    expect(call?.MoveCall?.function).toBe('pay')
    expect(call?.MoveCall?.module).toBe('chain_payments')
    expect(call?.MoveCall?.typeArguments).toEqual(['0x2::sui::SUI'])
    expect(call?.MoveCall?.arguments).toHaveLength(11)
  })

  it('passes every argument of pay<T> in the Move order, with the quote values', () => {
    // chain_payments::pay<T>(merchant, session, amount, units, period_ms, subscription_ref, expires_ms, nonce, signature,
    //                        payment: Coin<T>, clock)
    const data = buildPayTransaction(quote).getData()
    const call = data.commands.find((c) => c.$kind === 'MoveCall')!.MoveCall!
    expect(normalizeSuiAddress(call.package)).toBe(normalizeSuiAddress(quote.method.packageId))
    const input = (i: number) => {
      const a = call.arguments[i]!
      if (a.$kind !== 'Input') throw new Error(`argument ${i} is not an input`)
      return data.inputs[a.Input]!
    }
    const object = (i: number) => {
      const x = input(i)
      return normalizeSuiAddress(x.UnresolvedObject?.objectId ?? x.Object?.SharedObject?.objectId ?? '')
    }
    const pure = (i: number) => fromBase64(input(i).Pure!.bytes)
    const u64 = (i: number) => bcs.u64().parse(pure(i))
    const bytes = (i: number) => new TextDecoder().decode(Uint8Array.from(bcs.vector(bcs.u8()).parse(pure(i))))
    expect(object(0)).toBe(normalizeSuiAddress(quote.method.merchantObject))
    expect(bytes(1)).toBe(quote.session)
    expect(u64(2)).toBe(quote.amount)
    expect(u64(3)).toBe(String(quote.units))
    expect(u64(4)).toBe(quote.periodMs)
    expect(bytes(5)).toBe(quote.subscriptionRef)
    expect(u64(6)).toBe(quote.expiresMs)
    expect(bytes(7)).toBe(quote.nonce)
    expect(Uint8Array.from(bcs.vector(bcs.u8()).parse(pure(8)))).toEqual(Uint8Array.from({ length: 64 }, () => 0xab))
    // The coin comes from coinWithBalance (an intent resolved at build time), never a raw object of the payer's choosing.
    expect(call.arguments[9]!.$kind).not.toBe('Input')
    expect(object(10)).toBe(normalizeSuiAddress('0x6'))
  })

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
