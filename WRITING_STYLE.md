# Writing Style Guide

How to write any doc, README, pitch, or comment in this project so it reads
like a person wrote it, not a language model. Follow these rules every time.
If you are an assistant working in this repo, treat this file as binding for
prose you produce.

The short version: write plainly, vary your sentence length, cut the hype,
and never use an em dash.

---

## 1. Hard rules

These are not preferences. Do them every time.

1. No em dashes (—) and no en dashes (–). They are the single clearest tell
   of machine text. Replace each one with a period, a comma, a colon, a set
   of parentheses, or just reword the sentence. Use a plain hyphen only
   inside compound words like "self-host."
2. No emoji in headings, lists, or body text.
3. Straight quotes only ("like this"), never curly quotes.
4. Sentence case for headings, not Title Case. Write "Open questions for
   product," not "Open Questions For Product."
5. Plain hyphen for number ranges, or the word "to." Write "3 to 4 weeks"
   or "3-4 weeks," not "3–4 weeks."

---

## 2. Words and phrases to cut

Search for these and remove them. The replacement is almost always a simpler,
more direct word.

Inflated verbs, when "is" or "has" would do: serves as, stands as, boasts,
features, marks, underscores, showcases. Write "the phone has a camera," not
"the phone features a camera."

AI-vocabulary filler: delve, leverage (as a verb when "use" works), foster,
enhance, utilize, tapestry, landscape (when abstract), realm, testament,
pivotal, crucial, vibrant, seamless, robust, intricate, interplay,
additionally, moreover, furthermore.

Hype and self-praise: crown jewel, unfair advantage, best-in-class,
game-changer, cutting-edge, groundbreaking, world-class, relentlessly,
supercharge. Make a concrete claim instead.

False-gravitas openers: at its core, the real question is, what really
matters, fundamentally, the heart of the matter, it is important to note
that, it is worth noting.

Signposting: let's dive in, here's what you need to know, let's explore,
without further ado, in this section we will.

Padding: in order to (use "to"), due to the fact that (use "because"), at
this point in time (use "now"), in the event that (use "if"), has the
ability to (use "can").

---

## 3. Sentence habits to drop

The "not just X, but Y" construction. Also "it's not this, it's that." These
emphatic mirror structures read as machine-written when they pile up. Say the
positive thing directly. Instead of "it's not a feature, it's a product
line," write "it is closer to a product line than a feature."

The rule of three. Models cram everything into groups of three: three
adjectives, three nouns, three clauses, often inventing a weak third item to
fill the slot. Use the number of items the point actually needs. Two is fine.
Four is fine.

Trailing interpretive clauses. Do not state a fact and then tack on a comma
and a reading of it, like "the count hit 56,998, creating a lively
community." Give the fact, and let it stand, or make the point in its own
sentence.

Participle padding. Cut sentences that lean on "-ing" words to sound
analytical: highlighting, emphasizing, showcasing, reflecting, underscoring,
contributing to. State the point plainly.

Even cadence. Models default to a wall of medium-length sentences. Break it
up. Put a short sentence next to a long one. Read it aloud; if every sentence
has the same rhythm, fix it.

Manufactured drama. A run of clipped sentences for effect ("It works. Every
time. No setup.") sounds engineered. One short sentence for emphasis is fine.
A string of them is a tell.

---

## 4. Structure and formatting

Use bold rarely. Bolding every key term, every list label, and every acronym
is a machine habit. Reserve bold for the occasional word that genuinely needs
emphasis.

Avoid inline-header bullets like "**Performance:** the page was slow." Either
write a normal sentence or use a real heading. Tables are good for this when
you have parallel items to compare.

Do not follow a heading with a one-line sentence that just restates the
heading. Go straight to the content.

Describe the thing as it is, not as a diff from some earlier version. Write
"this uses a hash map for fast lookups," not "this replaces the old approach
with a hash map."

Cut chatbot artifacts entirely: "I hope this helps," "Of course," "Let me
know if you need anything," "Great question." The text should stand on its
own.

Do not invent filler to sound complete. If something is unknown, say it is
unknown or leave it out. Never write plausible-sounding guesses to fill a gap.

---

## 5. What human writing has that you should add

Concrete specifics. Real file names, real numbers, real commands, actual
quotes. Machines round off to safe generalities; people remember details.

Contractions. "It's," "you'll," "don't," "we're." They make prose sound
spoken rather than generated.

Honest uncertainty and trade-offs. Say where something is weak, where you are
not sure, where two options both have costs. Clean, confident conclusions on
everything are a tell. Real assessments have tension in them.

A consistent point of view. Pick "you," "we," or "I" and use plain direct
address. Talk to the reader like a colleague.

---

## 6. Pre-publish checklist

Run this before you call any prose done.

- [ ] Zero em dashes and en dashes in the file.
- [ ] No emoji, straight quotes only, sentence-case headings.
- [ ] No "not just X but Y" or "it's not A, it's B" constructions left.
- [ ] No forced groups of three. Lists are the length the point needs.
- [ ] Searched for and cut the section 2 words (serves as, delve, leverage,
      crucial, vibrant, robust, seamless, and the rest).
- [ ] Bold appears only a few times, for real emphasis.
- [ ] Sentence lengths vary. Read one paragraph aloud to check the rhythm.
- [ ] At least a few concrete specifics: names, numbers, commands.
- [ ] No chatbot sign-off lines, no signposting openers, no invented filler.

---

## 7. Quick before-and-after

Before: "ScanForge isn't just a scanner. It's a comprehensive, robust, and
seamless quality platform that fundamentally leverages a crucial crawl engine
to deliver groundbreaking results."

After: "ScanForge started as a scanner. The same crawl engine now feeds six
kinds of test, so we can sell it as a quality platform."

Before: "This serves as a testament to our cutting-edge approach, marking a
pivotal moment in QA testing."

After: "It is a real step forward for QA testing, and here is why."
