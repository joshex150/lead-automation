# YEAN Leads launch posts

Captions and images for announcing YEAN Leads on LinkedIn and X. Copy the text
straight out of the .txt files, upload the matching PNGs from `images/`.

## Files

| File | What it is |
|---|---|
| `linkedin.txt` | One post, 2,999 characters. LinkedIn's limit is 3,000, so there is no room to add to it without cutting something first. |
| `twitter-thread.txt` | Twelve tweets, separated by `---`. The longest is 262 characters, so the whole thread posts without a premium account. |
| `twitter-single.txt` | A 273-character version if you would rather post once than run a thread. |
| `images/` | Six 3200x1800 PNGs at 2x, which is 1600x900 at 1x. |

## Which image goes where

LinkedIn takes up to nine images in one post. Suggested order, or use the first
three on their own:

1. `01-title.png`
2. `02-queue.png`
3. `04-message.png`
4. `03-score.png`
5. `05-leads.png`
6. `06-stack.png`

The thread file marks the attachment points inline, like
`[attach image: 02-queue.png]`. Delete those lines before posting; they are
notes to you, not part of the tweet, and the character counts above already
exclude them.

Six of the twelve tweets carry an image. The other six are story, and they read
better without one competing for attention.

## Image sizes

All six are 16:9. X crops in-timeline images to 16:9, so nothing important gets
cut. LinkedIn prefers 1.91:1 and will letterbox 16:9 very slightly, which looks
fine against a dark background. If you want exact LinkedIn ratios, crop 42px
from the top and bottom of each file.

## The one claim only you can check

Both captions say two companies have reached out asking to buy their own
instance. That came from you, and it is the strongest line in either post, so it
is worth being sure you are happy to say it publicly before it goes out. If
either conversation is still confidential, "a couple of companies have asked
about their own instance" says the same thing without inviting anyone to guess
who.

## Places you may want your own detail

The story opens on the real problem, which is that waiting for referrals stopped
being enough. That part came from you. What follows it is written from what the
product does, so it is true but general. It gets sharper with a specific only
you have:

- roughly how long a round of manual prospecting took you
- the month that went quiet, if there was one you remember
- a business you found this way that turned into actual work

I have not invented any of those. A made-up specific in a founder story is the
thing people notice.

## Two things to check before you post

**The numbers are real, the screenshots are not.** The figures in the captions
and on the title card (735 businesses, 356 new, 18 searches, 5.5 minutes) come
from an actual scan of Lagos and Abuja against the production database. The
screenshots are from a seeded demo database, because the real one holds real
businesses with real contact details and those should not go on the internet. No
screenshot here shows a revenue figure or a closed deal, which is deliberate:
the seeded data has both, and posting them would be claiming results that have
not happened yet.

**The business names in the screenshots are invented.** Sunday Parfums, Bayview
Pavilion, Lumen Lodge and the rest are generated, and the email addresses and
phone numbers alongside them are not real. Nobody is being exposed here, but if
anyone asks whether these are real customers, the answer is no.

## Style

Both captions follow `WRITING_STYLE.md`: no em dashes, no emoji, straight
quotes, sentence-case headings, concrete numbers instead of adjectives. The
LinkedIn post has hashtags at the end because LinkedIn still surfaces on them.
The tweets do not, because hashtags in a thread read as spam.

If you want emoji in the LinkedIn version, they would go at the start of the
line breaks, and the style guide bans them, so that is a deliberate departure
rather than an oversight.

## Regenerating the images

The compositor that built these reads the screenshots in
`dashboard/public/screens/` and renders each slide at 1600x900. If those
screenshots are retaken, the social images need re-rendering to match.
