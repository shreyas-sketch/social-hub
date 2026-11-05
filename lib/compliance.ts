/**
 * Rule-based check run on every script, before anyone sees it and again on every edit.
 * "block" = cannot be approved until the words change. "warn" = a person decides.
 *
 * These are guard rails, not legal advice. The rules follow what we know of
 * SEBI's educator rules (no calls, no return promises, price data at least
 * 30 days old) and ASCI's crypto ad guidelines (risk disclaimer, no return
 * promises, avoid calling crypto a "currency").
 */
export type Niche = "crypto" | "psychology" | "finance_trading" | "business_consulting" | "business_ai";
export type Issue = { level: "block" | "warn"; rule: string; match: string; fix: string; soft?: boolean };
export type Check = { status: "ok" | "warn" | "block"; issues: Issue[] };

/** soft = a wording note (it says something about audience or phrasing, not a claim): listed, never cut out of a long video. */
type Rule = { level: "block" | "warn"; rule: string; re: RegExp; fix: string; niches?: Niche[]; soft?: boolean };

const FIN: Niche[] = ["crypto", "finance_trading"];

// Spoken forms matter as much as written ones: transcripts say "rupees" and "10 times", not "₹" and "10×".
const NUM = String.raw`(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred)`;
const AMT = String.raw`(?:₹\s?\d[\d,.]*\s*(?:k|thousand|lakhs?|l|cr|crores?)?|(?:rs\.?|inr)\s?\d[\d,.]*\s*(?:k|thousand|lakhs?|crores?|cr)?|\$\s?\d[\d,.]*\s*k?|\d[\d,.]*\s*(?:k|thousand|lakhs?|crores?|cr)?\s*(?:rupees|rs\.?|inr|dollars))`;
const AMT_TO = String.raw`(?:₹\s?\d[\d,.]*|(?:rs\.?|inr)\s?\d[\d,.]*|\$\s?\d[\d,.]*|\d[\d,.]*\s*(?:k|thousand|lakhs?|crores?|cr|rupees|rs\.?|dollars)(?![\p{L}\p{N}]))`;
const COINS_STOCKS = String.raw`(?:nifty|sensex|bank ?nifty|fin ?nifty|bitcoin|btc|ethereum|eth|solana|this (?:stock|share|coin|token))`;
const NOT_PER_TIME = String.raw`(?!\s+(?:a|per|every)\s+(?:day|week|month|year))`;
// A price level: the whole number, not one of two ("15,000 or 30,000"), not a % move, not a count of things ("2 outcomes").
const PRICE = String.raw`(?:₹|rs\.?|\$)?\s?\d[\d,]*(?:\.\d+)?(?![\d,.])(?:\s*(?:k|lakh|crore)\b)?(?!\s*(?:or|ya|aur|to|-|–)\s*(?:₹|rs\.?|\$)?\s?\d)(?!\s*(?:%|percent|outcomes?|scenarios?|ways|things|reasons|times|days|weeks|months|years|people|types|baatein|cheezein|tarike)\b)(?!\s*%)`;

const RULES: Rule[] = [
  // Return promises — any money niche
  { level: "block", rule: "Return promise (multiplier)", re: /\b\d{1,4}\s?[xX×](?![\p{L}\p{N}])(?!\s*(?:faster|speed|zoom))/gu, fix: "Remove the multiplier. Talk about the method, not the result.", niches: FIN },
  {
    level: "block",
    rule: "Return promise (multiplier)",
    // "ten times your money", "this coin can go 10 times", "10 guna return" — a promise about money, not "volume grew 3 times".
    re: new RegExp(
      String.raw`\b${NUM}\s*(?:-\s*)?(?:times|fold|guna)\s+(?:your|the|their|my|our|apne|aapke|apka|aapka)\s+(?:money|returns?|investment|capital|portfolio|paise|paisa)\b` +
        String.raw`|\b(?:money|investment|capital|portfolio|coin|token|stock|share|returns?|paisa|paise|it|this)\b[^.\n,]{0,20}?\b(?:can|will|could|may|would|should|is going to|going to)\s+(?:easily\s+|definitely\s+|surely\s+)?(?:go|grow|multiply|become|give(?:\s+you)?|return|do|make(?:\s+you)?)\s+(?:up\s+)?(?:by\s+)?${NUM}\s*(?:-\s*)?(?:times|fold|x|guna)\b${NOT_PER_TIME}` +
        String.raw`|\b\d+\s*guna\s+(?:return|profit|munafa|paisa|paise|kamai)`,
      "giu",
    ),
    fix: "Remove the multiplier. Talk about the method, not the result.",
    niches: FIN,
  },
  { level: "block", rule: "Return promise (₹ into ₹)", re: /₹\s?[\d,.]+\s*(?:k|lakh|lakhs|l|cr|crore)?\s*(?:into|to|→|becomes?|became)\s*₹\s?[\d,.]+/gi, fix: "Drop the before/after money figure.", niches: FIN },
  {
    level: "block",
    rule: "Return promise (₹ into ₹)",
    re: new RegExp(
      String.raw`${AMT}\s*(?:into|→|becomes?|became|turned into|turns into|grew to|grows to|grow to)\s*${AMT_TO}` +
        String.raw`|${AMT}\s+se\s+${AMT_TO}\s+(?:bana\w*|kama\w*|ho\s+(?:gaye|gaya|jayenge|jayega|jaate))` +
        String.raw`|\b(?:turn|turns|turned|grow|grows|grew|make|makes|made)\s+${AMT}\s+(?:into|to)\s+${AMT_TO}` +
        String.raw`|\b(?:turn|turns|turned)\s+\d[\d,.]*\s*(?:k|thousand|lakhs?)?\s+into\s+\d[\d,.]*\s*(?:k|thousand|lakhs?|crores?|cr)\b` +
        String.raw`|\b\d[\d,.]*\s*(?:k|thousand|lakhs?)\s+(?:into|→)\s+\d[\d,.]*\s*(?:k|thousand|lakhs?|crores?|cr)\b`,
      "giu",
    ),
    fix: "Drop the before/after money figure.",
    niches: FIN,
  },
  { level: "block", rule: "Guaranteed returns", re: /\b(guarantee[ds]?|assured returns?|risk[- ]?free|sure[- ]?shot|can'?t lose|no risk|pakka (?:profit|return|munafa))\b/gi, fix: "Never promise safety or returns." },
  { level: "block", rule: "Get-rich claim", re: /\b(get rich|double your money|triple your money|(?:paisa|paise|money)\s+double\s+(?:ho\s+ja\w*|kar\w*|in\s+\d+|\d+\s+(?:din|mahine|months|days|weeks))|make money fast|overnight millionaire|financial freedom in \d+)/gi, fix: "Remove the get-rich framing." },

  // SEBI — trading and stock content
  { level: "block", rule: "Stock call or target", re: /\b(target(?: price)?\s*(?:of\s*)?(?:₹|rs\.?|inr)?\s?\d|could jump \d+\s?%|will (?:hit|reach|cross) (?:₹|rs\.?)?\s?\d|buy (?:now|today|this stock)|sell (?:now|today)|stock tip|intraday call|my (?:pick|call) (?:for|today))/gi, fix: "No calls or targets. Teach the rule, not the trade.", niches: ["finance_trading", "crypto"] },
  {
    level: "block",
    rule: "Stock call or target",
    re: new RegExp(
      String.raw`\btarget\s+(?:for|on|of)\s+(?:the\s+)?${COINS_STOCKS}\b[^.\n]{0,25}?${PRICE}` +
        String.raw`|\b${COINS_STOCKS}\b[^.\n]{0,25}?\b(?:will|can|could|should|is going to|going to|is heading to|heading to)\s+(?:go|touch|hit|reach|cross|test|see)\s+(?:to\s+)?${PRICE}`,
      "giu",
    ),
    fix: "No calls or targets. Teach the rule, not the trade.",
    niches: ["finance_trading", "crypto"],
  },
  {
    level: "warn",
    rule: "Possible price target",
    re: /\btarget\b(?!\s+(?:audience|market|customer|group|age|reader|viewer|user|client|student)s?\b)[^.\n]{0,30}?\b(?:is|at|of)\s*(?:₹|rs\.?|inr|\$)?\s?\d[\d,]{2,}(?![\d,])(?!\s*(?:students|people|followers|subscribers|clients|customers|members|users|views|sign-?ups|leads|calls|videos|posts|reels|days|hours|minutes|%))/gi,
    fix: "If this is a price target, take it out. Teach the rule, not the trade.",
    niches: ["finance_trading", "crypto"],
  },
  { level: "warn", rule: "Current market data", re: /\b(today'?s market|this week'?s (?:market|nifty|sensex)|nifty (?:today|is (?:at|crashing|falling|rising))|sensex (?:today|is (?:at|up|down|crashing|falling|rising))|right now the market|live market)\b/gi, fix: "SEBI: educators may only use price data at least 30 days old. Use an older example.", niches: ["finance_trading"] },
  { level: "warn", rule: "Named fund or stock pick", re: /\b(best (?:mutual fund|stock|share|coin)s? to buy|which (?:stock|fund|coin) to buy|what i'?d (?:actually )?buy|top \d+ (?:stocks|coins|funds) (?:for|to))\b/gi, fix: "Explain how to judge, don't hand out picks.", niches: ["finance_trading", "crypto"] },

  // ASCI — crypto
  { level: "warn", rule: "Crypto called a currency", re: /\b(crypto ?currenc(?:y|ies)|digital currenc(?:y|ies))\b/gi, fix: "ASCI asks crypto ads to avoid 'currency'. Say 'crypto' or 'digital asset'.", niches: ["crypto"], soft: true },
  {
    level: "block",
    rule: "Price prediction",
    re: new RegExp(
      String.raw`\b(?:bitcoin|btc|ethereum|eth|solana|sol)\b[^.\n]{0,40}?\b(?:(?:will|can|could|is going to|going to)\s+(?:hit|reach|touch|cross|go to|be at)|heading to)\s*${PRICE}` +
        String.raw`|\b(?:bitcoin|btc|ethereum|eth|solana|sol)\b[^.\n]{0,40}?\bto\s*(?:\$\s?\d[\d,]*k?|\d[\d,]*\s*(?:k|lakh)\b)`,
      "giu",
    ),
    fix: "No price predictions.",
    niches: ["crypto"],
  },
  { level: "warn", rule: "Airdrop or free-money hook", re: /\b(airdrops?|free crypto|free money)\b/gi, fix: "This pulls free-money seekers, who are on the keep-out list.", niches: ["crypto"], soft: true },

  // Psychology
  { level: "warn", rule: "Diagnosis or cure claim", re: /\b(you (?:have|might have|probably have) (?:adhd|ocd|bpd|bipolar|depression|anxiety disorder|autism|narcissis\w+)|cures?\b|fix your (?:depression|anxiety|trauma)|heal (?:your )?trauma in)\b/gi, fix: "Describe patterns, don't diagnose. Suggest seeing a professional.", niches: ["psychology"] },
  { level: "warn", rule: "Client detail", re: /\b(my (?:client|patient)\s+[A-Z][a-z]+|(?:client|patient) named)\b/g, fix: "Anonymise cases and share only with consent.", niches: ["psychology"] },

  // Business and consulting
  { level: "warn", rule: "Income claim", re: /\b(earn|make|making)\s*₹\s?[\d,.]+\s*(?:k|lakh|lakhs|l|cr|crore)?\s*(?:a|per|\/)\s*(?:month|day|week)/gi, fix: "Income claims need proof (ASCI). Keep it to what a real client did, with their consent.", niches: ["business_ai", "business_consulting"] },
  { level: "warn", rule: "Passive income promise", re: /\b(passive income|money while you sleep|zero investment business)\b/gi, fix: "This pulls side-hustle seekers, who are on the keep-out list.", niches: ["business_ai", "business_consulting"], soft: true },
];

/**
 * A warning, not a claim: "there are no guaranteed returns", "nobody can promise 10x", "koi bhi guarantee nahi de sakta",
 * "beware of anyone selling sure-shot tips". Looks at the same clause only, so "Not advice, but this is a sure shot" still counts.
 */
const NEG_BEFORE = /\b(?:no(?!\s+doubt)|not|never(?!\s+miss)|nobody|no one|none|nothing|neither|nor|can'?t|cannot|don'?t(?!\s+(?:miss|wait|forget|delay))|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|won'?t|shouldn'?t|without|avoid|beware|myth|fake|scam|ignore|run from|(?:anyone|people|someone|those|whoever)\s+(?:who\s+)?(?:promis\w*|says?|claims?|offers?|sells?|selling|offering|claiming|tells?\s+you)|(?:log|people|they|most people|many people)\s+(?:sochte|think|believe|maante|kehte|say)\w*(?:\s+hain)?)\b/i;
const NEG_AFTER = /^[^\p{L}\p{N}]*(?:\S+\s+){0,3}?(?:nahi|nahin|nhi|mat)\b/iu;
function negated(text: string, index: number, length: number) {
  const before = text.slice(Math.max(0, index - 80), index);
  const clause = before.split(/[.,;:!?\n]|\b(?:but|par|lekin|magar)\b/i).pop() || "";
  if (NEG_BEFORE.test(clause.trim().split(/\s+/).slice(-6).join(" "))) return true;
  const after = (text.slice(index + length, index + length + 40).split(/[.,;:!?\n]/)[0] || "");
  return NEG_AFTER.test(after);
}

export function checkText(text: string, niche: Niche): Check {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const r of RULES) {
    if (r.niches && !r.niches.includes(niche)) continue;
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(text))) {
      if (!m[0]) {
        r.re.lastIndex++;
        continue;
      }
      if (negated(text, m.index, m[0].length)) continue;
      const key = `${r.rule}|${m[0].toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ level: r.level, rule: r.rule, match: m[0].trim(), fix: r.fix, ...(r.soft ? { soft: true } : {}) });
      }
      if (!r.re.global) break;
    }
  }
  // One note per phrase: a "check" note on the same words as a blocking one adds nothing, and a shorter match inside a
  // longer one at the same level or above ("will hit 1" inside "Bitcoin will hit 1 lakh") is the same finding.
  const rank = (i: Issue) => (i.level === "block" ? 2 : 1);
  const low = (i: Issue) => i.match.toLowerCase();
  const kept = issues.filter(
    (i) =>
      !issues.some((j) => j !== i && rank(j) >= rank(i) && low(j) !== low(i) && low(j).includes(low(i))) &&
      !(i.level === "warn" && issues.some((j) => j.level === "block" && (low(j).includes(low(i)) || low(i).includes(low(j))))),
  );
  const status = kept.some((i) => i.level === "block") ? "block" : kept.length ? "warn" : "ok";
  return { status, issues: kept };
}

export type ScriptText = { title?: string | null; hook?: string; body?: string; cta?: string; caption?: string; hashtags?: string | null; linkedin?: string | null; onScreen?: { text: string }[] };

/**
 * Checks every word that will be said, shown or posted: the title (it becomes the LinkedIn video title), hashtags and
 * the LinkedIn text too. The disclaimer is added at posting time, so it isn't checked here.
 */
export function checkScript(s: ScriptText, niche: Niche): Check {
  // Hashtags are read as words: "#10xReturns" → "10x Returns".
  const tags = (s.hashtags || "").replace(/#/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/(\d)([xX×])([A-Z])/g, "$1$2 $3");
  const text = [s.title, s.hook, s.body, s.cta, s.caption, tags, s.linkedin, ...(s.onScreen || []).map((o) => o.text)].filter(Boolean).join("\n");
  return checkText(text, niche);
}

/** The caption that actually goes out: what was written + the speaker's disclaimer, once. */
export function finalCaption(caption: string, hashtags: string | null | undefined, disclaimer: string | null | undefined, link?: string | null) {
  let out = caption.trim();
  if (link) out += `\n\n${link}`;
  if (hashtags && hashtags.trim()) out += `\n\n${hashtags.trim()}`;
  if (disclaimer && !out.includes(disclaimer.trim())) out += `\n\n${disclaimer.trim()}`;
  return out;
}
