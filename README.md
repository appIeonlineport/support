# SELL2AI

**Your business, ready for AI buyers.**

SELL2AI is an agent-commerce readiness platform. The first MVP scans a public storefront and translates machine-readability problems into a simple score plus prioritized fixes.

## Current milestone — v0.1

The repository now includes:

- Responsive SELL2AI landing page
- Free website readiness scanner UI
- Real server-side scan endpoint at `/api/scan`
- URL normalization and error handling
- Product / Offer schema checks
- Machine-readable price and currency checks
- Availability detection
- JSON-LD detection
- Canonical / description / Open Graph checks
- Shipping and return/refund discoverability checks
- Privacy / terms discovery
- Cart / checkout signals
- Basic catalog discovery signals
- HTTPS check
- SSRF/private-network protection
- Redirect validation, fetch timeout and response-size limits
- Static-host demo fallback clearly labelled as demo

## Run

This project is designed for Vercel because the scanner needs a server-side function.

```bash
npm i -g vercel
vercel dev
```

Open the local URL and enter a public ecommerce website.

## Architecture

```
index.html      Product/marketing UI
styles.css      Responsive design system
app.js          Scanner UX + API client
api/scan.js     Server-side public website analyzer
vercel.json     Deployment/security config
```

No database is required for the free scanner milestone.

## Scoring v0.1

The current score is a heuristic readiness score based on detectable public-page signals. It is **not** presented as an official score from OpenAI, Google, Stripe, Anthropic or any commerce protocol.

Current weighted areas include:

1. Product structured data
2. Offer + price + currency data
3. Availability
4. JSON-LD
5. Core page metadata
6. Shipping + return policy discovery
7. Trust-policy links
8. Cart / checkout signals
9. Catalog discovery
10. HTTPS

## Next build milestones

### v0.2 — deeper crawling
- Crawl a small safe set of internal product/category pages
- Check `robots.txt`
- Check sitemap discovery
- Detect representative product pages
- Better ecommerce platform detection
- Improve scoring with page-type awareness

### v0.3 — accounts + history
- Supabase authentication
- Merchant workspaces
- Store records
- Saved scans
- Scan comparison/history
- Issue status tracking

### v0.4 — AI Buyer Test
- User enters a shopping request
- SELL2AI evaluates whether the merchant's catalog exposes enough information to answer it
- Explain why a product would or would not be selected
- Suggested structured-data fixes

### v0.5 — automated fixes
- Generated JSON-LD/Product/Offer snippets
- Merchant feed generator
- WooCommerce integration
- Custom-site installation snippet
- Policy normalization

### Later
- Agent-commerce protocol adapters
- Merchant analytics / AI referral attribution
- Multi-store agency dashboard
- White-label reports
- Subscription billing
- Multi-currency plans

## Security

The scan API intentionally rejects local/private network targets and validates redirect destinations. Do not weaken these controls when adding deeper crawling.

## Product principle

The free scanner should be genuinely useful on its own. Paid plans should monetize **continuous monitoring, automated fixes, integrations and measurable commerce outcomes**, not hide the basic diagnostic result behind a paywall.


## Deployment

SELL2AI is connected to Vercel Git deployments from the `main` branch.


<!-- SELL2AI benchmark trigger: 2026-09-09 -->
