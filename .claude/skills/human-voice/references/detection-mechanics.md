# How AI-text detection works, and what to write toward

Four detector families, each implying a measurable property of prose. The practical upshot: the features that trip detectors — uniform rhythm, predictable diction, formulaic structure — are also the markers of flat writing. Fixing them improves the prose whether or not a detector ever sees it.

## 1. Perplexity and burstiness (GPTZero, ZeroGPT, DetectGPT, Binoculars)

A reference language model scores how predictable each token is given context. LLM output samples likely tokens, so it scores **low perplexity** — every word is the word anyone would guess next. **Burstiness** is the second-order metric: the standard deviation of per-sentence perplexity. Humans oscillate between plain sentences and surprising ones; LLM output holds constant mid-level predictability. DetectGPT adds that machine text sits at local maxima of log-probability: any perturbation lowers its likelihood, while perturbing human text moves likelihood both ways. GPT-who found machine text spreads information at an unnaturally even rate — no dense passages, no throwaway asides.

**Write toward:** word choices a model would rank unlikely (concrete specifics, idiom, personal references, an odd-but-apt verb); variance in information density (follow a dense sentence with a plain short one; spend a sentence on pure reaction); some statistical "friction" — a parenthetical aside, a repeated word for emphasis, a colloquial shortcut. If a phrase auto-completes in your head before you finish reading it, rewrite it.

## 2. Trained classifiers (Turnitin, Originality.ai, Copyleaks, Pangram, modern GPTZero)

Transformer networks trained on millions of paired human/AI documents, often scoring per-sentence. Turnitin's summary of the learned signal: text that is **"too consistently average"** — the most statistically probable words in a uniform style. Classifiers key on formulaic transitions, repeated discourse markers, recurring rhetorical templates, and stable per-paragraph structure.

**Write toward:** never reuse the same rhetorical template twice in one piece; delete most explicit transitions; let paragraph shape follow content.

## 3. Stylometric features (StyloAI and academic literature)

The empirically strongest discriminators, each with its human-side fix:

| Feature detectors measure | AI signature | Human fix |
|---|---|---|
| Sentence-length std dev within a paragraph | everything 15–25 words | mix 3-word fragments with 40-word runs; check your own variance |
| Sentences/words per paragraph | uniform 3–4 sentence blocks | one-sentence paragraph next to an eight-sentence one |
| Type-token ratio, hapax rate | small recycled vocabulary; "crucial" six times in 800 words | many one-use words: names, sensory details, offhand terms |
| Present participial clauses | 2–5x human rate (", highlighting...") | break "-ing" tails into finite-verb sentences |
| Nominalizations | 1.5–2x ("the implementation of the optimization of") | verbs with agents: "we implemented X and it got faster" |
| Phrasal coordination | "clarity and precision", "growth and innovation" pairs | one noun is usually enough |
| Modals/epistemic markers | near zero ("I think", "probably", "it seems") | hedge where actually unsure, commit hard where sure |
| Emotion distribution | neutral-to-positive; suppressed fear/disgust/irritation | write the negative emotion you actually have |
| Proper nouns, digits, dates | sparse and generic | name people, places, products, versions, dollar figures |
| Punctuation variety | commas and periods only, uniform rhythm | parentheses, colons, semicolons, questions, a dash — where natural |
| Readability per segment | steady mid-band throughout | dense where material is dense, breezy in anecdotes |
| First-person / direct address | absent | "I tried this in March and it broke" |
| Contractions, informality | absent; ~100x less informal vocabulary | contract where you'd speak it |
| Agentless passives | half human rate (ironically) | normal passive use is fine and human |

## 4. Watermarking (Kirchenbauer, Google SynthID-Text)

Provider-side token biasing detected by z-test. Only relevant to text pasted verbatim from a cooperating model — text you actually wrote carries no watermark by construction. Genuine rewriting in your own words (not machine paraphrase) breaks it.

## Known accuracy limits (context for stakes)

No detector in Weber-Wulff et al.'s 14-detector test reached 80% accuracy. OpenAI killed its own classifier (26% catch rate, 9% false positives). The Stanford TOEFL study found a 61.3% average false-positive rate on human non-native-speaker essays — simple vocabulary and formulaic learned constructions produce low perplexity too. Enriching word choice dropped those false positives from 61.3% to 11.6% — the single highest-leverage intervention, and the same one that improves the writing.

Two implications:

1. **Tells are cumulative.** Fixing one signal while leaving five intact still fails. Do a multi-axis pass: rhythm, lexicon, grammar (participials/nominalizations), stance (hedges/emotion), specificity (proper nouns/numbers).
2. **The ultimate defense is provenance, not style.** Version history, drafts, and timestamps have resolved every documented false accusation. When it matters, compose in a tracked environment.
