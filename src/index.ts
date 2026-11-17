/**
 * `@meddleware/chain-payments-client`: the checkout side of Chain Payments.
 *
 * - {@link createSessionClient}: read a session, ask for a quote, submit the transaction digest, follow its status;
 * - {@link loadChain}: the per-chain transaction builder for a quote's method, loaded on demand (only the chains a
 *   checkout actually uses are fetched); `@meddleware/chain-payments-client/sui` can also be imported directly.
 *
 * Adding a chain is a new subpath here and an entry in {@link CHAINS}; a checkout built on this package needs no change.
 */
export type { CheckoutSession, PaymentMethod, PaymentStatus, Quote, SessionStatus } from './types.js'
import type { CheckoutSession, PaymentStatus, Quote } from './types.js'


export class ChainPaymentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ChainPaymentsError'
  }
}

export interface SessionClientOptions {
  /** The service's public origin, e.g. `https://chain-payments.example.org`. */
  baseUrl: string
  fetch?: typeof fetch
  /** Per request, default 15 s. */
  timeoutMs?: number
}

const SESSION_ID = /^[0-9a-f]{32}$/
const MAX_BODY = 64 * 1024
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['pending', 'confirmed', 'rejected']

/** A payment status from the service, or an error: an unknown value never reads as final. */
function paymentStatus(v: unknown, httpStatus = 502): PaymentStatus {
  if (typeof v === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(v)) return v as PaymentStatus
  throw new ChainPaymentsError('the service returned an unknown payment status', httpStatus)
}

export interface SessionClient {
  getSession(id: string): Promise<CheckoutSession>
  requestQuote(sessionId: string, methodId: string): Promise<Quote>
  submitPayment(sessionId: string, nonce: string, digest: string): Promise<PaymentStatus>
  paymentStatus(sessionId: string, digest: string): Promise<PaymentStatus>
  /** Polls until the payment is confirmed or rejected (or `timeoutMs` passes: then `pending`). */
  waitForPayment(sessionId: string, digest: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<PaymentStatus>
}

export function createSessionClient(opts: SessionClientOptions): SessionClient {
  const base = new URL(opts.baseUrl)
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) {
    throw new Error('the Chain Payments URL must be https')
  }
  const origin = base.origin
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000

  async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const r = await doFetch(`${origin}${path}`, {
        method: init?.method ?? 'GET',
        headers: init ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: init ? JSON.stringify(init.body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      const text = await r.text()
      if (text.length > MAX_BODY) throw new ChainPaymentsError('the reply is too large', r.status)
      const parsed: unknown = text ? JSON.parse(text) : {}
      // Every reply is a JSON object; anything else (an array, a bare value, null) is refused before any field is read.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ChainPaymentsError('the reply is not an object', r.status)
      const json = parsed as Record<string, unknown>
      if (!r.ok) throw new ChainPaymentsError(typeof json.error === 'string' ? json.error : `HTTP ${r.status}`, r.status)
      return json as T
    } finally {
      clearTimeout(timer)
    }
  }

  const sid = (id: string) => {
    if (!SESSION_ID.test(id)) throw new ChainPaymentsError('not a checkout session id', 400)
    return id
  }

  const client: SessionClient = {
    getSession: async (id) => call<CheckoutSession>(`/v1/sessions/${sid(id)}`),
    requestQuote: async (sessionId, methodId) => {
      const q = await call<Quote>(`/v1/sessions/${sid(sessionId)}/quotes`, { method: 'POST', body: { method: methodId } })
      if (q.session !== sessionId || q.method?.id !== methodId) throw new ChainPaymentsError('the quote does not match the request', 502)
      return q
    },
    submitPayment: async (sessionId, nonce, digest) =>
      paymentStatus((await call<{ status: unknown }>(`/v1/sessions/${sid(sessionId)}/payments`, { method: 'POST', body: { nonce, digest } })).status),
    paymentStatus: async (sessionId, digest) =>
      paymentStatus((await call<{ status: unknown }>(`/v1/sessions/${sid(sessionId)}/payments/${encodeURIComponent(digest)}`)).status),
    waitForPayment: async (sessionId, digest, o = {}) => {
      const end = Date.now() + (o.timeoutMs ?? 60_000)
      for (;;) {
        const s = await client.paymentStatus(sessionId, digest)
        if (s !== 'pending' || Date.now() >= end) return s
        await new Promise((r) => setTimeout(r, o.intervalMs ?? 2000))
      }
    },
  }
  return client
}

/** A chain module: builds the payment for a quote in a form that chain's wallet adapter can sign. */
export interface ChainModule<Tx = unknown> {
  chain: string
  buildPayment(quote: Quote): Tx
}

/** Every chain this version can pay on, loaded on demand. */
export const CHAINS: Record<string, () => Promise<ChainModule>> = {
  sui: async () => (await import('./sui.js')).suiChain,
}

/** The chain name comes from the service: an own key only, so `constructor` or `__proto__` never resolve to a prototype member. */
const isChain = (chain: string): boolean => Object.hasOwn(CHAINS, chain)

export async function loadChain(chain: string): Promise<ChainModule> {
  const load = isChain(chain) ? CHAINS[chain] : undefined
  if (!load) throw new Error(`this version cannot pay on ${chain}; update @meddleware/chain-payments-client`)
  return load()
}

/** True if every method's chain is supported by this version (a checkout hides the rest). */
export function supported(methods: { chain: string }[]): boolean[] {
  return methods.map((m) => isChain(m.chain))
}
