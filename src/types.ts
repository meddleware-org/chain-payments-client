/** A payment method a checkout session offers (from the service's registry). */
export interface PaymentMethod {
  /** Stable id, e.g. `sui-testnet:SUI`. */
  id: string
  chain: string
  network: string
  symbol: string
  decimals: number
  /** `0x…::module::Name`. */
  coinType: string
  packageId: string
  merchantObject: string
}

export type SessionStatus = 'open' | 'paid' | 'expired' | 'cancelled'

export interface CheckoutSession {
  id: string
  status: SessionStatus
  amountPence: number
  /** e.g. `£3.00`. */
  amountText: string
  description: string
  units: number
  expiresAt: string
  methods: PaymentMethod[]
}

/** A signed quote: an exact coin amount for a session, valid until `expiresMs`. Numbers above 2^53 are strings. */
export interface Quote {
  nonce: string
  session: string
  method: PaymentMethod
  /** Exact amount in the coin's smallest unit. */
  amount: string
  /** e.g. `5.542213191 SUI`. */
  amountText: string
  /** e.g. `£3.00`. */
  priceText: string
  units: number
  periodMs: string
  subscriptionRef: string
  expiresMs: string
  /** ed25519 signature, hex. */
  signature: string
}

/**
 * `unapplied`: the transaction paid, but for a checkout already paid or cancelled. The merchant is told and decides
 * whether to credit or refund it; nothing is refunded automatically.
 */
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected' | 'unapplied'
