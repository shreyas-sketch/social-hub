import { checkText } from "@/lib/compliance";
/**
 * Loads the five speakers from the Social Hub Blueprint (4 Nov 2026):
 * direction, audience, lanes, stop lists, bios, disclaimers, known accounts and the watchlist.
 *
 * Safe to run again: it only adds what's missing and never overwrites edits made in the app.
 * Run: npm run seed
 */
import { db, one, run, now } from "./index";

type Acc = { platform: "instagram" | "facebook" | "youtube" | "linkedin" | "x"; handle?: string; url?: string; exists: boolean };
type Ref = { name: string; platform: "instagram" | "youtube" | "linkedin"; handle?: string; channelId?: string; note: string; active?: boolean };

const CRYPTO_CAPTION =
  "Crypto products and NFTs are unregulated and can be highly risky. There may be no regulatory recourse for any loss from such transactions. This video is for education only and is not financial advice.";
const MARKET_CAPTION =
  "For education only — not investment advice or a recommendation to buy or sell any security. Investments in the securities market are subject to market risks. Any market data shown is at least 30 days old.";

const SPEAKERS: {
  slug: string;
  name: string;
  niche: string;
  direction: string;
  audience: string;
  bio: string;
  voice: string;
  programUrl: string;
  captionDisclaimer: string | null;
  screenDisclaimer: string | null;
  captionStyle: "bold_pop" | "clean" | "none";
  lanes: { key: string; name: string; desc: string; share: number }[];
  stop: string[];
  accounts: Acc[];
  refs: Ref[];
}[] = [
  {
    slug: "deepak",
    name: "Deepak Choudhary",
    niche: "crypto",
    direction:
      "Crypto for people who have never bought it. Plain explainers and scam safety, so a careful first-timer learns it properly before putting in a rupee. Education, never tips.",
    audience:
      "A 35–60 salaried professional or business owner who has never bought crypto (62% of his Action Program buyers never had). Worried about scams and whether crypto is legal in India.",
    bio: "Crypto for people who've never bought it. Learn it properly before you put in a rupee. 7+ years in crypto · 1,000+ learners. No tips, no 10X promises.",
    voice: "Calm, patient teacher. Explains one idea at a time with everyday Indian examples. No hype, no shouting. 7+ years in crypto, 1,000+ learners.",
    programUrl: "https://choudharydeepak.com/",
    captionDisclaimer: CRYPTO_CAPTION,
    screenDisclaimer: "Crypto is unregulated & risky. Education only, not advice.",
    captionStyle: "bold_pop",
    lanes: [
      { key: "plain_english", name: "Crypto in plain English", desc: "What Bitcoin, blockchain and stablecoins really are. Halving, the 21 million cap, how a wallet works.", share: 40 },
      { key: "safety", name: "Safety", desc: "Scams, fake platforms, wallet mistakes, words that expose a scam.", share: 35 },
      { key: "rules_tax", name: "Rules and tax in India", desc: "Crypto tax, TDS, what is legal, how to report — explained as education.", share: 25 },
    ],
    stop: [
      "Airdrop farming or free-money videos",
      "Return or price promises (₹10,000 into ₹1 lakh, 100x coins, Ethereum to $10,000)",
      "What I'd buy / which coin to buy",
      "Stocks and trading (that's Siddharth's lane)",
    ],
    accounts: [
      { platform: "instagram", handle: "@cryptowithdeepak", url: "https://www.instagram.com/cryptowithdeepak/", exists: true },
      { platform: "facebook", exists: false },
      { platform: "youtube", handle: "@Blockchainwithdeepak", url: "https://www.youtube.com/@Blockchainwithdeepak", exists: true },
      { platform: "linkedin", exists: false },
      { platform: "x", exists: false },
    ],
    refs: [
      { name: "Pushpendra Singh Digital", platform: "youtube", handle: "@pushpendrasinghdigital", note: "India crypto education, Hindi · ~379K subs (CreatorDB, Jul 2026)" },
      { name: "Coin Bureau", platform: "youtube", handle: "@CoinBureau", note: "Calm, no-hype explainer tone (global)" },
      { name: "CA Rahul Gupta", platform: "instagram", handle: "ca_rahul_gupta_rvg", note: "Crypto tax, TDS and GST — the rules and tax lane · ~58K (Modash, Oct 2026)" },
      { name: "CyberDost (I4C, Govt of India)", platform: "youtube", channelId: "UCwNX6q3b_9mtKldvGoZZ7Gw", note: "Government cyber-fraud awareness: fake apps, investment scams" },
      { name: "Bitcoin Expert India", platform: "youtube", channelId: "UCr8uEbKAxiX0dVDejI0nufw", note: "Bitcoin basics in Hindi · recent uploads lean to market talk — borrow formats only" },
      { name: "Crypto With Kiran", platform: "youtube", handle: "@cryptowithkiran", note: "Fundamentals and risk, 'free from hype' · small channel" },
      { name: "Coffeezilla", platform: "youtube", handle: "@Coffeezilla", note: "Investigates crypto scams — safety lane (global)" },
      { name: "Kitboga", platform: "youtube", channelId: "UCm22FAXZMw1BaWeFszZxUKw", note: "Scam calls exposed live — how scams sound (global)" },
      { name: "Whiteboard Crypto", platform: "youtube", handle: "@whiteboardcrypto", note: "Animated plain-English explainers (global)" },
      { name: "Crypto Casey", platform: "youtube", channelId: "UCi7RBPfTtRkVchV6qO8PUzg", note: "Slow, beginner wallet and security tutorials (global)" },
      { name: "Simply Explained", platform: "youtube", handle: "@simplyexplained", note: "Calm 'how blockchain works' explainers (global)" },
    ],
  },
  {
    slug: "aarzoo",
    name: "Aarzoo Shah",
    niche: "psychology",
    direction:
      "She is a qualified psychologist and stays on psychology: why people do what they do, at home, at work and in their own head. Leadership and communication blend in as a smaller part. No finance or wealth content — her finance funnel is stopping.",
    audience:
      "People who want to understand why they and others behave the way they do. The smaller work lane speaks to her Leadership buyer: a 40–52 senior manager, technically strong, who isn't being heard at work (mostly men).",
    bio: "Psychologist. Why people do what they do, at home, at work and in your own head. Real patterns, explained simply. 1M+ people reached.",
    voice: "Warm, clear psychologist. Names the pattern, explains the brain science simply, gives one thing to try. Never diagnoses the viewer.",
    programUrl: "https://aarzooshah.com/",
    captionDisclaimer: "General education, not therapy or a diagnosis. If you're struggling, please speak to a qualified professional.",
    screenDisclaimer: null,
    captionStyle: "clean",
    lanes: [
      { key: "why_we_do", name: "Why we do what we do", desc: "Overthinking, people-pleasing, self-doubt, habits — explained through the brain.", share: 40 },
      { key: "patterns", name: "Patterns in people", desc: "What a behaviour usually means, told through anonymised cases shared with consent.", share: 30 },
      { key: "psych_at_work", name: "Psychology at work", desc: "Freezing in meetings, being passed over, speaking with confidence. Bridges to her Leadership and Communication program; leads on LinkedIn.", share: 30 },
    ],
    stop: ["Any wealth or finance content", "Women-only framing on the main account", "Diagnosing the viewer", "Client names or identifiable details"],
    accounts: [
      { platform: "instagram", handle: "@aarzooshahk", url: "https://www.instagram.com/aarzooshahk/", exists: true },
      { platform: "facebook", exists: false },
      { platform: "youtube", exists: false },
      { platform: "linkedin", handle: "aarzoo-shah", url: "https://www.linkedin.com/in/aarzoo-shah", exists: true },
      { platform: "x", exists: false },
    ],
    refs: [
      { name: "Dr Julie Smith", platform: "instagram", handle: "drjulie", note: "Closest model for her format · ~2.2M (CreatorDB, Sep 2026)" },
      { name: "Dr Yogendra Singh Rathore", platform: "instagram", handle: "ysr_official", note: "Indian psychologist, emotions and the brain · ~1.1M (Qoruz, Nov 2026)" },
      { name: "Dr Siddharth Warrier", platform: "youtube", channelId: "UCR_Tzu1r5M9uoNB3CF4Zg3g", note: "Neurologist on behaviour change (India)" },
      { name: "Dr Tracey Marks", platform: "youtube", channelId: "UCL2QpphEeZFYwk6-WXD6hpA", note: "Psychiatrist; calm clinical videos on overthinking — closest format" },
      { name: "Dr Kashika Jain", platform: "youtube", channelId: "UC5wkd9g3tcTf6Dyzx62NtIg", note: "Indian psychologist, Hindi videos on worry and behaviour · ~891K" },
      { name: "Mel Robbins", platform: "instagram", handle: "melrobbins", note: "Self-doubt, habits, confidence — plain-spoken short clips" },
      { name: "Andrew Huberman", platform: "instagram", handle: "hubermanlab", note: "The brain behind a behaviour; mostly male audience" },
      { name: "Himeesh Madaan", platform: "youtube", handle: "@himeeshmadaan", note: "Hindi mindset coach (not a psychologist) — shows Indian demand for her topics" },
      { name: "Gaur Gopal Das", platform: "instagram", handle: "gaurgopaldas", note: "Story-led behaviour lessons watched by Indian corporate men" },
      { name: "Vinh Giang", platform: "youtube", channelId: "UC9K9Wnz6t4cLnCdTzAVrXqQ", note: "Work side: voice and presence, not being heard in meetings" },
      { name: "Jefferson Fisher", platform: "instagram", handle: "jefferson_fisher", note: "Work side: calm, firm hard conversations; big male professional audience" },
      { name: "Simon Sinek", platform: "youtube", handle: "@simonsinek", note: "Work side: leadership and trust in senior managers' language" },
      { name: "Alexander Lyon", platform: "youtube", channelId: "UCie09bMB6ITYmpU3z6vv2tw", note: "Work side: communication professor teaching managers to speak up" },
      { name: "Divija Bhasin", platform: "instagram", handle: "awkwardgoat3", note: "Relatable tone only; audience skews young and female", active: false },
      { name: "Abhijeet Satani", platform: "instagram", note: "Neuroscience in plain English — no handle found; ask Aarzoo for his link", active: false },
    ],
  },
  {
    slug: "siddharth",
    name: "Siddharth Kapoor",
    niche: "finance_trading",
    direction:
      "Personal finance and trading together, for people with a full-time job. Personal finance pulls the bigger audience; trading with rules and backtests is where they convert to the Algo program. Rules, not tips.",
    audience:
      "A 35–55 salaried professional with a day job who invests sometimes, has lost money to emotion or tips, and has about an hour a day. Wants his money to work, and a trading system, not calls.",
    bio: "Personal finance and trading for people with a full-time job. Protect your capital first. Rules, not tips. 2,300+ traders trained.",
    voice: "Straight-talking, practical. Uses salary and EMI examples from Indian households. Ends stories on discipline. 2,300+ traders trained.",
    programUrl: "https://siddharthkapoor.in/",
    captionDisclaimer: MARKET_CAPTION,
    screenDisclaimer: "Education only. Not investment advice.",
    captionStyle: "bold_pop",
    lanes: [
      { key: "money_basics", name: "Money basics for earners", desc: "Where the salary goes, EMIs, emergency funds, idle money, inflation. No fund picks.", share: 40 },
      { key: "trading_with_job", name: "Trading with a job", desc: "Why part-time traders lose money, and how rules and backtests fix it. Market data at least 30 days old.", share: 35 },
      { key: "money_stories", name: "Business and money stories", desc: "Company and money stories (the format that already pulls views), each ending on discipline.", share: 25 },
    ],
    stop: ["Stock targets and calls (e.g. 'could jump 33%')", "Daily market news with current prices (SEBI 30-day rule)", "Stock or fund tips of any kind", "Return promises"],
    accounts: [
      { platform: "instagram", handle: "@siddharthkapoorai", url: "https://www.instagram.com/siddharthkapoorai/", exists: true },
      { platform: "facebook", exists: false },
      { platform: "youtube", handle: "@Tradeupwithsid", url: "https://www.youtube.com/@Tradeupwithsid", exists: true },
      { platform: "linkedin", exists: false },
      { platform: "x", exists: false },
    ],
    refs: [
      { name: "Zero1 by Zerodha", platform: "youtube", handle: "@zero1byzerodha", note: "Money through stories and pop culture · ~856K (vidIQ, Oct 2026)" },
      { name: "Zerodha", platform: "youtube", channelId: "UC59YUBhNLMkS2Q8NBWBGHAA", note: "Zerodha's main channel (@zerodhaonline)" },
      { name: "Varsity by Zerodha", platform: "youtube", channelId: "UCQXwgooTlP6tk2a-u6vgyUA", note: "The safe standard for how trading lessons sound" },
      { name: "CA Rachana Ranade", platform: "youtube", channelId: "UCe3qdG0A_gr-sEdat5y2twQ", note: "Calm, education-first personal finance" },
      { name: "Labour Law Advisor", platform: "youtube", handle: "@LabourLawAdvisor", note: "Salary, EPF, tax, insurance mis-selling — right on target for salaried 35–55" },
      { name: "Ankur Warikoo", platform: "instagram", handle: "ankurwarikoo", note: "Money basics for earners; strongest reel views on the list" },
      { name: "Pranjal Kamra", platform: "youtube", handle: "@pranjalkamra", note: "Investing basics in plain Hindi — copy the format, not the picks" },
      { name: "Asset Yogi", platform: "youtube", channelId: "UCsNxHPbaCWL1tKw2hxGQD6g", note: "EMIs, loans, tax, FD vs mutual funds" },
      { name: "Think School", platform: "youtube", channelId: "UCKZozRVHRYsYHGEyNKuhhdA", note: "Business and money stories lane" },
      { name: "Shankar Nath", platform: "youtube", channelId: "UCtnItzU7q_bA1eoEBjqcVrw", note: "Ex-corporate; data-led, rules-based investing for people with jobs" },
      { name: "Vivek Bajaj", platform: "youtube", handle: "@VivekBajaj", note: "Trading process, risk and backtests" },
      { name: "Humphrey Yang", platform: "instagram", handle: "humphreytalks", note: "Short money basics with simple visuals (global)" },
      { name: "The Plain Bagel", platform: "youtube", handle: "@theplainbagel", note: "CFA, calm, anti-hype: why following tips fails (global)" },
      { name: "Ramit Sethi", platform: "youtube", handle: "@ramitsethi", note: "Money systems and spending rules for earners (global)" },
    ],
  },
  {
    slug: "akshat",
    name: "Akshat Dani",
    niche: "business_consulting",
    direction:
      "Two buyers. Business owners who want a business that runs without them (Business AI), and senior professionals turning 20 years of experience into a consulting practice. Background: entrepreneur with 13+ years building and scaling businesses, across a ₹100+ Cr combined portfolio in finance, AI and consulting.",
    audience:
      "Owner around 45 with a ₹50 L–5 Cr manufacturing, construction or services business, 10–50 staff, running on Excel, Tally and WhatsApp, where everything depends on him. And: a 50+ professional with 20+ years in a job who wants to consult but doesn't know how to get clients.",
    bio: 'I help owners build a business that runs without them, and senior professionals turn 20 years into a consulting practice. DM "SCALE".',
    voice: "Confident operator, talks peer to peer with owners and senior people. Specific numbers and real situations, no motivation talk.",
    programUrl: "https://businessaiblueprint.net/business-ai",
    captionDisclaimer: "Examples are illustrative; results depend on your business and effort.",
    screenDisclaimer: null,
    captionStyle: "bold_pop",
    lanes: [
      { key: "owner_stuck", name: "The owner stuck inside the business", desc: "Firefighting, hiring, cash flow, 'are you building a bigger job?'.", share: 40 },
      { key: "experience_money", name: "Your experience is worth money", desc: "First clients after a long career, pricing, picking a niche. The 46K-view lane.", share: 35 },
      { key: "real_businesses", name: "Real businesses, explained", desc: "Stories of ₹1–10 Cr companies, in the ITC-style format that already works for him.", share: 25 },
    ],
    stop: ["Home-business ideas (mushroom rooms, paper bags, honey)", "Side-hustle or pre-revenue founder content", "Income promises", "Passive-income or zero-investment hooks"],
    accounts: [
      { platform: "instagram", handle: "@akshatdani_", url: "https://www.instagram.com/akshatdani_/", exists: true },
      { platform: "facebook", exists: false },
      { platform: "youtube", handle: "@akshatdani", url: "https://www.youtube.com/@akshatdani", exists: true },
      { platform: "linkedin", exists: false },
      { platform: "x", exists: false },
    ],
    refs: [
      { name: "Sandeep Das", platform: "instagram", handle: "sandeepdasauthor", note: "Ex-PwC director, IIM-B, author — the Consulting competitor in the buyer file" },
      { name: "Sandeep Das (YouTube)", platform: "youtube", channelId: "UCXSMLKi8k62-XvEQ0RiZXHQ", note: "IIM faculty and bestselling author — consulting, storytelling, negotiation" },
      { name: "Sandeep Das (LinkedIn)", platform: "linkedin", handle: "sandeep-das-1b343719", note: "His main professional channel — for the team to read; the hub can't" },
      { name: "Rajiv Talreja", platform: "instagram", handle: "rajivtalreja", note: "Same buyer as Business AI · ~409K YouTube" },
      { name: "Rajiv Talreja (YouTube)", platform: "youtube", channelId: "UCYEtmpGBd3jEO1A8sJ4OEMg", note: "Same buyer as Business AI" },
      { name: "Sarthak Ahuja", platform: "instagram", handle: "casarthakahuja", note: "Short, sharp business reels" },
      { name: "Swastik Nandakumar", platform: "youtube", channelId: "UCWZM6eBSsb4iDmyeE-PfSFQ", note: "Daily numbered one-line truths for founders" },
      { name: "CA Rahul Malodia", platform: "youtube", channelId: "UCPgfM-dk3XAb4T3DtT6Nwsw", note: "Coaches Indian MSME owners on systems and scaling · ~6.9M" },
      { name: "Rahul Jain (Business Coaching India)", platform: "youtube", channelId: "UCUVY_WsSNRl3FWjFzEMMqDQ", note: "'Business on autopilot': SOPs, delegation" },
      { name: "Suresh Mansharamani", platform: "instagram", handle: "sureshmansharamani", note: "OKRs and scaling for SME owners" },
      { name: "Think School", platform: "youtube", channelId: "UCKZozRVHRYsYHGEyNKuhhdA", note: "Best Indian 'real businesses explained' format" },
      { name: "Dan Martell", platform: "instagram", handle: "danmartell", note: "Getting the owner out of operations (global)" },
      { name: "Leila Hormozi", platform: "instagram", handle: "leilahormozi", note: "Hiring, managers, people systems (global)" },
      { name: "Codie Sanchez", platform: "instagram", handle: "codiesanchez", note: "Real 'boring' small businesses with their numbers (global)" },
      { name: "Consulting Success (Michael Zipursky)", platform: "youtube", channelId: "UCcZvQqRud5hOIfHt62vpGmA", note: "First clients, pricing, niche for experienced consultants" },
      { name: "Mettas Club (Dr Amit Maheshwari)", platform: "youtube", channelId: "UC6nCMhA2hqyw6Xa3RYkVoaA", note: "Hindi business training for owners — weaker fit", active: false },
    ],
  },
  {
    slug: "chirag",
    name: "Chirag Jhumkhawala",
    niche: "business_ai",
    direction:
      "Business AI, hands-on. Chirag shows the tools doing real work for an Indian business; Akshat covers the thinking, so the two don't repeat each other.",
    audience: "The same owner as Akshat: ₹50 L–5 Cr business, 10–50 staff, running on Excel, Tally and WhatsApp.",
    bio: "AI for Indian business owners. Get your business off Excel, Tally and WhatsApp. Worked with BSE, HDFC and Thomas Cook.",
    voice: "Practical builder. Shows the screen, names the tool and the task, says what it costs and what it can't do. Check client names with him before use.",
    programUrl: "https://www.blackelephant.in/cj",
    captionDisclaimer: null,
    screenDisclaimer: null,
    captionStyle: "bold_pop",
    lanes: [
      { key: "tool_demo", name: "One tool, one task", desc: "Shown on screen: AI answering WhatsApp leads, reading invoices, chasing payments.", share: 50 },
      { key: "before_after", name: "Before and after", desc: "One owner's real process, done by hand and then automated.", share: 30 },
      { key: "ai_myths", name: "AI myths for owners", desc: "What AI can't do, and what it really costs.", share: 20 },
    ],
    stop: ["Data-science careers for freshers", "Legal AI (Grayscope) on these accounts", "'Learn ChatGPT' beginner content", "Income promises"],
    accounts: [
      { platform: "instagram", handle: "@chirag_j912", url: "https://www.instagram.com/chirag_j912/", exists: true },
      { platform: "facebook", exists: false },
      { platform: "youtube", exists: false },
      { platform: "linkedin", handle: "chiragjhumkhawala", url: "https://www.linkedin.com/in/chiragjhumkhawala/", exists: true },
      { platform: "x", handle: "@chirag912", url: "https://x.com/chirag912", exists: true },
    ],
    refs: [
      { name: "Lakshit Ukani", platform: "youtube", handle: "@lakshit-ukani", note: "WhatsApp AI agents and n8n for real Indian businesses, with ₹ costs" },
      { name: "Rishi Jain", platform: "instagram", handle: "rrishijain", note: "60-second AI tool demos tied to cost per lead and time saved" },
      { name: "Varun Mayya", platform: "instagram", handle: "thevarunmayya", note: "What AI means for Indian founders (commentary)" },
      { name: "Vaibhav Sisinty", platform: "instagram", handle: "vaibhavsisinty", note: "AI tools for Indian businesses — check for course-selling hype" },
      { name: "Sorav Jain", platform: "instagram", handle: "soravjain", note: "AI-driven marketing for Indian businesses (partial fit)" },
      { name: "Rajiv Talreja", platform: "instagram", handle: "rajivtalreja", note: "Same buyer" },
      { name: "Nate Herk", platform: "youtube", handle: "@nateherk", note: "Practical n8n agents for business processes (global)" },
      { name: "Leila Gharani", platform: "youtube", handle: "@leilagharani", note: "Excel + AI automation — close to the Tally/Excel angle" },
      { name: "Mark Kashef", platform: "youtube", handle: "@mark_kashef", note: "'Practical AI, without the hype' business builds" },
      { name: "Bart Slodyczka", platform: "youtube", channelId: "UC8F7X90NDmMr1mGx8897r_A", note: "Invoices on WhatsApp read by AI and filed — a direct demo match" },
      { name: "Corey Ganim", platform: "youtube", handle: "@coreyganim", note: "Live AI builds for owners of existing businesses — handle unverified" },
    ],
  },
];

function seed() {
  db();
  let added = 0;
  for (const s of SPEAKERS) {
    let sp = one<{ id: number }>(`SELECT id FROM speakers WHERE slug = ?`, [s.slug]);
    if (!sp) {
      const r = run(
        `INSERT INTO speakers (slug, name, niche, direction, audience, bio, lanes, stop_list, voice_notes, program_url, caption_disclaimer, screen_disclaimer, caption_style, scripts_per_day, active, created_at)
         VALUES (@slug, @name, @niche, @direction, @audience, @bio, @lanes, @stop, @voice, @url, @cd, @sd, @style, 3, 1, @at)`,
        {
          slug: s.slug,
          name: s.name,
          niche: s.niche,
          direction: s.direction,
          audience: s.audience,
          bio: s.bio,
          lanes: JSON.stringify(s.lanes),
          stop: JSON.stringify(s.stop),
          voice: s.voice,
          url: s.programUrl,
          cd: s.captionDisclaimer,
          sd: s.screenDisclaimer,
          style: s.captionStyle,
          at: now(),
        },
      );
      sp = { id: Number(r.lastInsertRowid) };
      added++;
    }
    for (const a of s.accounts) {
      if (one(`SELECT id FROM accounts WHERE speaker_id = ? AND platform = ?`, [sp.id, a.platform])) continue;
      run(`INSERT INTO accounts (speaker_id, platform, handle, url, status, meta, created_at) VALUES (?, ?, ?, ?, ?, '{}', ?)`, [
        sp.id,
        a.platform,
        a.handle ?? null,
        a.url ?? null,
        a.exists ? "not_connected" : "missing",
        now(),
      ]);
    }
    for (const r of s.refs) {
      if (one(`SELECT id FROM refs WHERE speaker_id = ? AND name = ?`, [sp.id, r.name])) continue;
      const url =
        r.platform === "youtube"
          ? r.channelId
            ? `https://www.youtube.com/channel/${r.channelId}`
            : `https://www.youtube.com/${r.handle}`
          : r.platform === "linkedin"
            ? `https://www.linkedin.com/in/${r.handle}/`
            : r.handle
              ? `https://www.instagram.com/${r.handle}/`
              : null;
      run(`INSERT INTO refs (speaker_id, name, platform, handle, url, external_id, note, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        sp.id,
        r.name,
        r.platform,
        r.handle ?? null,
        url,
        r.channelId ?? null,
        r.note,
        r.active === false ? 0 : 1,
        now(),
      ]);
    }
  }
  seedV13();
  seedWatch();
  seedPlaybook();
  console.log(`Seeded. ${added} new speaker(s); accounts, watchlists, trend pool, teachers, playbook, text-post numbers and draft DM keywords filled in where missing.`);
}

/* ───────── v1.2: trend pool and teachers (researched 5 Nov 2026; counts are third-party estimates) ───────── */

type W = { kind: "trend" | "teacher"; name: string; platform: "instagram" | "youtube"; handle?: string; channelId?: string; language?: string; note: string };

const WATCH: W[] = [
  // Teachers: people who teach what's working on social media right now.
  { kind: "teacher", name: "Adam Mosseri (Head of Instagram)", platform: "instagram", handle: "mosseri", note: "Official word on how Instagram ranks reels" },
  { kind: "teacher", name: "Brock Johnson", platform: "instagram", handle: "brock11johnson", note: "Instagram growth for business owners, trial reels" },
  { kind: "teacher", name: "Kallaway", platform: "youtube", handle: "@kallawaymarketing", note: "Hooks and script structure" },
  { kind: "teacher", name: "Kallaway (Instagram)", platform: "instagram", handle: "kallaway", note: "Hooks and script structure" },
  { kind: "teacher", name: "Jenny Hoyos", platform: "youtube", handle: "@jennyhoyos", note: "Shorts retention, length and endings (her feed is entertainment; the lessons travel)" },
  { kind: "teacher", name: "Chris Do", platform: "instagram", handle: "thechrisdo", note: "Personal brand for experts; older professional tone" },
  { kind: "teacher", name: "Colin and Samir", platform: "youtube", handle: "@colinandsamir", note: "Creator strategy; interviews with people like Paddy Galloway" },
  { kind: "teacher", name: "Siddharth Rajsekar", platform: "instagram", handle: "siddharthrajsekar", note: "Coaches and experts building a knowledge business in India — closest to our buyers" },
  { kind: "teacher", name: "Vaibhav Sisinty", platform: "instagram", handle: "vaibhavsisinty", note: "AI plus personal brand for Indian professionals" },
  { kind: "teacher", name: "Ishan Sharma", platform: "youtube", handle: "@ishansharma7390", note: "Business, AI and personal brand (audience leans young)" },
  // Trend pool: popular creators outside our niches — borrow the format, never the topic.
  { kind: "trend", name: "Raj Shamani", platform: "instagram", handle: "rajshamani", language: "Hinglish", note: "Podcast clip opens on the guest's most surprising line" },
  { kind: "trend", name: "Ankur Warikoo", platform: "instagram", handle: "ankurwarikoo", language: "English/Hinglish", note: "Numbered 'things I wish I knew' lists to camera" },
  { kind: "trend", name: "Varun Mayya", platform: "instagram", handle: "thevarunmayya", language: "English", note: "Newsreader 'this just happened' hook over screen recordings" },
  { kind: "trend", name: "Abhi and Niyu", platform: "instagram", handle: "abhiandniyu", language: "English", note: "Two hosts trade 'did you know' facts — fast pace" },
  { kind: "trend", name: "Nikhil Kamath", platform: "instagram", handle: "nikhilkamathcio", language: "English", note: "Long podcast cut to one blunt question" },
  { kind: "trend", name: "Dr Pal", platform: "youtube", handle: "@DrPal", language: "English", note: "Doctor's myth-vs-fact with comic timing" },
  { kind: "trend", name: "Think School", platform: "youtube", channelId: "UCKZozRVHRYsYHGEyNKuhhdA", language: "English", note: "'Why did X fail?' case studies with proof on screen" },
  { kind: "trend", name: "Sarthak Ahuja", platform: "instagram", handle: "casarthakahuja", language: "English", note: "'How does X make money?' whiteboard breakdowns (skip his finance clips)" },
  { kind: "trend", name: "Humans of Bombay", platform: "instagram", handle: "officialhumansofbombay", language: "English", note: "First-person story with an emotional first line" },
  { kind: "trend", name: "Nitish Rajput", platform: "youtube", handle: "@NitishRajput", language: "Hindi", note: "Documentary style: question hook, voiceover, archive clips (filter political topics)" },
  { kind: "trend", name: "Samdish (Unfiltered)", platform: "youtube", handle: "@UNFILTEREDbySamdish", language: "Hinglish", note: "Unscripted interviews; opens on the most candid answer" },
  { kind: "trend", name: "MrBeast", platform: "youtube", handle: "@mrbeast", language: "English", note: "Stakes in the first 2 seconds, no dead air" },
  { kind: "trend", name: "Alex Hormozi", platform: "instagram", handle: "hormozi", language: "English", note: "One contrarian line, bold word-by-word captions, many clips from one talk" },
  { kind: "trend", name: "Mel Robbins", platform: "instagram", handle: "melrobbins", language: "English", note: "Named tool + 'here's what to do when…' — close to a 35–55 audience" },
  { kind: "trend", name: "Simon Squibb", platform: "instagram", handle: "simonsquibb", language: "English", note: "Street question 'what's your dream?'; three stacked hooks" },
  { kind: "trend", name: "Jay Shetty", platform: "instagram", handle: "jayshetty", language: "English", note: "Story voiceover ending on a one-line lesson" },
  { kind: "trend", name: "The Diary Of A CEO", platform: "youtube", handle: "@thediaryofaceo", language: "English", note: "Cold open on the guest's warning line" },
  { kind: "trend", name: "Cleo Abram", platform: "youtube", handle: "@cleoabram", language: "English", note: "'Huge if true' — one question answered fast with visuals" },
  { kind: "trend", name: "Zack D. Films", platform: "youtube", channelId: "UCvz84_Q0BbvZThy75mbd-Dg", language: "No speech", note: "3D 'what happens if…' scenarios" },
  { kind: "trend", name: "Codie Sanchez", platform: "instagram", handle: "codiesanchez", language: "English", note: "'Boring business' stories on location, contrarian opener" },
  { kind: "trend", name: "Dr Karan Rajan", platform: "instagram", handle: "drkaranrajan", language: "English", note: "60-second myth-busting with props and diagrams" },
  { kind: "trend", name: "Nas Daily", platform: "instagram", handle: "nasdaily", language: "English", note: "1-minute story: a caption on every line, same sign-off" },
  { kind: "trend", name: "Ali Abdaal", platform: "instagram", handle: "aliabdaal", language: "English", note: "Names the viewer in the hook: 'If you're ambitious but…'" },
];

/**
 * v1.3 starting points, only where nothing is set yet:
 * text posts a day (LinkedIn first for Akshat, Chirag and Aarzoo, per the research), weekly targets that differ
 * from the planner's defaults, and a draft comment-to-DM keyword per speaker (off until an owner or admin switches it on).
 */
const V13: Record<string, { text: { linkedin: number; x: number }; cadence?: Record<string, number>; keyword: string; message: string }> = {
  deepak: { text: { linkedin: 0, x: 1 }, cadence: { linkedin: 2 }, keyword: "WEBINAR", message: "Hi! Here's the link to my ₹99 crypto webinar: {link}\n\nIt's about how crypto works and how to stay safe. Education only — no calls on what to buy." },
  aarzoo: { text: { linkedin: 1, x: 1 }, keyword: "WEBINAR", message: "Hi! Here's the link to my ₹99 webinar: {link}\n\nSee you there." },
  siddharth: { text: { linkedin: 0, x: 1 }, cadence: { linkedin: 2 }, keyword: "WEBINAR", message: "Hi! Here's the link to my ₹99 webinar: {link}\n\nEducation only — no calls on what to buy or sell." },
  akshat: { text: { linkedin: 1, x: 1 }, keyword: "SCALE", message: "Hi! Here's the link to the ₹99 webinar: {link}\n\nIt's for owners who want the business to run without them." },
  chirag: { text: { linkedin: 1, x: 1 }, keyword: "WEBINAR", message: "Hi! Here's the link to my ₹99 Business AI webinar: {link}\n\nI show the tools doing real work on screen." },
};

function seedV13() {
  for (const [slug, v] of Object.entries(V13)) {
    const sp = one<any>(`SELECT id, niche, text_per_day, cadence FROM speakers WHERE slug = ?`, [slug]);
    if (!sp) continue;
    if (sp.text_per_day == null) run(`UPDATE speakers SET text_per_day = ? WHERE id = ?`, [JSON.stringify(v.text), sp.id]);
    if (sp.cadence == null && v.cadence) run(`UPDATE speakers SET cadence = ? WHERE id = ?`, [JSON.stringify(v.cadence), sp.id]);
    if (!one(`SELECT id FROM dm_rules WHERE speaker_id = ?`, [sp.id])) {
      run(`INSERT INTO dm_rules (speaker_id, keyword, message, status, compliance, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)`, [sp.id, v.keyword, v.message, JSON.stringify(checkText(v.message, sp.niche)), now(), now()]);
    }
  }
}

function seedWatch() {
  for (const w of WATCH) {
    const dup = one(`SELECT id FROM watch_sources WHERE kind = ? AND platform = ? AND (lower(COALESCE(handle,'')) = lower(?) OR COALESCE(external_id,'') = ?)`, [
      w.kind, w.platform, w.handle || "\u0000", w.channelId || "\u0000",
    ]);
    if (dup) continue;
    const url = w.platform === "youtube" ? (w.channelId ? `https://www.youtube.com/channel/${w.channelId}` : `https://www.youtube.com/${w.handle}`) : `https://www.instagram.com/${w.handle}/`;
    run(`INSERT INTO watch_sources (kind, name, platform, handle, external_id, url, note, language, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, [
      w.kind, w.name, w.platform, w.handle ?? null, w.channelId ?? null, url, w.note, w.language ?? null, now(),
    ]);
  }
}

/* ───────── v1.2: the starting playbook (from the platforms and the teachers; switched on, each can be switched off) ───────── */

type R = { scope: string; rule: string; why: string; kind: "official" | "teacher"; source: string; url: string; date: string; status?: "active" | "proposed" };

const RULES: R[] = [
  { kind: "official", scope: "instagram", rule: "Make every reel worth sending to one specific person: a warning, a checklist, or a 'you need to see this'.", why: "Sends per reach is Instagram's strongest signal for reaching non-followers; likes matter more with followers.", source: "Adam Mosseri via Social Media Today", url: "https://www.socialmediatoday.com/news/instagram-shares-algorithm-insights-2025/738034/", date: "Jan 2025" },
  { kind: "official", scope: "instagram", rule: "Win the first 3 seconds: the spoken hook, the on-screen text and the picture all say the same thing from the first frame.", why: "Instagram now reports skip rate — the % who swipe away in the first 3 seconds.", source: "Instagram via Social Media Today", url: "https://www.socialmediatoday.com/news/instagram-adds-retention-insights-reels/758464/", date: "Aug 2025" },
  { kind: "official", scope: "instagram", rule: "At most 5 hashtags; put the words people search for in the caption and the on-screen text.", why: "Instagram caps hashtags at 5 and says fewer, more targeted tags work better.", source: "Instagram via Business Today", url: "https://www.businesstoday.in/technology/news/story/no-more-hashtag-stuffing-instagram-limits-hashtag-usage-to-just-5-per-reel-and-post-507444-2025-12-19", date: "Dec 2025" },
  { kind: "official", scope: "all", rule: "Only original footage: no reposted clips, no other creators' footage or watermarks; anything borrowed gets the speaker's own voice and point.", why: "Instagram, YouTube and Facebook all cut reach for reposted or lightly edited content (2025–2026).", source: "Instagram via Tubefilter", url: "https://tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator", date: "Apr 2026" },
  { kind: "official", scope: "all", rule: "Keep it real, not glossy: one take on a phone, natural setting; don't over-polish.", why: "Head of Instagram: polished imagery is 'cheap to produce and boring to consume'; imperfection signals a real person. (His view, not a ranking rule.)", source: "Adam Mosseri via afaqs", url: "https://www.afaqs.com/news/mktg/instagram-ceo-warns-the-ai-content-boom-is-eroding-authenticity-10971125", date: "Jan 2026" },
  { kind: "official", scope: "linkedin", rule: "LinkedIn text says what the video says; no 'comment YES' bait, no polls for reach.", why: "LinkedIn now holds back engagement bait and posts whose text doesn't match the video.", source: "LinkedIn community update", url: "https://scommunity.linkedin.com/learn-explore-apply-68/linkedin-feed-update-the-focus-is-on-authenticity-relevance-8734", date: "Mar 2026" },
  { kind: "official", scope: "x", rule: "The X post must stand alone without a link.", why: "X says link posts reach fewer people; through the API a post with a link also costs about 13× more.", source: "Social Media Today; docs.x.com pricing", url: "https://www.socialmediatoday.com/news/x-formerly-twitter-testing-links-in-app-link-post-penalties/803176/", date: "Oct 2025" },
  { kind: "official", scope: "youtube", rule: "Shorts stay vertical and under 3 minutes, with no copyrighted music.", why: "Up to 3 minutes counts as a Short; a Short over 1 minute with a Content ID claim is blocked worldwide.", source: "YouTube Help", url: "https://support.google.com/youtube/answer/15424877?hl=en-GB", date: "Oct 2024" },
  { kind: "teacher", scope: "all", rule: "Hook = one subject and one question in the viewer's head, in short active words; assume they know nothing yet.", why: "The viewer decides in the first second whether this is for them.", source: "Kallaway", url: "https://sozai.app/transcript/create-killer-hook-impossible-skip/index.md", date: "2026" },
  { kind: "teacher", scope: "all", rule: "Say what it is and why it matters before any background; re-hook every 10–15 seconds.", why: "Context first loses people; small re-hooks keep the retention line flat.", source: "Kallaway", url: "https://podwise.ai/episodes/2873066", date: "Feb 2025" },
  { kind: "teacher", scope: "all", rule: "Write the hook and the last line first; set up 'three things' and land a twist; join points with 'but' and 'therefore'; no 'hi guys' or 'let's get started'.", why: "Structure that pulls forward instead of listing.", source: "Jenny Hoyos (Jay Clouse interview)", url: "https://briefread.pages.dev/en/summary/meet-the-youtuber-who-solved-shorts", date: "Aug 2025" },
  { kind: "teacher", scope: "all", rule: "Aim for 30–45 seconds and end on the payoff — no outro; where it fits, the last line loops back to the first.", why: "Her tests: very short videos need over 100% retention to take off; cutting the last second lifted retention; loops add rewatches.", source: "Jenny Hoyos (Jay Clouse interview)", url: "https://briefread.pages.dev/en/summary/meet-the-youtuber-who-solved-shorts", date: "Aug 2025" },
  { kind: "teacher", scope: "all", rule: "Every reel stands alone: no 'watch part 1 first'; simple delivery, full value.", why: "Trial reels reach strangers who've never seen the account.", source: "Brock Johnson (Jenna Kutcher blog)", url: "https://jennakutcherblog.com/instagram-growth-strategies-2025-brock-johnson/", date: "Jul 2025" },
  { kind: "teacher", scope: "all", rule: "Build series: formats we could make every week for a year; keep about 80% proven formats and 20% experiments.", why: "Repeatable formats compound; experiments find the next one.", source: "Paddy Galloway (via The Transcript Desk)", url: "https://thetranscriptdesk.substack.com/p/the-new-rules-of-youtube-2025-edited", date: "2025" },
  { kind: "teacher", scope: "all", rule: "Make the first 2 seconds look different from others in the niche: a new spot, a prop, a quick visual.", why: "Same-looking openings get scrolled past.", source: "Kallaway", url: "https://sozai.app/transcript/create-killer-hook-impossible-skip/index.md", date: "2026" },
  { kind: "teacher", scope: "instagram", rule: "End with 'comment KEYWORD and I'll send it to you' instead of 'link in bio'.", why: "Comments lift reach and the DM delivers the link. Needs a DM automation tool first — switch on once that's set up.", source: "Brock Johnson (Jenna Kutcher blog)", url: "https://jennakutcherblog.com/instagram-growth-strategies-2025-brock-johnson/", date: "Jul 2025", status: "proposed" },
];

function seedPlaybook() {
  for (const r of RULES) {
    if (one(`SELECT id FROM playbook_rules WHERE lower(rule) = lower(?)`, [r.rule])) continue;
    run(
      `INSERT INTO playbook_rules (scope, rule, why, source_name, source_url, source_date, kind, status, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?)`,
      [r.scope, r.rule, r.why, r.source, r.url, r.date, r.kind, r.status || "active", now()],
    );
  }
}

seed();
