---
name: human-voice
description: Write prose that reads as human-authored and avoids every known AI tell — stock vocabulary, phrase templates, uniform rhythm, assistant register, and formatting habits. Use when the user asks for writing that must sound human, natural, not AI-generated, or must pass as human-written — emails, posts, essays, marketing copy, fiction, comments, messages, resumes, or any text where AI-sounding prose would hurt credibility.
---

# Human voice

AI prose betrays itself by regressing to the statistical mean: it gets simultaneously less specific and more exaggerated, holds one polite temperature, and stamps out uniform sentences from a small stock of templates. Readers and detectors both convict on **density and co-occurrence** of tells — no single em dash or "crucial" gives you away, but three tells in one paragraph do. This skill is a discipline for eliminating them at the source and a revision procedure for catching the rest.

Reference files in `references/` — consult them as needed during the revision pass:
- `tells-catalog.md` — the full catalog of tells by tier, with fixes
- `vocabulary-blocklist.md` — banned words/phrases with evidence, plus grep patterns
- `detection-mechanics.md` — what detectors measure; the statistical properties to write toward
- `genre-guides.md` — medium-specific rules (email, chat, forums, social, technical, fiction, resumes)

## The three disciplines

Everything below reduces to these. If you hold only three things in mind while drafting, hold these:

**1. Vary everything.** The most durable machine signal — the one that survives vocabulary drift across model generations — is uniformity: sentences all 15–25 words, paragraphs all 3–4 sentences, every list three items, every transition labeled, information arriving at a constant rate. Human writing is bursty. Mix a 4-word sentence against a 40-word one. Let one paragraph run eight sentences and the next run one. Spend disproportionate words on what matters and compress the rest. Let a dense passage be followed by a throwaway aside. If the rhythm reads metronomic aloud, rewrite.

**2. Be specific.** Named people, real places, dates, version numbers, dollar figures, page numbers, the actual street and the actual dish. Proper nouns and digits are among the few cues human judges reliably use, and they are exactly what generic training-data prose lacks. Every "many companies" becomes a named company; every "a recent study" becomes the study, year, and author; every "significant improvement" gets a number. If you can't supply the specific, cut the claim rather than pad it.

**3. Take a position.** Machine text is structured so it can never be wrong: both sides presented, every claim hedged, endings bent toward hope, nobody disagreed with. Commit. Make at least one claim someone could argue with. Weight the sides when you present two. Let irritation, doubt, or humor show where genuine. Let an ending stay unresolved or pessimistic if that's where the evidence points. Asymmetric confidence — certain here, openly unsure there — is a human fingerprint.

## Hard rules (always, before anything else)

1. **No assistant register.** No "Certainly!", "Great question", "I hope this helps", "Let me know if...", no evaluating the reader, no restating the request before answering, no offers of further help.
2. **No artifacts.** No placeholders (`[Name]`, `{company}`), no citation debris, no knowledge-cutoff talk, no Markdown syntax in media that won't render it. (Full list: tells-catalog.md Tier 1.)
3. **Match the medium.** A one-line question gets a one-line answer. No bullets, headers, or bold in chat, comments, texts, or short emails. Forum replies are one voice talking. Turn length mirrors the other person's. Sentence-case headings where the venue uses them. (Details: genre-guides.md.)
4. **No banned lexicon.** The high-priority list in vocabulary-blocklist.md — delve, tapestry, testament, pivotal, crucial, underscore, showcase, leverage, seamless, robust, vibrant, meticulous, intricate, boasts, realm, landscape, foster, harness, garner, plethora, game-changer, ever-evolving, utilize — and the stock phrases: "In today's fast-paced world", "It's important to note", "serves as", "stands as", "when it comes to", "whether you're X or Y", "look no further", "In conclusion".
5. **Ration the signature constructions.** Per piece, at most ONE of each: negative parallelism ("it's not X, it's Y" — the single most-cited AI construction), "not only... but also", a rule-of-three triad, a rhetorical-question pivot ("The result?"), an em dash pair per few paragraphs, a trailing "-ing" clause. Zero is safer than one.
6. **Plain verbs win.** "Is" and "has" over "serves as" and "boasts". Verbs with agents over nominalizations ("we cut costs", not "the implementation of cost reductions"). Break ", highlighting/underscoring/reflecting..." tails into their own sentences or cut them.
7. **State facts without inflating them.** No "marking a pivotal moment", no "underscores its importance", no travel-brochure adjectives. The fact, then stop. If it matters, show the consequence.
8. **End when done.** No summary paragraph, no "Overall,", no moral, no zoom-out aphorism, no compulsory optimism. Land on the last concrete point.

## Drafting procedure

**Before writing:** identify the medium and its native register, the specific reader, and what concrete material you have (names, numbers, anecdotes, sources). If the user's request is thin on specifics, use what's in context or ask — specifics are the raw material of human-sounding prose and can't be faked convincingly.

**While drafting:** write in the target register from the first word (don't draft formal and casualize later — register mismatch shows at the seams). Open with the actual point, fact, or scene; no scene-setting throat-clearing. Follow the three disciplines and the hard rules.

**Revision passes** (a draft that skipped none of these is done):

1. **Artifact and lexicon grep.** Run the grep patterns at the bottom of vocabulary-blocklist.md against the draft. Fix every hit.
2. **Rhythm pass.** Check sentence lengths — if most sit in one band, split some and fuse others; add a fragment or a long cumulative sentence. Check paragraph lengths for the same. Delete the last sentence of any paragraph that merely restates the paragraph.
3. **Template pass.** Count negative parallelisms, triads, em dashes, "-ing" tails, paragraph-initial transitions. Cut to the rations in hard rule 5. Delete openers and conclusions that could preface/close any piece on the topic.
4. **Specificity pass.** Hunt generics: "experts", "studies show", "many people", "various factors", "a range of". Each becomes a named specific or gets cut. Add digits where true.
5. **Stance pass.** Does the piece ever commit, disagree, or show a feeling other than measured positivity? If not, add the position or the honest emotion that's missing. Remove hedges from claims you'd bet on; keep one honest hedge where you wouldn't.
6. **Read-aloud check.** Would the intended author say these sentences? Anything that sounds like meeting minutes or a brochure gets rewritten in speech.

## Don't overcorrect

Some "fixes" are themselves tells, and some human habits should be left alone:

- Never inject fake typos or deliberate errors — adversarial sloppiness reads as deceptive and is detectable.
- Don't purge every em dash; professional human writers use them. Ration, don't ban.
- Keep plain human constructions: "there is a", "one of the best", "very", "perhaps", contractions, sentences starting with And/But, honest superlatives, the same word repeated instead of synonym-cycled.
- Perfect grammar alone, formal register alone, and transition words in isolation are NOT tells — don't mangle correct prose chasing them.
- Keep the author's idiosyncrasies if editing someone's text: pet phrases, regional words, punctuation habits. Consistency with their prior voice matters more than any rule here.
