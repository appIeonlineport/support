# SELL2AI

**Your store is open to people. Make it legible to machines.**

SELL2AI is an agent-commerce readiness product for public ecommerce storefronts. It scans machine-readable commerce signals, explains what is missing, simulates a deterministic buyer-agent decision, and generates implementation files for common gaps.

## Production

- Landing page: `https://sell2ai.vercel.app`
- Merchant console: `https://sell2ai.vercel.app/dashboard.html`
- Deployment: Vercel project `sell2ai`
- Git source: this repository, `main` branch

The Vercel project is separate from the existing `imessagehub` project.

## Product modules

### 1. Deep Scanner v0.2
`GET /api/scan?url=https://store.example`

The scanner currently checks a safe public sample including:
- homepage
- `robots.txt`
- sitemap discovery
- up to four same-origin product/catalog candidate pages
- Product / Offer JSON-LD
- price and currency
- availability
- canonical / description / Open Graph metadata
- shipping / returns
- privacy / terms
- cart / checkout signals
- catalog/search clues
- platform fingerprinting
- HTTPS

Network safety includes DNS validation, private/local IP blocking, redirect re-validation, timeouts and response-size limits.

### 2. Merchant Console
`/dashboard.html`

The console supports:
- add/re-scan stores
- latest readiness report
- multiple store workspaces
- local beta history immediately
- Supabase magic-link auth and synced history when the isolated backend is configured

Backend schema is versioned in:
`supabase/migrations/001_sell2ai.sql`

### 3. AI Buyer Test
`POST /api/buyer-test`

Input:
```json
{
  "url": "https://store.example",
  "query": "Find me a fragrance-free serum under $35 for oily skin."
}
```

The result is a deterministic heuristic simulation based on public catalog data. It is intentionally not described as reproducing rankings from OpenAI, Google, Anthropic or any other third-party AI system.

### 4. Fix Pack
`POST /api/fixes`

Generates:
- `product-schema.jsonld`
- `merchant-feed.example.json`
- `sell2ai-fix-checklist.md`
- platform-aware implementation guidance

### 5. Subscription plumbing
`POST /api/checkout`

Plans in the product UI:
- Starter — $19/month
- Growth — $49/month
- Agency — $249/month

The endpoint uses Stripe Checkout when the following Vercel environment variables are present:
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_AGENCY`

Without those values billing returns a safe 503 instead of creating a fake checkout.

### 6. Beta feedback + validation
The merchant console contains structured beta feedback for:
- scanner accuracy
- missing features
- Buyer Test
- Fix Pack
- pricing
- general feedback

A production benchmark validated the live scanner against 20 public ecommerce storefronts. The run completed **20/20 live responses**, including Shopify and custom storefront examples.

## Public configuration

`GET /api/public-config` returns only safe client-side configuration:
- Supabase URL / anonymous key when configured
- boolean Supabase readiness
- boolean Stripe readiness
- public plan labels

No secret keys are exposed.

## Supabase activation

SELL2AI should use its own isolated Supabase project. Do not reuse `imessagehub` or `NX Leads Hub`.

After creating the SELL2AI project:
1. apply `supabase/migrations/001_sell2ai.sql`
2. configure magic-link redirect for the production domain
3. add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Vercel
4. re-deploy
5. verify RLS/security advisors

Until then the merchant console runs in a local browser beta workspace.

## QA

`.github/workflows/sell2ai-smoke.yml` verifies:
- production homepage
- merchant console
- Scanner v0.2
- Buyer Test API
- Fix Pack API
- private-network blocking
- billing safety
- optional 20-store public benchmark

## Product principle

Free diagnostics should remain genuinely useful. Paid plans should monetize monitoring, history, automation, integrations and measurable commerce outcomes—not obscure the basic score behind a paywall.

## Important limitation

A SELL2AI readiness score is a proprietary heuristic based on signals the scanner can observe. Improving the score does not guarantee recommendation, ranking, discovery or checkout support by any third-party AI platform.
