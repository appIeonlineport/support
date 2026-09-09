import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 1500000;
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 4;
const STOPWORDS = new Set(["the","and","for","with","that","this","from","under","below","than","find","show","need","want","best","product","item","buy","please","something","one","your","you","our","are","was","were"]);

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  if (v === 6) {
    const n = ip.toLowerCase();
    return n === "::1" || n === "::" || n.startsWith("fc") || n.startsWith("fd") ||
      n.startsWith("fe8") || n.startsWith("fe9") || n.startsWith("fea") || n.startsWith("feb");
  }
  return true;
}

export async function validatePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Invalid URL."); }
  if (!["http:","https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS targets are supported.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private network targets are blocked.");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private network targets are blocked.");
  } else {
    let records;
    try { records = await dns.lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error("Unable to resolve that domain."); }
    if (!records.length || records.some(function(r){ return isPrivateIp(r.address); })) {
      throw new Error("Private or unresolved network targets are blocked.");
    }
  }
  return url;
}

async function fetchPublic(raw, accept) {
  let current = await validatePublicUrl(raw);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "SELL2AI-Scanner/0.2 (+https://sell2ai.vercel.app)",
          accept: accept || "text/html,application/xhtml+xml,text/plain,application/xml,text/xml"
        }
      });
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("Target website timed out.");
      throw new Error("Could not reach the target website.");
    } finally {
      clearTimeout(timer);
    }

    if ([301,302,303,307,308].includes(response.status)) {
      if (i === MAX_REDIRECTS) throw new Error("Too many redirects.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Website returned an invalid redirect.");
      current = await validatePublicUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw new Error("Website returned HTTP " + response.status + ".");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) throw new Error("Page is too large to scan safely.");
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer).slice(0, MAX_BYTES);
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      finalUrl: current.toString(),
      status: response.status,
      contentType: (response.headers.get("content-type") || "").toLowerCase()
    };
  }
  throw new Error("Unable to complete fetch.");
}

function stripTags(input) {
  return String(input || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ").trim();
}

function clean(input, max) { return stripTags(input).slice(0, max || 1000); }

function meta(html, key) {
  const escaped = key.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const a = new RegExp("<meta[^>]+(?:name|property)=[\"']" + escaped + "[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>", "i");
  const b = new RegExp("<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:name|property)=[\"']" + escaped + "[\"'][^>]*>", "i");
  const m = html.match(a) || html.match(b);
  return m ? clean(m[1], 500) : "";
}

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? clean(m[1], 300) : "";
}

function jsonLdRoots(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 30) {
    try { out.push(JSON.parse(m[1].trim())); } catch {}
  }
  return out;
}

function flatten(value, out) {
  out = out || [];
  if (!value) return out;
  if (Array.isArray(value)) { value.forEach(function(x){ flatten(x, out); }); return out; }
  if (typeof value !== "object") return out;
  out.push(value);
  if (Array.isArray(value["@graph"])) value["@graph"].forEach(function(x){ flatten(x, out); });
  return out;
}

function isType(obj, name) {
  const t = obj && obj["@type"];
  if (Array.isArray(t)) return t.some(function(x){ return String(x).toLowerCase() === name.toLowerCase(); });
  return String(t || "").toLowerCase() === name.toLowerCase();
}

function offerOf(raw) {
  const offer = Array.isArray(raw) ? raw[0] : raw;
  if (!offer || typeof offer !== "object") return {};
  const price = Number(offer.price != null ? offer.price : (offer.lowPrice != null ? offer.lowPrice : offer.highPrice));
  return {
    price: Number.isFinite(price) ? price : null,
    currency: String(offer.priceCurrency || "").toUpperCase() || null,
    availability: String(offer.availability || "").split("/").pop() || null,
    url: offer.url || null
  };
}

function productsFromPage(html, pageUrl) {
  const products = [];
  const nodes = jsonLdRoots(html).flatMap(function(root){ return flatten(root, []); });
  nodes.forEach(function(node){
    if (!isType(node, "Product")) return;
    const off = offerOf(node.offers);
    const brand = typeof node.brand === "string" ? node.brand : (node.brand && node.brand.name);
    products.push({
      name: clean(node.name, 180),
      description: clean(node.description, 900),
      brand: clean(brand, 120) || null,
      sku: clean(node.sku || node.mpn, 100) || null,
      image: Array.isArray(node.image) ? node.image[0] : (node.image || null),
      url: node.url ? new URL(node.url, pageUrl).toString() : pageUrl,
      price: off.price,
      currency: off.currency,
      availability: off.availability,
      offerUrl: off.url ? new URL(off.url, pageUrl).toString() : null,
      source: "jsonld"
    });
  });

  if (!products.length) {
    const ogType = meta(html, "og:type").toLowerCase();
    const amount = Number(meta(html, "product:price:amount"));
    const name = meta(html, "og:title") || titleOf(html);
    const likely = ogType.includes("product") || /add to cart|add-to-cart|itemprop=["']price["']|product:price:amount/i.test(html);
    if (likely && name) {
      products.push({
        name: name,
        description: meta(html, "og:description") || meta(html, "description"),
        brand: null,
        sku: null,
        image: meta(html, "og:image") || null,
        url: pageUrl,
        price: Number.isFinite(amount) && amount > 0 ? amount : null,
        currency: meta(html, "product:price:currency").toUpperCase() || null,
        availability: null,
        offerUrl: null,
        source: "page"
      });
    }
  }
  return products;
}

function dedupeProducts(items) {
  const seen = new Set();
  return items.filter(function(p){
    const key = String(p.url || "").toLowerCase() + "|" + String(p.name || "").toLowerCase();
    if (!p.name || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function pageSignals(html, url) {
  const lower = html.toLowerCase();
  const roots = jsonLdRoots(html);
  const products = productsFromPage(html, url);
  const nodes = roots.flatMap(function(root){ return flatten(root, []); });
  return {
    title: titleOf(html),
    description: meta(html, "description"),
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    og: Boolean(meta(html, "og:title") && meta(html, "og:description")),
    jsonLdCount: roots.length,
    productSchema: products.some(function(p){ return p.source === "jsonld"; }) || /schema\.org\/product/i.test(html),
    offerSchema: nodes.some(function(n){ return isType(n, "Offer"); }) || /schema\.org\/offer/i.test(html),
    price: products.some(function(p){ return p.price != null; }) || /["']price["']\s*:|itemprop=["']price["']|product:price:amount/i.test(html),
    currency: products.some(function(p){ return p.currency; }) || /["']pricecurrency["']\s*:|itemprop=["']pricecurrency["']|product:price:currency/i.test(html),
    availability: products.some(function(p){ return p.availability; }) || /["']availability["']\s*:|schema\.org\/(instock|outofstock|preorder)/i.test(html),
    shipping: /(shipping|delivery)[^<]{0,90}(policy|information|details|rates)|href=["'][^"']*(shipping|delivery)/i.test(lower),
    returns: /(return|refund)[^<]{0,90}(policy|information|details)|href=["'][^"']*(return|refund)/i.test(lower),
    privacy: /href=["'][^"']*privacy|privacy policy/i.test(lower),
    terms: /href=["'][^"']*(terms|conditions)|terms (of|&amp;|and) conditions/i.test(lower),
    search: /type=["']search["']|aria-label=["'][^"']*search|placeholder=["'][^"']*search/i.test(lower),
    cart: /href=["'][^"']*(cart|basket)|add to cart|add-to-cart/i.test(lower),
    checkout: /href=["'][^"']*checkout|\bcheckout\b/i.test(lower),
    noindex: /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(lower),
    products: products
  };
}

function linksFrom(html, base) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 250) {
    try {
      const u = new URL(m[1], base);
      if (["http:","https:"].includes(u.protocol)) { u.hash = ""; out.push(u.toString()); }
    } catch {}
  }
  return Array.from(new Set(out));
}

function productPathScore(raw) {
  try {
    const p = new URL(raw).pathname.toLowerCase();
    let s = 0;
    if (/\/products?\//.test(p)) s += 6;
    if (/\/shop\//.test(p) || /\/p\//.test(p)) s += 3;
    if (/product|item|sku/.test(p)) s += 2;
    if (/collection|category|catalog/.test(p)) s += 1;
    if (/cart|checkout|account|login|privacy|terms|blog|news|contact|about/.test(p)) s -= 5;
    return s;
  } catch { return -10; }
}

function platformOf(html) {
  const l = html.toLowerCase();
  const rows = [
    ["Shopify",[/cdn\.shopify\.com/,/shopify-section/,/myshopify\.com/]],
    ["WooCommerce",[/woocommerce/,/wp-content\/plugins\/woocommerce/,/wc-ajax/]],
    ["BigCommerce",[/bigcommerce/,/bigcommerce\.com/,/stencil-utils/]],
    ["Magento",[/magento/,/mage\/cookies/,/static\/version\d+\/frontend/]],
    ["Wix",[/wixstatic\.com/,/wixstores/]],
    ["Squarespace",[/static1\.squarespace\.com/,/squarespace-commerce/]],
    ["Webflow",[/webflow\.js/,/data-wf-page=/]],
    ["Shopware",[/shopware/,/store-api/]]
  ];
  for (const row of rows) if (row[1].some(function(re){ return re.test(l); })) return row[0];
  return "Custom / unknown";
}

async function optionalText(url) {
  try { return (await fetchPublic(url, "text/plain,application/xml,text/xml,text/html")).text; }
  catch { return ""; }
}

function sitemapUrls(xml, origin) {
  const out = []; const re = /<loc>\s*([^<]+)\s*<\/loc>/gi; let m;
  while ((m = re.exec(xml)) && out.length < 80) {
    try { const u = new URL(clean(m[1], 1000)); if (u.origin === origin) out.push(u.toString()); } catch {}
  }
  return Array.from(new Set(out));
}

function check(ok, points, title, pass, fail, impact) {
  return { points: points, earned: ok ? points : 0, status: ok ? "pass" : (impact === "high" ? "fail" : "warn"),
    title: title, detail: ok ? pass : fail, impact: ok ? "pass" : impact };
}

export async function scanSite(rawUrl) {
  let normalized = String(rawUrl || "").trim();
  if (!normalized) throw new Error("Missing website URL.");
  if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

  const home = await fetchPublic(normalized, "text/html,application/xhtml+xml");
  if (!home.contentType.includes("text/html") && !home.contentType.includes("application/xhtml+xml")) {
    throw new Error("Target did not return an HTML page.");
  }

  const root = new URL(home.finalUrl);
  const origin = root.origin;
  const homeSignals = pageSignals(home.text, home.finalUrl);
  const homeLinks = linksFrom(home.text, home.finalUrl).filter(function(x){ try { return new URL(x).origin === origin; } catch { return false; } });

  const robotsUrl = new URL("/robots.txt", origin).toString();
  const robotsText = await optionalText(robotsUrl);
  const sitemapHints = Array.from(robotsText.matchAll(/^\s*sitemap:\s*(.+)$/gim)).map(function(m){ return clean(m[1],1000); }).slice(0,3);
  const maps = await Promise.all([optionalText(new URL("/sitemap.xml",origin).toString())].concat(sitemapHints.map(optionalText)));
  const siteUrls = Array.from(new Set(maps.flatMap(function(x){ return sitemapUrls(x, origin); })));

  const candidates = Array.from(new Set(homeLinks.concat(siteUrls)))
    .filter(function(x){ return x !== home.finalUrl && productPathScore(x) > 0; })
    .sort(function(a,b){ return productPathScore(b) - productPathScore(a); })
    .slice(0, MAX_PAGES);

  const extra = await Promise.all(candidates.map(async function(url){
    try {
      const r = await fetchPublic(url, "text/html,application/xhtml+xml");
      if (!r.contentType.includes("text/html") && !r.contentType.includes("application/xhtml+xml")) return null;
      return { url:r.finalUrl, html:r.text, signals:pageSignals(r.text,r.finalUrl) };
    } catch { return null; }
  }));

  const pages = [{url:home.finalUrl,html:home.text,signals:homeSignals}].concat(extra.filter(Boolean));
  const products = dedupeProducts(pages.flatMap(function(p){ return p.signals.products; })).slice(0,40);
  const platform = platformOf(home.text);
  const any = function(key){ return pages.some(function(p){ return p.signals[key]; }); };
  const robotsAllows = robotsText && !/user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(?:\r?\n|$)/i.test(robotsText);

  const checks = [
    check(any("productSchema"),16,"Product structured data","Structured product entities were detected.","No clear Product structured data was detected on the scanned sample.","high"),
    check(any("offerSchema") && any("price") && any("currency"),14,"Machine-readable pricing","Offer, price and currency signals are exposed.","Expose Offer markup with price and priceCurrency.","high"),
    check(any("availability"),8,"Availability signal","Stock/availability markup is detectable.","No machine-readable availability signal was detected.","medium"),
    check(pages.some(function(p){ return p.signals.jsonLdCount > 0; }),8,"JSON-LD structured data","JSON-LD is present.","No JSON-LD block was detected.","medium"),
    check(pages.some(function(p){ return p.signals.description && p.signals.canonical && p.signals.og; }),8,"Core page metadata","Description, canonical and Open Graph metadata are present on a key page.","Important metadata is incomplete.","medium"),
    check(any("shipping") && any("returns"),12,"Shipping & returns discoverability","Shipping and return/refund signals are discoverable.","Make shipping and return/refund policies prominent and machine-readable.","high"),
    check(any("privacy") && any("terms"),6,"Trust policy links","Privacy and terms links are detectable.","Privacy and/or terms links were not clearly detectable.","medium"),
    check(any("cart") || any("checkout"),8,"Commerce flow signals","Cart or checkout signals are visible.","No clear cart or checkout signal was detected.","medium"),
    check(any("search") || products.length > 1,6,"Catalog discovery hints","Catalog/search or repeated product patterns are detectable.","Catalog discovery signals are weak.","low"),
    check(siteUrls.length > 0,5,"Sitemap discovery",String(siteUrls.length) + " same-origin sitemap URLs discovered.","No usable sitemap URLs were discovered.","medium"),
    check(Boolean(robotsText) && robotsAllows,4,"robots.txt accessibility","robots.txt is reachable and does not appear to block the entire site.",robotsText ? "robots.txt may broadly block automated access." : "robots.txt was not reachable.","medium"),
    check(platform !== "Custom / unknown",2,"Commerce platform fingerprint",platform + " signals detected.","No common commerce platform fingerprint was detected.","low"),
    check(home.finalUrl.startsWith("https://"),3,"HTTPS transport","The storefront is served over HTTPS.","Use HTTPS for all commerce pages.","high")
  ];

  if (pages.some(function(p){ return p.signals.noindex; })) {
    checks.unshift({points:0,earned:0,status:"warn",title:"Indexing restriction detected",detail:"A noindex signal appears on at least one scanned page.",impact:"high"});
  }

  const score = Math.max(0,Math.min(100,checks.reduce(function(sum,c){ return sum + c.earned; },0)));
  const highest = checks.filter(function(c){ return c.status !== "pass"; }).slice(0,3).map(function(c){ return c.title; });
  const summary = score >= 80 ? "Strong machine-readable commerce foundation. Focus next on transaction-specific agent integrations and continuous monitoring." :
    score >= 55 ? "Useful commerce signals are present, but key gaps remain: " + highest.join(", ") + "." :
    "AI buyers may struggle to understand or transact with this storefront. Start with: " + highest.join(", ") + ".";

  return {
    ok:true,mode:"live",version:"0.2",
    scanId:"scan_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7),
    scannedAt:new Date().toISOString(),url:home.finalUrl,domain:root.hostname,platform:platform,score:score,summary:summary,
    checks:checks.map(function(c){ return {status:c.status,title:c.title,detail:c.detail,impact:c.impact}; }),
    scoring:checks.map(function(c){ return {title:c.title,points:c.points,earned:c.earned}; }),
    pages:pages.map(function(p){ return {url:p.url,title:p.signals.title,productSchema:p.signals.productSchema,price:p.signals.price,currency:p.signals.currency,availability:p.signals.availability,jsonLdCount:p.signals.jsonLdCount}; }),
    detected:{products:products.length,productPages:pages.filter(function(p){return p.signals.products.length>0;}).length,jsonLdBlocks:pages.reduce(function(s,p){return s+p.signals.jsonLdCount;},0),robotsTxt:Boolean(robotsText),sitemapUrls:siteUrls.length,platform:platform},
    products:products,
    discovery:{robotsUrl:robotsUrl,robotsReachable:Boolean(robotsText),sitemapSample:siteUrls.slice(0,12),scannedInternalPages:pages.slice(1).map(function(p){return p.url;})}
  };
}

export function parseBuyerIntent(query) {
  const text = String(query || "").trim();
  const money = text.match(/([$€£₹¥])\s*([0-9]+(?:\.[0-9]+)?)/) || text.match(/(?:under|below|less than|max(?:imum)?|up to)\s*([0-9]+(?:\.[0-9]+)?)/i);
  let budget = null, currency = null;
  const symbols = {"$":"USD","€":"EUR","£":"GBP","₹":"INR","¥":"JPY"};
  if (money) {
    if (money[2]) { budget = Number(money[2]); currency = symbols[money[1]] || null; }
    else budget = Number(money[1]);
  }
  const explicit = text.match(/\b(USD|EUR|GBP|INR|CAD|AUD|AED|SGD|JPY)\b/i);
  if (explicit) currency = explicit[1].toUpperCase();
  const tokens = Array.from(new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g," ").split(/\s+/)
    .filter(function(t){ return t.length > 2 && !STOPWORDS.has(t) && !/^\d/.test(t); }))).slice(0,18);
  return {raw:text,budget:Number.isFinite(budget)?budget:null,currency:currency,tokens:tokens};
}

export function runBuyerTest(report, query) {
  const intent = parseBuyerIntent(query);
  const ranked = (report.products || []).map(function(product){
    const hay = [product.name,product.brand,product.description,product.sku].filter(Boolean).join(" ").toLowerCase();
    const matched = intent.tokens.filter(function(t){ return hay.includes(t); });
    const missing = intent.tokens.filter(function(t){ return !hay.includes(t); });
    let score = 20; const reasons = [], gaps = [];
    if (intent.tokens.length) {
      score += Math.round((matched.length / intent.tokens.length) * 45);
      if (matched.length) reasons.push("Matches: " + matched.slice(0,5).join(", "));
      if (missing.length) gaps.push("Intent terms not explicit: " + missing.slice(0,4).join(", "));
    } else score += 10;
    if (product.price != null) {
      score += 8; reasons.push("Price is explicit: " + (product.currency || "") + " " + product.price);
      if (intent.budget != null) {
        const comparable = !intent.currency || !product.currency || intent.currency === product.currency;
        if (comparable && product.price <= intent.budget) { score += 12; reasons.push("Within stated budget."); }
        else if (comparable) { score -= 25; gaps.push("Price is above the stated budget."); }
        else gaps.push("Currency differs from the shopper request; no FX conversion was assumed.");
      }
    } else gaps.push("Machine-readable price is missing.");
    if (product.currency) score += 4; else gaps.push("Price currency is missing.");
    if (product.availability) { score += 6; reasons.push("Availability signal: " + product.availability); }
    else gaps.push("Availability is not explicit.");
    const policies = (report.checks || []).some(function(c){ return c.title === "Shipping & returns discoverability" && c.status === "pass"; });
    if (policies) { score += 5; reasons.push("Shipping/return trust signals are exposed."); } else gaps.push("Shipping/returns confidence is weak.");
    return {product:product,confidence:Math.max(0,Math.min(99,score)),matchedTokens:matched,reasons:reasons,gaps:gaps};
  }).sort(function(a,b){ return b.confidence-a.confidence; });

  return {
    mode:"heuristic_buyer_test",
    disclaimer:"This simulates a buyer-agent decision using public catalog signals and deterministic scoring. It does not claim to reproduce any third-party AI model's ranking.",
    intent:intent,candidates:ranked.slice(0,5),winner:ranked[0] || null
  };
}

export function generateFixPack(report) {
  const first = (report.products || [])[0] || {};
  const failing = (report.checks || []).filter(function(c){ return c.status !== "pass"; });
  const fixes = [];
  function add(id,title,why,action,impact){ fixes.push({id:id,title:title,why:why,action:action,impact:impact||"medium"}); }
  failing.forEach(function(c){
    if (c.title === "Product structured data") add("product-schema","Add Product JSON-LD","AI buyers need an explicit product entity.","Publish Product JSON-LD on each product detail page.","high");
    else if (c.title === "Machine-readable pricing") add("offer-schema","Expose Offer + priceCurrency","Visible prices are not always reliably machine-readable.","Include Offer.price and Offer.priceCurrency in structured data.","high");
    else if (c.title === "Availability signal") add("availability","Expose stock availability","Agents need to know whether the item can actually be purchased.","Use schema.org availability values such as InStock or OutOfStock.","medium");
    else if (c.title === "Shipping & returns discoverability") add("policies","Normalize shipping and return policy links","Delivery and trust constraints affect buying decisions.","Link clear shipping and return/refund policies from key commerce pages.","high");
    else if (c.title === "Sitemap discovery") add("sitemap","Publish a product-aware sitemap","A sitemap improves machine discovery of product URLs.","Expose /sitemap.xml and include canonical product pages.","medium");
    else if (c.title === "robots.txt accessibility") add("robots","Review robots.txt","Broad blocking can prevent automated discovery.","Allow public product/catalog paths unless deliberately blocked.","medium");
    else if (c.title === "Core page metadata") add("metadata","Complete canonical and social metadata","Consistent page identity reduces ambiguity.","Add description, canonical URL, og:title and og:description.","medium");
  });

  const schema = {
    "@context":"https://schema.org","@type":"Product",
    name:first.name || "REPLACE_WITH_PRODUCT_NAME",
    description:first.description || "REPLACE_WITH_PRODUCT_DESCRIPTION",
    sku:first.sku || "REPLACE_WITH_SKU",
    brand:first.brand ? {"@type":"Brand",name:first.brand} : {"@type":"Brand",name:"REPLACE_WITH_BRAND"},
    url:first.url || report.url,
    offers:{"@type":"Offer",url:first.offerUrl || first.url || report.url,price:first.price != null ? first.price : "REPLACE_WITH_PRICE",priceCurrency:first.currency || "USD",availability:first.availability ? "https://schema.org/" + first.availability : "https://schema.org/InStock"}
  };

  const feed = (report.products || []).slice(0,20).map(function(p){ return {id:p.sku || p.url,title:p.name,description:p.description,url:p.url,image:p.image,price:p.price,currency:p.currency,availability:p.availability}; });
  const md = ["# SELL2AI Fix Pack — " + report.domain,"","Readiness score: " + report.score + "/100","Platform: " + report.platform,"","## Priority fixes"]
    .concat(fixes.flatMap(function(f,i){ return [(i+1)+". **"+f.title+"** ["+f.impact.toUpperCase()+"]","   - Why: "+f.why,"   - Action: "+f.action]; }))
    .concat(["","## Guardrail","Re-scan after deploying changes. A higher SELL2AI score does not guarantee recommendation or ranking by any third-party AI system."]).join("\n");

  let platformInstructions = "Add the generated structured data in the product template/server-rendered page, then re-scan representative product pages.";
  if (report.platform === "Shopify") platformInstructions = "Adjust structured data in your theme/product template and validate existing theme/app Product JSON-LD before adding duplicates.";
  if (report.platform === "WooCommerce") platformInstructions = "Prefer a child theme or schema-aware WooCommerce/SEO integration and avoid duplicate Product JSON-LD.";

  return {
    report:{domain:report.domain,score:report.score,platform:report.platform,scannedAt:report.scannedAt},
    fixes:fixes,
    files:[
      {name:"product-schema.jsonld",mime:"application/ld+json",content:JSON.stringify(schema,null,2)},
      {name:"merchant-feed.example.json",mime:"application/json",content:JSON.stringify({products:feed},null,2)},
      {name:"sell2ai-fix-checklist.md",mime:"text/markdown",content:md}
    ],
    platformInstructions:platformInstructions
  };
}
