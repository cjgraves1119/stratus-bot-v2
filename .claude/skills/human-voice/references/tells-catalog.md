# Catalog of AI writing tells

Curated from Wikipedia's Signs of AI writing (WP:AISIGNS), detector-vendor research (Pangram, GPTZero, Originality.ai, Turnitin), academic corpus studies (Reinhart et al. PNAS 2025, Kobak et al. Science Advances 2025, Liang et al. ICML 2024, Herbold et al. 2023, Desaire et al. 2023, HC3), and practitioner communities (editors, teachers, Reddit, HN, fiction workshops). Compiled 2026-07.

Core theory: LLMs regress to the statistical mean. Output becomes simultaneously **less specific and more exaggerated** — the "inventor of the first train-coupling device" becomes "a revolutionary titan of industry." Individual tells are weak alone but co-occur heavily: where there is one, there are likely others. Readers and detectors both convict on **density and co-occurrence**, not single hits.

## Tier 1 — Hard artifacts (near-conclusive; must never appear)

These are copy-paste debris, not style. Their presence is treated as proof.

- Chat-wrapper text: "Certainly! Here is...", "I hope this helps!", "Let me know if you'd like...", "Would you like me to...", "Great question!"
- Self-identification: "As an AI language model...", "As a large language model..."
- Knowledge-cutoff disclaimers: "As of my last knowledge update...", "I don't have access to real-time data" (139 published papers were caught on Google Scholar via these exact strings)
- Unfilled placeholders: `[Your Name]`, `{company name}`, `[insert X]`, `2025-XX-XX`, `PASTE_URL_HERE`
- Citation-token debris: `citeturn0search0`, `oaicite`, `oai_citation`, `contentReference`, `grok_card`, `render_inline_citation`, `attributableIndex`, `:::writing`, `[cite: 1]`, `【85†L261-269】`, `[web:1]`, `[attached_file:1]`
- URL tracking: `utm_source=chatgpt.com`, `utm_source=openai`, `utm_source=copilot.com`, `referrer=grok.com`
- Markdown leaking into non-Markdown media: literal `**asterisks**`, `###` headings, `•` bullets in plain-text email, wikitext, forms; Unicode pseudo-bold (𝗹𝗶𝗸𝗲 𝘁𝗵𝗶𝘀)
- Tool attribution trailers where unwanted: "Co-Authored-By: Claude", "🤖 Generated with..."
- Hallucinated references: unresolvable DOIs, invalid ISBNs, book cites without page numbers, real DOIs pointing at unrelated papers
- Meta-commentary addressed to the requester: "You can copy and paste this...", "Delete this section before submission"
- CJK characters or fullwidth punctuation mid-English-sentence (Chinese-family model bleed)

## Tier 2 — Phrase templates (the most legible layer)

Measured frequency multipliers vs human text (Pangram n-gram study) in parentheses.

**Openers.** "In today's fast-paced world", "In the ever-evolving landscape of" (11,000x), "In the digital age", "In the realm of", "In an era where", "When it comes to", "At its core". Fix: open with the specific problem, fact, or scene. Delete the first sentence of a draft and see if anything is lost.

**Negative parallelism — the single most-cited construction.** "It's not just X — it's Y", "This isn't merely X; it's Y", "not because X, but because Y", "The question isn't X. The question is Y.", "Not only X but also Y", negation catalogues ("Not the wind. Not an animal. Something else."). EQ-Bench weights not-x-but-y patterns at 25% of its entire slop score; Fortune 500 filings quadrupled its use 2023→2025. Fix: state the positive claim directly. Allow at most one contrast per piece, only when a real, nameable misconception exists.

**Significance inflation.** "serves as a testament to" (4,000x), "stands as a testament", "plays a crucial/pivotal role in", "marking a pivotal moment in the evolution of", "underscores its importance", "left an indelible mark", "reminder of the enduring" (31,000x), "as a poignant" (49,000x), "faced numerous challenges" (30,000x), "newfound sense of purpose" (4,000x). Fix: state the fact and stop. If it truly matters, show the consequence — who did what differently because of it.

**Trailing "-ing" significance tails.** Sentence ends with ", highlighting/underscoring/ensuring/reflecting/showcasing/contributing to..." — unattributed mini-analysis dangling off a fact. The largest grammatical effect in the PNAS corpus study (2–5x human rate). Fix: end the sentence at the fact. If the implication matters, give it its own sentence with a named subject.

**Copula avoidance.** "serves as", "stands as", "boasts a", "features", "holds the distinction of being", "refers to" — anywhere plain "is/has" would do. Post-2023 academic text shows a >10% drop in "is/are". Fix: use is, are, has, was.

**Hedge/importance boilerplate.** "It's important to note that" (3,000x), "It's worth noting/mentioning", "Generally speaking", "It is crucial to remember". Fix: delete the frame, state the fact.

**Transitions.** Paragraph-initial "Moreover," "Furthermore," "Additionally," cycling in sequence; "That being said". Fix: cut the connective — juxtaposition usually carries the logic — or use plain "And", "But", "Also".

**Conclusions.** "In conclusion", "In summary", "Overall", "Ultimately" + restatement of everything already said; moralizing closers ("it is crucial that we address these challenges together"); uplift endings ("The future looks bright", "Despite these challenges, X continues to thrive"); aphoristic zoom-outs ("In the end, the real question isn't X — it's what we do with it"). Fix: end on the last new concrete point. Never restate. Let a piece end unresolved or ambivalent if that's where the evidence is.

**False ranges.** "from ancient traditions to modern innovations", "from beginners to seasoned experts", "everything from X to Y" where no real continuum exists. Fix: name the actual two or three items.

**Vague attribution.** "Experts argue", "Studies show", "Industry reports suggest", "Observers have cited", "Some critics argue". Fix: name the person, study, outlet, and date — or own the claim.

**Marketing second person.** "Whether you're a seasoned pro or just starting out", "Look no further", "unlock the full potential of", "elevate your", "harness the power of", "dive into", "game-changer" (19x), "Let's dive in". Fix: name the actual reader and outcome in plain declaratives.

**Engagement bait.** "Here's the thing" (34x), "Let that sink in" (28x), "Read that again" (22x), "Full stop." (14x), "And honestly?", "Here's the kicker", "The result? Devastating." (rhetorical-question pivot), "Agree?"/"Thoughts?" closers. Fix: trust the point to land; delete instructions to the reader.

**Punchy fragment triad.** "Fast. Simple. Effective." / "No fluff. No filler. No stress." Fix: one full sentence with the single strongest word.

**"By + gerund" advice chains.** "By leveraging... By implementing... By embracing..." Fix: imperative or subject-first sentences.

**Challenges-and-future formula.** "Despite its [positives], [subject] faces several challenges... Despite these challenges..." — often as a "Challenges and Future Outlook" section. Fix: report specific problems as facts; don't balance every negative with a hopeful closer.

## Tier 3 — Structure and formatting

- **Bullet/listicle addiction**: prose-shaped ideas forced into bullets. Test: if you can insert "because" or "which led to" between items, it should be prose.
- **Bold-lead-in bullets** ("**Scalability:** The platform grows with your needs.") — "barely exists in natural writing." Never let three bullets in a row start with a bolded noun phrase and colon. Worse: when the sentence restates its own bold label.
- **Heading-per-paragraph over-sectioning**: a 600-word piece with five H2s. Under ~800 words, use no headings. Never follow a heading with a single sentence.
- **Title Case Headings** where the venue uses sentence case.
- **Emoji in headings/bullets** (✅📊💡🚀) in anything longer than a chat message.
- **Em dash overuse**: several per paragraph, used where commas/parens/colons belong. Don't purge them (that's now its own overcorrection tell) — ration to roughly one per few paragraphs and vary the connective tissue.
- **Rule of three everywhere**: adjective triads, three examples, three parallel clauses, in every sentence. Keep at most one triad per page; break others into pairs, singles, or four-plus.
- **Uniform paragraph geometry**: every paragraph 3–4 sentences, topic sentence → support → mini-summary. The two largest features in Desaire et al.'s 99%-accurate detector were sentences-per-paragraph and words-per-paragraph. Vary hard: a one-sentence paragraph next to an eight-sentence one.
- **Every paragraph ends with a summary/significance sentence** ("This highlights...", "This underscores..."). Delete the final sentence of each paragraph and check whether anything is lost.
- **Five-paragraph-essay scaffolding** with a roadmap sentence ("In this article, we will explore...") and a "Conclusion" section in short pieces.
- **Restate-then-answer**: repeating the question before answering (the classic teacher tell).
- **Tables where prose would do**: fewer than ~3x3 cells of genuinely parallel data → write a sentence.
- **Skipped heading levels** and horizontal rules before headings.
- **Canned parallel lists**: every item same length, same grammar, same die-stamp. Human lists are ragged.
- **Over-explaining basics** the audience obviously knows; exhaustive coverage of every sub-case instead of the one that matters.
- **Local coherence, global drift**: each paragraph fine, but the argument never accumulates. Outline the through-line first.

## Tier 4 — Tone and rhetoric

- **Promotional puffery on everything**: "vibrant town with a rich cultural heritage", "nestled in the heart of", "breathtaking", "must-visit", "renowned". Replace evaluative adjectives with verifiable specifics — dates, numbers, names, the actual view.
- **Sycophancy/glazing**: "Great question!", "You're absolutely right!", "You're not imagining it". Cut all evaluation of the reader.
- **Both-sidesing / false balance**: "While critics argue X, supporters maintain Y. The truth lies somewhere in between." Take a position, or explicitly weight the sides with reasons.
- **Refusal to take a position**: "It depends on your specific needs", "Both approaches have their merits", "There is no one-size-fits-all answer". Make at least one claim someone could disagree with.
- **Empty profundity**: "Change is the only constant", "At the end of the day, we are all human". Test: could its opposite be argued? If not, it says nothing.
- **Hedge-stacking**: "could potentially", "may eventually", "can potentially help". One hedge max per claim, and only where uncertainty is real. (But note the inverse: LLMs also underuse *genuine* epistemic markers — "I suspect", "probably", "as far as I can tell". Hedge like a person: asymmetrically, where you actually feel doubt.)
- **Bolted-on safety caveats**: "Always consult a professional before...". If a real risk exists, name the specific risk and condition.
- **False concession**: "While X has limitations, it's still remarkable." State the real tradeoff with its cost.
- **Moralizing closers**: AI narrators state the story's lesson 77% of the time vs 52% for humans. Trust the reader.
- **Flat affect / no register shifts**: one emotional temperature throughout. Humans move from analytical to annoyed to tender mid-piece.
- **Relentless positivity**: LLM text measurably suppresses fear, disgust, irritation, and sharp criticism. Write the emotion you actually have, including negative ones.
- **Missing authorial "I"**: no anecdotes, no personal cost, no failure stories. One concrete first-person anecdote with a checkable detail does more than any style edit.
- **Generic examples**: "a recent study", "many companies", "imagine a small business owner named Sarah". Every generic becomes a named specific or gets cut.
- **Therapy-speak outside therapy**: "holding space", "I want to acknowledge your feelings", "Do you want to sit with that?"
- **Elegant variation / synonym cycling**: "the platform → the solution → the offering → the tool" for one product (repetition-penalty artifact). Repeat the plain word.
- **"Conspicuous subtlety"**: announcing quietness/subtlety instead of enacting it ("quiet confidence", "a quiet rebellion"); textile metaphors ("woven into the fabric of").

## Tier 5 — Fiction-specific slop

- **Default names**: Elara, Kael, Elias (Thorne), Seraphina, Lyra, Mara; Emily/Sarah as placeholder names in examples (60–70% frequency). Places: Eldoria, Aethelgard, Oakhaven, Whisperwood, Ravenswood, [Adjective][Nature-noun] compounds. Stock occupations: lighthouse keeper, clockmaker, librarian (in 88%+ of sampled stories).
- **The whisper/breath cluster**: "voice barely above a whisper" (on 68.7% of model slop lists), "took a deep breath", "let out a breath she didn't know she was holding".
- **Autonomic-reaction clichés**: shiver down spine, heart pounding/hammering, blood ran cold, knuckles turning white, swallowed hard, stomach dropped.
- **Eye/smile choreography**: eyes widened/narrowed/never left, a smile played on her lips, a grin spread across his face, brow furrowed.
- **Atmospheric filler**: "the air was thick with", words hung in the air, casting long shadows, sun dipped below the horizon painting the sky in hues of orange and pink, dust motes danced.
- **Slop lexicon**: thrummed, flickered, rasped, glinted, shimmered, palpable, cacophony, gossamer, labyrinthine, ministrations, camaraderie, ethereal, "with practiced ease", "reckless abandon", smell of ozone.
- **Over-attributed dialogue**: every line tagged, every tag carrying a voice rider ("she said, her voice laced with..."). Audit any manuscript where "voice" appears within five words of "said" more than a handful of times.
- **On-the-nose dialogue**: characters state feelings and theme in complete grammatical sentences; nobody interrupts, evades, or trails off.
- **Premature resolution**: conflicts dissolved within the scene; endings restore equilibrium. Let bad outcomes stand.
- **Reflective codas**: "Maybe, just maybe, that was enough.", "Their journey was only just beginning." End on image, action, or unresolved tension.
- **Qualifier wrappers**: "the kind of silence that...", "a flicker of something akin to...", "something between X and Y".
- **Poetry defaults**: rhymed AABB quatrains, iambic uplift, heart/embrace/whisper/echo/dance/dreams/grace, communal "we" voice, opening with "In the...".

## Anti-overcorrection: signs of human writing to KEEP

Wikipedia maintains an inverse list — constructions empirically more common in human text that LLMs avoid. Do not sand these off:

- Plain is/has phrases: "there is a", "it has a"
- Plain words over stiff synonyms: wrote (not authored), used (not utilized), died (not passed away), before (not prior to)
- Definitive superlatives where true: "one of the best", "was the first"
- Honest hedging qualifiers: "very", "perhaps", "tends to", "I think", "probably"
- Contractions, sentence fragments, starting sentences with And/But
- Occasional digressions, asides, parentheticals, opinion
- Repeating the natural word instead of synonym-cycling
- Your own idiosyncrasies — pet phrases, regional words, nonstandard-but-yours punctuation habits

And ineffective indicators that do NOT signal AI (don't chase them): perfect grammar alone, formal/academic register alone, transition words in isolation, letter-like formatting alone, em dashes in the hands of a professional writer.

Never fake typos or inject deliberate errors — evasion tricks read as sloppy or deceptive and are themselves detectable. Get statistical humanness honestly: rare-but-apt word choice, real specificity, rhythm variance.
