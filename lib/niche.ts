/** What the writers (scripts, clips, text posts, replies) are told about each niche. Guard rails, not legal advice. */
export const NICHE_RULES: Record<string, string> = {
  crypto: `- Education only. Never promise returns, multipliers (10X, 100x) or prices. Never say which coin to buy.
- Avoid the word "currency" for crypto; say "crypto" or "digital asset".
- No airdrop or free-money hooks.
- A risk disclaimer is added to every caption automatically — don't write one.`,
  finance_trading: `- Education only. No stock tips, calls, targets or buy/sell advice. No return promises.
- Any market example must use price data at least 30 days old (SEBI rule). Prefer timeless examples.
- Personal finance: explain how to think and decide; never name a specific fund or stock to buy.`,
  psychology: `- She is a qualified psychologist. Explain patterns and the brain science behind them; never diagnose the viewer.
- Cases are anonymised and shared with consent; never use a client's name.
- When a topic touches mental illness, suggest talking to a professional.`,
  business_consulting: `- No income promises (no "earn ₹X a month"). Real client stories only, without names unless consented.
- No passive-income or zero-investment hooks.`,
  business_ai: `- No income promises. Show the tool doing a real task for an Indian business (WhatsApp leads, invoices, follow-ups, Tally/Excel work).
- No "teach me ChatGPT" beginner content; talk to owners, not employees.`,
};
