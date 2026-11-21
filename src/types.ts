/**
 * The shapes of the Chain Payments session API's replies, as the checkout side reads them.
 *
 * Role: types only, no runtime code. The Chain Payments service (`chain-payments-service`, the `api.rs` handlers) writes these shapes as JSON; this file is
 * the client's statement of what it expects. Nothing here is checked at run time except where `src/index.ts` and `src/sui.ts` say so (the payment status,
 * the object shape of every reply, and each field the transaction builder uses): the rest is trusted to the service, which is why the Move package, not this
 * package, is what protects the payer's money.
 *
 * Main exports: `PaymentMethod`, `SessionStatus`, `CheckoutSession`, `Quote`, `PaymentStatus`.
 *
 * Related: `src/index.ts` (the client that returns these), `src/sui.ts` (the builder that reads a `Quote`), `docs/INTEROP.md` (the API as a standard-facing contract).
 */

/** A payment method a checkout session offers (from the service's registry). */
export interface PaymentMethod {
  /** Stable id, e.g. `sui-testnet:SUI`. */
  id: string
  /** The chain's name as the service spells it (`sui`); `loadChain` and `supported` look it up in `CHAINS`. */
  chain: string
  /** The network on that chain (`testnet`); the Sui builder looks the package up by this name. */
  network: string
  /** The coin's ticker, for display (`SUI`). */
  symbol: string
  /** How many decimal places one whole coin has (9 for SUI); used for display, never for the amount, which is already in the smallest unit. */
  decimals: number
  /** `0x…::module::Name`. */
  coinType: string
  /** The Chain Payments package the service says to call. The Sui builder refuses it unless it is the package built into this release. */
  packageId: string
  /** The merchant's shared on-chain object the payment is credited to. The service chooses it; it is not pinned here. */
  merchantObject: string
}

/** Where a checkout session is in its life. Only `open` can be paid. */
export type SessionStatus = 'open' | 'paid' | 'expired' | 'cancelled'

/** A checkout session: what is being bought, for how much, until when, and the ways to pay it. */
export interface CheckoutSession {
  /** The session id: 32 lowercase hex characters (the client refuses anything else before it builds a URL). */
  id: string
  status: SessionStatus
  /** The price in pence (GBP), a whole number. */
  amountPence: number
  /** e.g. `£3.00`. */
  amountText: string
  /** What the buyer is paying for, as the merchant wrote it. */
  description: string
  /** How many units the payment buys; a subscription payment extends the subscription by `units` × `periodMs`. */
  units: number
  /** When the session stops accepting payment (an RFC 3339 timestamp, as the service writes it). */
  expiresAt: string
  /** The coins and chains the buyer may pay with. */
  methods: PaymentMethod[]
}

/** A signed quote: an exact coin amount for a session, valid until `expiresMs`. Numbers above 2^53 are strings. */
export interface Quote {
  /** A single-use value the service chose; the Move package refuses a nonce it has seen. */
  nonce: string
  /** The session id this quote is for; `requestQuote` checks it equals the one that was asked for. */
  session: string
  /** The method this quote prices; `requestQuote` checks its id equals the one that was asked for. */
  method: PaymentMethod
  /** Exact amount in the coin's smallest unit. */
  amount: string
  /** e.g. `5.542213191 SUI`. */
  amountText: string
  /** e.g. `£3.00`. */
  priceText: string
  /** How many units the payment buys. */
  units: number
  /** The length of one subscription period in milliseconds (a string, like every u64); the package uses it only when `subscriptionRef` is not empty. */
  periodMs: string
  /** The merchant's reference for the subscription this payment extends (empty when the payment is not a subscription's); it is part of the signed message, so it cannot be changed. */
  subscriptionRef: string
  /** When the quote stops being valid, in milliseconds since the Unix epoch (a string, like every u64). */
  expiresMs: string
  /** ed25519 signature, hex. */
  signature: string
}

/**
 * `unapplied`: the transaction paid, but for a checkout already paid or cancelled. The merchant is told and decides
 * whether to credit or refund it; nothing is refunded automatically.
 */
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'unapplied'
