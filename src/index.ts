/**
 * `@meddleware/chain-payments-client`: the checkout side of Chain Payments.
 *
 * - {@link createSessionClient}: read a session, ask for a quote, submit the transaction digest, follow its status;
 * - {@link loadChain}: the per-chain transaction builder for a quote's method, loaded on demand (only the chains a
 *   checkout actually uses are fetched); `@meddleware/chain-payments-client/sui` can also be imported directly.
 *
 * Adding a chain is a new subpath here and an entry in {@link CHAINS}; a checkout built on this package needs no change.
 *
 * Role: the package's main entry (`.`). It holds no secret and no state: every reply from the service is treated as untrusted input and checked before a field is
 * used (the reply is an object, a payment status is one of four known words, a quote answers the request that was made).
 *
 * Main exports: `createSessionClient`, `ChainPaymentsError`, `loadChain`, `supported`, `CHAINS`, and the types from `./types.js`.
 *
 * Related: `src/types.ts` (the reply shapes), `src/sui.ts` (the Sui builder), the service's `crates/service/src/api.rs` (the routes called here).
 */
export type { CheckoutSession, PaymentMethod, PaymentStatus, Quote, SessionStatus } from './types.js'
import type { CheckoutSession, PaymentStatus, Quote } from './types.js'


/** An error from the Chain Payments API or from the checks around it, with the HTTP status it came with (or the one the client chose). */
export class ChainPaymentsError extends Error {
  constructor(
    message: string,
    /** The HTTP status of the reply, or the status this client picked when it refused a reply itself (400 for a bad id, 502 for a bad reply). */
    readonly status: number,
  ) {
    super(message)
    // The name that shows in a log or a stack trace, and that a caller can test for.
    this.name = 'ChainPaymentsError'
  }
}

/** What `createSessionClient` needs. */
export interface SessionClientOptions {
  /** The service's public origin, e.g. `https://chain-payments.example.org`. */
  baseUrl: string
  /** A replacement for the global `fetch` (a test, or a host that must add its own transport); defaults to the global one. */
  fetch?: typeof fetch
  /** Per request, default 15 s. */
  timeoutMs?: number
}

/** A session id as the service makes them: 32 lowercase hex characters. Checked before an id is put into a URL, so a caller cannot reach another path (`../admin`). */
const SESSION_ID = /^[0-9a-f]{32}$/
/** The largest reply body accepted, in characters. The service's replies are small JSON objects, so a larger body is refused rather than parsed. */
const MAX_BODY = 64 * 1024
/** Every payment status this version understands; the single list `paymentStatus` checks against. */
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['pending', 'confirmed', 'rejected', 'unapplied']

/** A payment status from the service, or an error: an unknown value never reads as final. */
function paymentStatus(v: unknown, httpStatus = 502): PaymentStatus {
  // The membership test is on the string form, because the list is typed as `PaymentStatus` and `v` is not known to be one.
  if (typeof v === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(v)) return v as PaymentStatus
  throw new ChainPaymentsError('the service returned an unknown payment status', httpStatus)
}

/** The checkout operations on one Chain Payments service. */
export interface SessionClient {
  /** Reads a session (`GET /v1/sessions/{id}`). */
  getSession(id: string): Promise<CheckoutSession>
  /** Asks for a signed quote of one payment method (`POST /v1/sessions/{id}/quotes`); the reply must be for the session and method that were asked for. */
  requestQuote(sessionId: string, methodId: string): Promise<Quote>
  /** Tells the service which transaction paid which quote (`POST /v1/sessions/{id}/payments`); returns the status it found. */
  submitPayment(sessionId: string, nonce: string, digest: string): Promise<PaymentStatus>
  /** Reads the status of a submitted payment (`GET /v1/sessions/{id}/payments/{digest}`). */
  paymentStatus(sessionId: string, digest: string): Promise<PaymentStatus>
  /** Polls until the payment is no longer pending (or `timeoutMs` passes: then `pending`). */
  waitForPayment(sessionId: string, digest: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<PaymentStatus>
}

/**
 * Creates the client for one service.
 *
 * @param opts - the service's origin and optional transport and timeout.
 * @returns the client; it holds nothing between calls.
 * @throws if `baseUrl` is not a URL, or is not https (a loopback host, for local development, is the one exception).
 */
export function createSessionClient(opts: SessionClientOptions): SessionClient {
  const base = new URL(opts.baseUrl)
  // Plain http would let anyone on the path read or change a quote, so it is refused; loopback is allowed so a service run on the developer's machine works.
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) {
    throw new Error('the Chain Payments URL must be https')
  }
  // Only the origin is kept, so a path, query or credentials in `baseUrl` never reach a request.
  const origin = base.origin
  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000

  /**
   * One request, with a timeout, a size limit and the reply checked to be a JSON object.
   *
   * @param path - the path on the service's origin, already validated by the caller.
   * @param init - present for a POST: the JSON body to send.
   * @returns the reply object (unchecked beyond being an object: each caller validates the fields it uses).
   * @throws `ChainPaymentsError` for a non-2xx reply (with the service's `error` text when it gave one), an oversized reply or a reply that is not an object.
   */
  async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
    // The timeout aborts the request, including a reply body that never finishes arriving.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const r = await doFetch(`${origin}${path}`, {
        method: init?.method ?? 'GET',
        headers: init ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: init ? JSON.stringify(init.body) : undefined,
        // No cookies or HTTP credentials are sent, and nothing is cached: a quote and a status are only true now.
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      const text = await r.text()
      if (text.length > MAX_BODY) throw new ChainPaymentsError('the reply is too large', r.status)
      // An empty body reads as an empty object, so a reply with no content fails the field checks below rather than the JSON parser.
      const parsed: unknown = text ? JSON.parse(text) : {}
      // Every reply is a JSON object; anything else (an array, a bare value, null) is refused before any field is read.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ChainPaymentsError('the reply is not an object', r.status)
      const json = parsed as Record<string, unknown>
      // The service's own `error` text is passed on when it is a string; otherwise only the status.
      if (!r.ok) throw new ChainPaymentsError(typeof json.error === 'string' ? json.error : `HTTP ${r.status}`, r.status)
      return json as T
    } finally {
      // Always stop the timer, so a finished request does not leave one running.
      clearTimeout(timer)
    }
  }

  /** Returns the session id if it has the service's shape, else throws, so no unchecked text is ever put into a path. */
  const sid = (id: string) => {
    if (!SESSION_ID.test(id)) throw new ChainPaymentsError('not a checkout session id', 400)
    return id
  }

  // Declared before it is filled, because `waitForPayment` calls `client.paymentStatus`.
  const client: SessionClient = {
    getSession: async (id) => call<CheckoutSession>(`/v1/sessions/${sid(id)}`),
    requestQuote: async (sessionId, methodId) => {
      const q = await call<Quote>(`/v1/sessions/${sid(sessionId)}/quotes`, { method: 'POST', body: { method: methodId } })
      // A quote for another session or method would make the buyer sign something they did not choose, so it is refused here, before a wallet sees it.
      if (q.session !== sessionId || q.method?.id !== methodId) throw new ChainPaymentsError('the quote does not match the request', 502)
      return q
    },
    submitPayment: async (sessionId, nonce, digest) =>
      paymentStatus((await call<{ status: unknown }>(`/v1/sessions/${sid(sessionId)}/payments`, { method: 'POST', body: { nonce, digest } })).status),
    // The digest is encoded because it is the one caller-chosen value put into the path.
    paymentStatus: async (sessionId, digest) =>
      paymentStatus((await call<{ status: unknown }>(`/v1/sessions/${sid(sessionId)}/payments/${encodeURIComponent(digest)}`)).status),
    waitForPayment: async (sessionId, digest, o = {}) => {
      const end = Date.now() + (o.timeoutMs ?? 60_000)
      for (;;) {
        const s = await client.paymentStatus(sessionId, digest)
        // Stop on any answer but `pending`, or when time is up (and then report what was last seen: `pending`).
        if (s !== 'pending' || Date.now() >= end) return s
        await new Promise((r) => setTimeout(r, o.intervalMs ?? 2000))
      }
    },
  }
  return client
}

/** A chain module: builds the payment for a quote in a form that chain's wallet adapter can sign. */
export interface ChainModule<Tx = unknown> {
  /** The chain's name, as the service spells it in a method's `chain`. */
  chain: string
  /** Builds the transaction that pays `quote`; throws if the quote cannot be paid (expired, malformed, or for a package this release does not know). */
  buildPayment(quote: Quote): Tx
}

/** Every chain this version can pay on, loaded on demand. */
export const CHAINS: Record<string, () => Promise<ChainModule>> = {
  // A dynamic import, so a checkout that never pays on Sui does not load the Sui module (or, through it, `@mysten/sui`).
  sui: async () => (await import('./sui.js')).suiChain,
}

/** The chain name comes from the service: an own key only, so `constructor` or `__proto__` never resolve to a prototype member. */
const isChain = (chain: string): boolean => Object.hasOwn(CHAINS, chain)

/**
 * Loads the transaction builder for a chain.
 *
 * @param chain - the chain's name, usually a method's `chain` from the service.
 * @returns the chain's module.
 * @throws if this version has no module for that chain (the message tells the host to update the package).
 */
export async function loadChain(chain: string): Promise<ChainModule> {
  const load = isChain(chain) ? CHAINS[chain] : undefined
  if (!load) throw new Error(`this version cannot pay on ${chain}; update @meddleware/chain-payments-client`)
  return load()
}

/**
 * True if every method's chain is supported by this version (a checkout hides the rest).
 *
 * @param methods - a session's methods (only their `chain` is read).
 * @returns one flag per method, in the same order: whether this version can pay on that method's chain.
 */
export function supported(methods: { chain: string }[]): boolean[] {
  return methods.map((m) => isChain(m.chain))
}
