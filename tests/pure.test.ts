import test from "node:test";
import assert from "node:assert/strict";
import { checkText, checkScript, finalCaption } from "@/lib/compliance";
import { lanePlan } from "@/lib/speakers";
import { parseSilence, keepSegments } from "@/lib/edit/ffmpeg";
import { groupWords, buildAss } from "@/lib/edit/captions";
import { parseWhisperCpp } from "@/lib/edit/transcribe";

test("compliance blocks return promises and calls, per niche", () => {
  assert.equal(checkText("Turn ₹10,000 into ₹1 lakh with this coin", "crypto").status, "block");
  assert.equal(checkText("This coin can do 100x", "crypto").status, "block");
  assert.equal(checkText("Bitcoin will hit $150k by March", "crypto").status, "block");
  assert.equal(checkText("Why Vodafone Idea could jump 33%", "finance_trading").status, "block");
  assert.equal(checkText("Guaranteed returns every month", "psychology").status, "block");
  assert.equal(checkText("How a wallet seed phrase works", "crypto").status, "ok");
  // multipliers are only a money-niche problem
  assert.equal(checkText("I'm 10x calmer now", "psychology").status, "ok");
});

test("compliance warns where a person should look", () => {
  const c = checkText("Cryptocurrency explained, plus a free airdrop", "crypto");
  assert.equal(c.status, "warn");
  assert.equal(c.issues.length, 2);
  assert.equal(checkText("You probably have ADHD if you do this", "psychology").status, "warn");
  assert.equal(checkText("Nifty today is falling, here's why", "finance_trading").status, "warn");
  assert.equal(checkText("Earn ₹50,000 a month consulting", "business_consulting").status, "warn");
});

test("checkScript reads on-screen text too", () => {
  assert.equal(checkScript({ hook: "Safe start", body: "Plain body", onScreen: [{ text: "100x coin" }] }, "crypto").status, "block");
});

test("finalCaption adds link, hashtags and disclaimer once", () => {
  const out = finalCaption("Line one", "#a #b", "Risk line.", "https://x.y/r/abc");
  assert.equal(out, "Line one\n\nhttps://x.y/r/abc\n\n#a #b\n\nRisk line.");
  assert.equal(finalCaption("Already has Risk line.", null, "Risk line."), "Already has Risk line.");
});

test("lanePlan splits by share (70/30 of 3 = 2 + 1)", () => {
  const lanes = [
    { key: "psy", name: "", desc: "", share: 70 },
    { key: "lead", name: "", desc: "", share: 30 },
  ];
  assert.deepEqual(lanePlan(lanes, 3), ["psy", "psy", "lead"]);
  assert.equal(lanePlan(lanes, 10).filter((k) => k === "lead").length, 3);
  const three = [
    { key: "a", name: "", desc: "", share: 40 },
    { key: "b", name: "", desc: "", share: 35 },
    { key: "c", name: "", desc: "", share: 25 },
  ];
  assert.deepEqual(lanePlan(three, 3), ["a", "b", "c"]);
});

test("silence parsing and the parts we keep", () => {
  const stderr = "[silencedetect] silence_start: 2.0\n[silencedetect] silence_end: 3.5 | silence_duration: 1.5\n[silencedetect] silence_start: 9.0\n";
  const s = parseSilence(stderr);
  assert.deepEqual(s, [{ start: 2, end: 3.5 }, { start: 9, end: Infinity }]);
  const keep = keepSegments(s, 10);
  assert.equal(keep.length, 2);
  assert.ok(Math.abs(keep[0].e - 2.12) < 1e-9);
  assert.ok(Math.abs(keep[1].s - 3.38) < 1e-9);
  assert.ok(Math.abs(keep[1].e - 9.12) < 1e-9);
  // no silences = keep everything
  assert.deepEqual(keepSegments([], 5), [{ s: 0, e: 5 }]);
});

test("caption grouping and ASS output", () => {
  const words = "This is how a crypto scam usually starts with a message".split(" ").map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.35 }));
  const lines = groupWords(words, 3, 18);
  assert.ok(lines.every((l) => l.words.length <= 3));
  assert.equal(lines.flatMap((l) => l.words).length, words.length);
  const ass = buildAss({ words, style: "bold_pop", hook: "Spot a scam {fast}", onScreen: [{ t: 2, text: "Step 1" }], screenDisclaimer: "Education only.", duration: 6 });
  assert.match(ass, /\[Events\]/);
  assert.match(ass, /Spot a scam \(fast\)/); // braces can't break the subtitle file
  assert.match(ass, /Education only\./);
  assert.match(ass, /Step 1/);
});

test("whisper.cpp JSON to words", () => {
  const j = { transcription: [{ offsets: { from: 0, to: 400 }, text: " Hello" }, { offsets: { from: 400, to: 900 }, text: " world" }, { offsets: { from: 900, to: 900 }, text: "" }] };
  const w = parseWhisperCpp(j);
  assert.deepEqual(w.map((x) => x.w), ["Hello", "world"]);
  assert.equal(w[1].e, 0.9);
});

test("watchlist: any pasted link or handle becomes the right entry", async () => {
  const { parseCreator } = await import("@/lib/refs");
  assert.deepEqual(parseCreator("https://www.instagram.com/drjulie/?hl=en"), { platform: "instagram", handle: "drjulie", externalId: null, url: "https://www.instagram.com/drjulie/", name: "drjulie" });
  // a link to one reel isn't a profile; it's kept as a plain link
  assert.equal(parseCreator("https://www.instagram.com/reel/abc123/")!.platform, "other");
  assert.equal(parseCreator("https://www.youtube.com/@CoinBureau/shorts")!.handle, "@CoinBureau");
  assert.equal(parseCreator("https://www.youtube.com/channel/UCWZM6eBSsb4iDmyeE-PfSFQ")!.externalId, "UCWZM6eBSsb4iDmyeE-PfSFQ");
  assert.equal(parseCreator("UCWZM6eBSsb4iDmyeE-PfSFQ")!.platform, "youtube");
  assert.equal(parseCreator("@melrobbins")!.platform, "instagram");
  assert.equal(parseCreator("@melrobbins", "youtube")!.url, "https://www.youtube.com/@melrobbins");
  assert.equal(parseCreator("https://x.com/rajivtalreja")!.platform, "x");
  assert.equal(parseCreator("https://www.linkedin.com/in/sandeep-das-1b343719/")!.handle, "sandeep-das-1b343719");
  assert.equal(parseCreator("not a handle!!"), null);
});
