// The pricing arithmetic, in one place for the calculator and the tests. Money is worked in cents so there is no rounding drift.
export const PRICE_CENTS = 1150; // $11.50 per client account per month (the Growth plan; PRICING.amount in config.ts says the same, a test checks it)

export const cost = (accounts: number): number => Math.max(0, Math.floor(accounts)) * PRICE_CENTS;
/** What an agency keeps if it charges its clients `clientPriceCents` per account. Never negative: below the cost price there is no margin, and the page says so. */
export const margin = (accounts: number, clientPriceCents: number): number => Math.max(0, Math.floor(accounts)) * Math.max(0, Math.round(clientPriceCents) - PRICE_CENTS);
export const revenue = (accounts: number, clientPriceCents: number): number => Math.max(0, Math.floor(accounts)) * Math.max(0, Math.round(clientPriceCents));
export const dollars = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
