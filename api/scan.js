import dns from "node:dns/promises";
import net from "node:net";

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const p = ip.split(".").map(Number);
    return (
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      p[0] >= 224
    );
  }
  if (version === 6) {
    const n = ip.toLowerCase();
    return (
      n === "::1" ||
      n === "::" ||
      n.startsWith("fc") ||
      n.startsWith("fd") ||
      n.startsWith("fe8") ||
      n.startsWith("fe9") ||
      n.startsWith("fea") ||
      n.startsWith("feb")
    );
  }
  return true;
}

async function validatePublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS targets are supported.");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Private network targets are blocked.");
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private network targets are blocked.");
  } else {
    let records;
    try {
      records = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new Error("Unable to resolve that domain.");
    }
    if (!records.length || records.some((r) => isPrivateIp(r.address))) {
      throw new Error("Private or unresolved network targets are blocked.");
    }
  }

  return url;
}

async function fetchPublicHtml(initialUrl) {
  let current = await validatePublicUrl(initialUrl);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;

    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "SELL2AI-Scanner/0.1 (+https://sell2ai.example)",
          accept: "text/html,application/xhtml+xml"
        }
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Target website timed out.");
      throw new Error("Could not reach the target website.");
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (i === MAX_REDIRECTS) throw new Error("Too many redirects.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Website returned an invalid redirect.");
      current = await validatePublicUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`Website returned HTTP ${response.status}.`);
    }

    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      throw new Error("Target did not return an HTML page.");
    }

    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > MAX_HTML_BYTES) {
      throw new Error("Page is too large to scan safely.");
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer).slice(0, MAX_HTML_BYTES);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    return {
      html,
      finalUrl: current.toString(),
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    };
  }

  throw new Error("Unable to complete scan.");
}

function has(html, pattern) {
  return pattern.test(html);
}

function count(html, pattern) {
  const matches = html.match(pattern);
  return matches ? matches.length : 0;
}

function stripTags(input = "") {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]).slice(0, 160) : "";
}

function analyze(html, url) {
  const lower = html.toLowerCase();

  const jsonLdCount = count(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi);
  const hasProductSchema =
    has(html, /["']@type["']\s*:\s*["']product["']/i) ||
    has(html, /itemtype=["'][^"']*schema\.org\/product/i);
  const hasOfferSchema =
    has(html, /["']@type["']\s*:\s*["']offer["']/i) ||
    has(html, /schema\.org\/offer/i);
  const hasPrice =
    has(html, /["']price["']\s*:/i) ||
    has(html, /itemprop=["']price["']/i) ||
    has(html, /product:price:amount/i);
  const hasCurrency =
    has(html, /["']pricecurrency["']\s*:/i) ||
    has(html, /itemprop=["']pricecurrency["']/i) ||
    has(html, /product:price:currency/i);
  const hasAvailability =
    has(html, /["']availability["']\s*:/i) ||
    has(html, /schema\.org\/(instock|outofstock|preorder)/i);
  const hasCanonical = has(html, /<link[^>]+rel=["']canonical["']/i);
  const hasDescription =
    has(html, /<meta[^>]+name=["']description["'][^>]+content=/i) ||
    has(html, /<meta[^>]+content=[^>]+name=["']description["']/i);
  const hasOg =
    has(html, /property=["']og:title["']/i) &&
    has(html, /property=["']og:description["']/i);
  const hasPolicyLinks =
    /(shipping|delivery)[^<]{0,80}(policy|information|details)|href=["'][^"']*(shipping|delivery)/i.test(lower);
  const hasReturns =
    /(return|refund)[^<]{0,80}(policy|information|details)|href=["'][^"']*(return|refund)/i.test(lower);
  const hasPrivacy = /href=["'][^"']*privacy|privacy policy/i.test(lower);
  const hasTerms = /href=["'][^"']*(terms|conditions)|terms (of|&amp;|and) conditions/i.test(lower);
  const hasSearch = /type=["']search["']|aria-label=["'][^"']*search|placeholder=["'][^"']*search/i.test(lower);
  const hasCart = /href=["'][^"']*(cart|basket)|add to cart|add-to-cart/i.test(lower);
  const hasCheckout = /href=["'][^"']*checkout|\bcheckout\b/i.test(lower);
  const productHints = count(lower, /(add to cart|product-card|product__|product-item|woocommerce|shopify)/g);
  const scriptBlocked = /noindex/i.test(lower) && /robots/i.test(lower);

  const checks = [];
  let score = 0;
  const add = (condition, points, title, passDetail, failDetail, impact = "medium") => {
    if (condition) {
      score += points;
      checks.push({ status: "pass", title, detail: passDetail, impact: "pass" });
    } else {
      checks.push({ status: impact === "high" ? "fail" : "warn", title, detail: failDetail, impact });
    }
  };

  add(hasProductSchema, 18, "Product structured data",
    "Schema.org Product markup is present.",
    "No clear Product structured data was detected. AI buyers may struggle to identify product entities.", "high");

  add(hasOfferSchema && hasPrice && hasCurrency, 18, "Machine-readable pricing",
    "Offer, price and currency signals are exposed.",
    "Expose Offer markup with price and priceCurrency so agents can compare products reliably.", "high");

  add(hasAvailability, 8, "Availability signal",
    "Stock/availability markup is detectable.",
    "No machine-readable availability signal was detected.", "medium");

  add(jsonLdCount > 0, 8, "JSON-LD structured data",
    `${jsonLdCount} JSON-LD block${jsonLdCount === 1 ? "" : "s"} detected.`,
    "No JSON-LD block was detected on the scanned page.", "medium");

  add(hasDescription && hasCanonical && hasOg, 10, "Core page metadata",
    "Description, canonical URL and Open Graph metadata are present.",
    "Important metadata is incomplete; this weakens machine interpretation and sharing context.", "medium");

  add(hasPolicyLinks && hasReturns, 12, "Shipping & returns discoverability",
    "Shipping/delivery and return/refund signals are discoverable.",
    "Make shipping and return/refund policies prominent and machine-readable.", "high");

  add(hasPrivacy && hasTerms, 7, "Trust policy links",
    "Privacy and terms links are detectable.",
    "Privacy and/or terms links were not clearly detectable.", "medium");

  add(hasCart || hasCheckout, 8, "Commerce flow signals",
    "Cart or checkout language is visible to the scanner.",
    "No clear cart or checkout signal was detected on this page.", "medium");

  add(hasSearch || productHints > 1, 6, "Catalog discovery hints",
    "The page exposes search or repeated product/catalog patterns.",
    "Catalog discovery signals are weak on the scanned page.", "low");

  const usesHttps = url.startsWith("https://");
  add(usesHttps, 5, "HTTPS transport",
    "The storefront is served over HTTPS.",
    "Use HTTPS for all commerce pages.", "high");

  if (scriptBlocked) {
    score = Math.max(0, score - 8);
    checks.unshift({
      status: "warn",
      title: "Indexing restriction detected",
      detail: "A robots/noindex signal may limit automated discovery of this page.",
      impact: "high"
    });
  }

  score = Math.max(0, Math.min(100, score));

  const highest = checks.filter((c) => c.status !== "pass").slice(0, 3).map((c) => c.title);
  const summary =
    score >= 80
      ? "Strong foundation. Focus next on transaction-specific agent integrations and continuous monitoring."
      : score >= 55
      ? `The store has useful machine-readable signals, but key gaps remain${highest.length ? ": " + highest.join(", ") : ""}.`
      : `AI buyers may struggle to understand or transact with this storefront. Start with the highest-impact structured commerce gaps${highest.length ? ": " + highest.join(", ") : ""}.`;

  return {
    score,
    checks,
    summary,
    detected: {
      jsonLdBlocks: jsonLdCount,
      productSchema: hasProductSchema,
      offerSchema: hasOfferSchema,
      price: hasPrice,
      currency: hasCurrency,
      availability: hasAvailability,
      cart: hasCart,
      checkout: hasCheckout,
      title: extractTitle(html)
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!raw) {
    res.status(400).json({ error: "Missing ?url= parameter." });
    return;
  }

  let normalized = raw.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

  try {
    const fetched = await fetchPublicHtml(normalized);
    const analysis = analyze(fetched.html, fetched.finalUrl);
    const final = new URL(fetched.finalUrl);

    res.status(200).json({
      ok: true,
      mode: "live",
      scanId: `scan_${Date.now().toString(36)}`,
      scannedAt: new Date().toISOString(),
      url: fetched.finalUrl,
      domain: final.hostname,
      httpStatus: fetched.status,
      ...analysis
    });
  } catch (error) {
    res.status(422).json({
      ok: false,
      error: error?.message || "Unable to scan that website."
    });
  }
}
