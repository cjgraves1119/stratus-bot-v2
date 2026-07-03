# Vocabulary blocklist

Words and substitutions with empirical backing. Evidence keys: **K25** = Kobak et al., Science Advances 2025 (15.1M PubMed abstracts; r = 2024 frequency ÷ pre-ChatGPT expected); **JW25** = Juzek & Ward, COLING 2025 (% increase 2020→2024); **L24** = Liang et al., ICML 2024 (fold-increase in AI-conference peer reviews); **Wiki** = Wikipedia Signs of AI writing; **Pangram** = Pangram Labs n-gram study; **Slop** = EQ-Bench/Antislop fiction slop lists.

Rules of use:

- The signal is **density and co-occurrence**, not single hits. One "pivotal" is fine; five per page plus "underscores" plus "landscape" is a conviction.
- Treat the list literally — synonyms of these words are not tells. Don't thesaurus-swap "delve" for "plumb"; use the plain word or restructure.
- Lists are **versioned**: delve/tapestry/testament peaked in the GPT-4 era (2023–mid-2024) and declined; the GPT-5-era set is narrower (emphasizing, enhance, highlighting, showcasing). Stale tells still matter because readers grep for them.

## High-priority words (strong evidence)

| Word family | Evidence | Use instead |
|---|---|---|
| delve/delves/delving | K25 r=28.0; JW25 +6,697% | look at, examine, dig into |
| underscore/underscores | K25 r=13.8; JW25 +904% | show, stress, point to |
| showcase/showcasing | K25 r=10.7; JW25 +1,396% | show, display |
| meticulous(ly) | L24 34.7x; K25 | careful, thorough |
| intricate/intricacies | L24 11.2x; JW25 +773% | complex, detailed |
| commendable | L24 9.8x | good, solid |
| boasts | JW25 +918%; Wiki puffery | has, includes |
| tapestry | Wiki; Pangram "vibrant tapestry" ~17,000x; Slop | mix, range, variety |
| testament ("a testament to") | Pangram "serves as a testament" ~4,000x | shows, proves |
| pivotal | Wiki high-density | central, key |
| crucial | K25 δ=0.037 | important, key |
| realm | JW25 +381% | area, field |
| landscape (metaphorical) | Wiki | field, market, situation |
| vibrant | Wiki puffery | lively, busy |
| garner(ed) | JW25 +437% | get, gain, earn |
| groundbreaking | JW25 +330% | new, first |
| comprehensive | K25 marker set; L24 | complete, thorough, full |
| leverage (verb) | cluster | use, apply |
| seamless(ly) | K25 | smooth, without gaps |
| robust | Wiki | strong, solid, reliable |
| foster(ing) | Wiki formulaic verb | encourage, build, help |
| harness | Wiki formulaic verb | use, tap |
| bolster(ed) | K25; Wiki | strengthen, support |
| enhance/enhancing | K25 marker; GPT-5-era | improve, add to |
| highlight(ing) (formulaic) | GPT-5-era; Wiki | show, point out |
| emphasizing | JW25 +397%; GPT-5-era | stressing, noting |
| align(s) with | JW25 +267%; Wiki | matches, fits |
| elevate | K25 | raise, improve |
| navigate (metaphorical) | cluster | handle, deal with |
| embark | cluster | start, begin |
| unleash | cluster | release, start |
| multifaceted | cluster | many-sided, varied |
| nuanced | cluster; Claude-heavy | subtle, detailed |
| holistic | cluster | whole, overall |
| paramount | cluster | most important |
| plethora / myriad | cluster | many, plenty |
| noteworthy / notably | K25 | worth noting, especially |
| transformative | K25 | major, far-reaching |
| enduring | Wiki | lasting |
| interplay | Wiki | interaction |
| profound | Wiki puffery | deep, major |
| renowned | Wiki puffery | well-known |
| nestled | Wiki puffery; Slop | located, sits |
| breathtaking | Wiki puffery | striking |
| exemplifies | Wiki puffery | shows, is an example of |
| game-changer / cutting-edge / ever-evolving | cluster | say what changed, by how much |
| facilitate | K25 | help, ease, enable |
| elucidate / illuminate | K25 | explain, clarify |
| unravel(ing) | K25 | work out, explain |
| encapsulates | K25 | sums up |
| endeavors | K25 | efforts |
| amidst | corpus studies | amid, among, during |
| insights ("valuable insights") | K25 marker; Pangram ~5,000x | the actual finding |
| empower(s) | cluster | enable, let |
| streamline | cluster | simplify, speed up |
| revolutionize | cluster | change, overhaul |
| spearheaded | resume cluster | led, ran |
| adept / tech-savvy / results-driven | recruiter-flagged post-2023 | concrete skills and facts |

Kobak's 10-word predictive marker set (words that together predict LLM processing): *across, additionally, comprehensive, crucial, enhancing, exhibited, insights, notably, particularly, within*. Individually innocent; density of several is the flag.

## Fiction slop lexicon (EQ-Bench / Antislop)

thrummed, flickered, rasped, glinted, gleamed, shimmered, twinkled, palpable, cacophony, gossamer, labyrinthine, bioluminescent, ministrations, camaraderie, ethereal, bustling, "smell of ozone", "practiced ease", "reckless abandon", "unshed tears", solace, fleeting.

Names: Elara, Kael, Elias (Thorne), Seraphina, Lyra, Mara, Eldoria, Aethelgard, Oakhaven, Whisperwood. Poetry: heart, embrace, whisper, echo, dance, dreams, grace.

## Stiff-synonym substitutions (Latinate → plain)

| AI/formal choice | Human choice |
|---|---|
| utilize | use |
| individuals | people |
| numerous | many |
| prior to | before |
| subsequently | then, later |
| additionally / moreover / furthermore | also, and — or nothing |
| in order to | to |
| commence | start |
| terminate | end, stop |
| endeavor | try |
| demonstrate | show |
| possess | have |
| ascertain | find out |
| sufficient | enough |
| approximately | about |
| in the event that | if |
| due to the fact that | because |
| a majority of | most |
| a significant number of | many |
| is able to / has the ability to | can |
| in a timely manner | on time |
| with regard to | about, on |
| aforementioned | this, that |
| nevertheless / nonetheless | still, but |
| whilst | while |
| authored | wrote |
| relocated | moved |
| attempted | tried |
| passed away | died (where plain register fits) |
| serves as / stands as | is |
| plays a crucial role in | is key to, helps |
| a wide range of | many |
| shed light on | explain, show |
| pave the way for | enable, lead to |
| navigate the complexities of | handle, deal with |

## Grep pass

A quick final check over any draft (case-insensitive):

```
delve|underscor|showcas|tapestry|testament|pivotal|crucial|meticulous|intricate|
commendable|boasts|vibrant|realm|leverag|seamless|holistic|multifaceted|garner|
groundbreaking|paramount|plethora|myriad|foster|harness|bolster|amidst|nestled|
breathtaking|renowned|game-chang|cutting-edge|ever-evolving|utilize|facilitate|
elucidate|spearhead|transformative|noteworthy|empower|streamline|revolutioniz
```

Plus phrase templates: `important to note|worth noting|In today's|ever-evolving|In conclusion|In summary|when it comes to|not only|not just|isn't just|it's not about|serves as|stands as|whether you're|look no further|dive in|let that sink in|here's the thing|at its core|hope this (email )?finds you`

Plus artifacts: `as an AI|language model|knowledge update|knowledge cutoff|real-time data|oaicite|turn0|contentReference|utm_source=|\[insert|\[Your|{company|XX-XX`
