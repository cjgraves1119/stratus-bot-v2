# Genre-specific tells and fixes

The strongest cross-genre signal is **register mismatch**: assistant-shaped output dropped into a medium with different native conventions. Chat is proportional-effort; forums are flowing conversation; texts mirror the sender's established fingerprint. Before anything else, ask: what does the native form of this medium look like?

## Email

- Banned openers: "I hope this email finds you well", "I wanted to reach out", "I trust this finds you thriving". Open with the reason for the email in sentence one: "Quick question about Thursday's deploy."
- Banned closers: "Please don't hesitate to reach out", "I hope this helps clarify". Close with a concrete next step.
- No bullets-and-headers for a question answerable in one line. Answer in the first clause ("yes, after 3pm"), add one caveat if needed.
- Contractions everywhere you'd speak them. "You'll", not "You will".
- Cold outreach: mail-merged fake personalization ("I came across [Company] and was impressed by your work in the [industry] space") triggers deletion. Lead with one verifiable, recent, specific observation — their actual blog post, funding round, job listing — or don't send.

## Chat, texts, DMs

- **Match turn length.** A 150-word structured paragraph answering "u ok?" is a medium violation regardless of wording.
- **Keep the established fingerprint.** Sudden perfect capitalization, commas, and em dashes from someone who texts lowercase is the most instantly-recognized tell in interpersonal writing. Match the channel's (and your own prior) orthography, abbreviations, and error tolerance.
- No neat-bow closers. Chat rewards ending mid-thought; just stop.
- In conflict: no therapy-speak ("capacity", "holding space", "I want to acknowledge your feelings"). Say the plain thing: what happened, how you feel, what you want. Apologies name the specific act without "may have", and stay short.

## Forums, Reddit, comment threads

- The strongest tell: formatted-answer structure (bullets, bolded mini-headings, numbered steps, "In conclusion" paragraph) in a medium whose native form is flowing conversational prose. Write as one voice talking; direct answer in the first sentence.
- Anchor to something only a participant would know: the specific detail from OP's post, last week's thread, community shorthand.
- In opinionated communities, relentless neutrality is a register violation. Deliver a verdict in the community's own intensity.
- Never open by grading the post ("Great point!", "This is such an important conversation") or by restating what you're replying to.

## Social posts (X, LinkedIn)

- Zero hashtags by default; at most one functional tag. Emoji only where you'd actually gesture.
- Kill the recycled formats: hook line + "🧵", "Most people think X. They're wrong. Here's why.", one-sentence-paragraph stacks, "Let that sink in", "Agree?" closers, ✅-bulleted "value" posts.
- Take one side. The both-sides hedged take reads as brand account or bot.

## Technical: commits, PRs, code comments, bug reports

- Commit messages: subject = the change; body = why, and what alternatives were rejected. No marketing abstractions ("Enhanced robustness", "comprehensive improvements"). If a bullet restates the diff, cut it.
- PR descriptions: what problem, why this approach, what a reviewer should scrutinize, how it was verified — plain prose sized to the change. No emoji section headers, no template sections a two-line diff doesn't need.
- Code comments: delete every comment a competent reader could infer from the line ("// increment counter"). Keep only intent, invariants, gotchas, and context links. Exhaustive per-line narration is the #1 AI-code tell.
- Bug reports: lead with a reproducible PoC — exact command, exact output, exact file/line. One paragraph of plain prose beats five bolded sections wrapping unverified claims.

## Resumes and cover letters

- The tell: interchangeable enthusiasm ("I am excited to apply for X at your esteemed organization") with no anecdote, no company-specific reference, no reason for THIS job. Swap the excitement claim for evidence of engagement: a product decision, a team post, a visible problem, connected to one concrete experience of yours.
- Vary bullet shapes; identical verb+task+quantified-impact triads across every role is the structural fingerprint. Include one bullet of pure specific fact. Numbers only where you actually measured them.
- Avoid the post-ChatGPT adjective cluster: adept, tech-savvy, cutting-edge, results-driven, "passion for leveraging innovative solutions".

## Marketing and web copy

- Puffery reads as AI even when humans write it now: "elevate your", "unlock the potential", "seamless", "game-changer", "look no further", "Whether you're X or Y".
- Replace every evaluative blanket with one specific, checkable detail: the street, the dish, the year, the number, the price.
- One idea per sentence; no restating the previous sentence with synonyms swapped.

## Fiction and poetry

See the fiction section of tells-catalog.md for the slop lists. Summary rules:

- Never accept a first-suggestion name (Elara/Kael/Eldoria test: if AI books on Goodreads already use it, discard).
- Budget one breath/whisper beat per chapter; replace autonomic clichés with what THIS character specifically does.
- Bare "said"; cut voice-modifier riders. Let dialogue carry subtext — interruption, deflection, non-answers.
- Let conflicts cost something permanent. End scenes with the problem worse or transformed, not resolved. No "maybe, just maybe" codas.
- Metaphors from the story's own concrete domain — a mechanic's metaphors differ from a nurse's. One governing image per scene beats five interchangeable art-nouns (tapestry, symphony, dance, kaleidoscope).
- Poetry: choose form deliberately. If a draft arrives as rhymed AABB quatrains with uplift, that's the default speaking, not the poem.

## Academic and professional prose

- The 2024 excess-vocabulary lists (delves, showcasing, underscores, pivotal, realm, crucial, meticulously, notably) are now actively grepped for by reviewers.
- Genre boilerplate scores as AI even from humans ("The results of this study indicate that..." in every abstract) — inject author-specific phrasing inside the required formula.
- Keep equivocal language: "but", "however", "although", asymmetric confidence. Human scientists' hedging was a top discriminator — its absence flags the text.
- More digits, more named entities, more citations with page numbers. LLM text is measurably light on all three.
