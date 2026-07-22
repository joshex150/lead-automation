# Compliance & responsible outreach

This system does cold B2B outreach to **publicly listed Nigerian businesses**. It is built to respect Nigeria's **Data Protection Act (NDPA)**, in particular the right to object to processing of personal data for direct marketing, and the platform rules of Google, Meta and WhatsApp.

> This document explains the controls the software enforces. It is not legal advice. Confirm your own obligations, and keep outreach honest and useful.

## Controls enforced in code

### 1. Provenance, record where data came from
Every email, phone number and Instagram handle is stored in `lead.contactSources` with its `source` (google_places / website / manual) and `sourceUrl` and a timestamp. You can always answer "where did we get this?".

### 2. Business contacts only, from public sources
- Discovery uses **Google Places** business listings.
- Enrichment reads only the **business's own public website** (homepage + a linked contact/about page).
- We target business contact points (info@, the shop's WhatsApp), not personal profiles. Instagram is used for **manual** personalisation/outreach, never automated cold DMs.

### 3. Suppression list, permanent do-not-contact
- Opting a lead out suppresses **all** its identifiers: email, phone, domain, Instagram, Google Place ID.
- Discovery checks the suppression list **before storing** a business, so a suppressed business never re-enters the pipeline, even if rediscovered months later.
- Adding a suppression entry retroactively archives every matching existing lead.

### 4. Right to object, one-click and one-reply opt-out
- Every outgoing email includes a footer: *"If you'd rather not hear from us again, just reply 'unsubscribe' and we won't contact you further."*
- Recording an `OPT_OUT` response (or the dashboard "Opt out" button) immediately suppresses and archives the lead.

### 5. Don't pester non-responders
- **Exactly one** follow-up per lead, only after `FOLLOW_UP_DAYS`, and only if there's been **no response**.
- Hard cap `MAX_CONTACT_ATTEMPTS` (default 2 total touches).
- Any response, positive, negative, or opt-out, cancels all future follow-ups.

### 6. Volume discipline
- `DAILY_EMAIL_CAP` limits sends per day (protects deliverability and avoids spamming).
- The website checker and enrichment identify as `YEANLeadBot/1.0` with a contact URL and read pages politely (single homepage + one contact page, capped size).

## Channel policy (matches the plan)

| Channel | Policy |
|---|---|
| **Email** | Primary automated channel. Draft → your approval → send → one follow-up. Unsubscribe line always present. |
| **Instagram** | **No cold-DM bot.** The dashboard generates the message and gives you *Open profile* + *Copy message* + *Mark contacted*. You send manually, protecting YEAN's account and respecting Meta's rules. |
| **WhatsApp** | **Not** used for cold outreach. WhatsApp Business Platform requires prior opt-in for template messages. Reserve WhatsApp for businesses that invited enquiries, previously interacted, or submitted their number. The system stores WhatsApp availability but does not auto-message. |

## Operator checklist

- [ ] Use a real sending domain with SPF/DKIM/DMARC; warm it up.
- [ ] Keep `DAILY_EMAIL_CAP` low initially (10-20/day).
- [ ] Honour every opt-out immediately (the system does this automatically on `OPT_OUT`).
- [ ] Keep pitches specific and useful, lead with a real observation about their business, never a generic blast.
- [ ] Periodically review the suppression list and bounced addresses.
- [ ] Don't scrape or store personal social accounts; stick to business contact points.
