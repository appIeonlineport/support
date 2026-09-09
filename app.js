const $ = (id) => document.getElementById(id);

const heroScanForm = $("heroScanForm");
const heroUrl = $("heroUrl");
const scanForm = $("scanForm");
const scanUrl = $("scanUrl");
const scanButton = $("scanButton");
const scanState = $("scanState");
const scanStateTitle = $("scanStateTitle");
const scanStateText = $("scanStateText");
const scanError = $("scanError");
const scanEmpty = $("scanEmpty");
const scanResult = $("scanResult");
const resultDomain = $("resultDomain");
const resultScore = $("resultScore");
const resultProgress = $("resultProgress");
const resultGrade = $("resultGrade");
const resultMode = $("resultMode");
const resultSummary = $("resultSummary");
const resultList = $("resultList");
const copyReport = $("copyReport");
const scrollProgress = $("scrollProgress");
const orbitalStage = $("orbitalStage");
const reportStack = $("reportStack");

let lastReport = null;

function normalizeUrl(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) throw new Error("Enter a website URL to scan.");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// websites can be scanned.");
  }

  return url.toString();
}

function gradeFor(score) {
  if (score >= 80) return { label: "Strong", className: "good" };
  if (score >= 55) return { label: "Needs work", className: "warn" };
  return { label: "High risk", className: "bad" };
}

function demoFromUrl(urlString) {
  const url = new URL(urlString);
  let hash = 0;
  for (const char of url.hostname) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }

  const score = 42 + (Math.abs(hash) % 31);

  return {
    ok: true,
    mode: "demo",
    url: urlString,
    domain: url.hostname,
    score,
    summary:
      "This is a clearly labelled preview because the live scanner API was not reachable from this host. Deploy on Vercel to activate the server-side scan.",
    checks: [
      {
        status: "pass",
        title: "HTTPS storefront",
        detail: "Secure transport is available.",
        impact: "pass"
      },
      {
        status: "warn",
        title: "Product structured data",
        detail: "Live server-side access is required to inspect the remote HTML.",
        impact: "high"
      },
      {
        status: "warn",
        title: "Machine-readable pricing",
        detail: "Live API required to verify Offer, price and currency signals.",
        impact: "high"
      },
      {
        status: "warn",
        title: "Shipping & return policies",
        detail: "Live API required to inspect policy discoverability.",
        impact: "medium"
      }
    ]
  };
}

async function requestScan(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(`/api/scan?url=${encodeURIComponent(url)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body.error || "";
      } catch {}

      throw new Error(detail || `Scanner returned HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function showLoading(show) {
  scanState.hidden = !show;
  scanButton.disabled = show;
  scanButton.innerHTML = show ? "Scanning…" : 'Run scan <span>↗</span>';
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderReport(report) {
  lastReport = report;
  const score = Math.max(0, Math.min(100, Number(report.score) || 0));
  const grade = gradeFor(score);

  if (scanEmpty) scanEmpty.hidden = true;
  scanResult.hidden = false;

  resultDomain.textContent = report.domain || new URL(report.url).hostname;
  resultScore.textContent = score;
  resultProgress.style.width = `${score}%`;
  resultGrade.textContent = grade.label;
  resultGrade.className = `status ${grade.className}`;
  resultMode.textContent = report.mode === "demo" ? "DEMO PREVIEW" : "LIVE WEBSITE SCAN";
  resultSummary.textContent = report.summary || "Scan complete.";

  resultList.innerHTML = (report.checks || [])
    .map((check) => {
      const status = ["pass", "fail", "warn"].includes(check.status) ? check.status : "warn";
      const icon = status === "pass" ? "✓" : "!";
      return `
        <div class="result-item ${status}">
          <i>${icon}</i>
          <div>
            <b>${escapeHtml(check.title)}</b>
            <small>${escapeHtml(check.detail)}</small>
          </div>
          <em>${escapeHtml(check.impact || status)}</em>
        </div>
      `;
    })
    .join("");
}

async function runScan(rawValue) {
  scanError.hidden = true;
  scanResult.hidden = true;
  if (scanEmpty) scanEmpty.hidden = false;

  let url;

  try {
    url = normalizeUrl(rawValue);
  } catch (error) {
    scanError.textContent = error.message;
    scanError.hidden = false;
    return;
  }

  showLoading(true);
  scanStateTitle.textContent = "Inspecting storefront…";
  scanStateText.textContent = "Reading product, trust and discovery signals";

  try {
    const report = await requestScan(url);
    renderReport(report);
  } catch (error) {
    const networkLike =
      error.name === "AbortError" ||
      /fetch|network|404|405|not found/i.test(error.message || "");

    if (networkLike) {
      renderReport(demoFromUrl(url));
    } else {
      scanError.textContent = error.message || "Unable to scan this website.";
      scanError.hidden = false;
    }
  } finally {
    showLoading(false);
  }
}

heroScanForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  scanUrl.value = heroUrl.value;
  document.querySelector("#scanner")?.scrollIntoView({ behavior: "smooth" });
  setTimeout(() => runScan(scanUrl.value), 450);
});

scanForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  runScan(scanUrl.value);
});

copyReport?.addEventListener("click", async () => {
  if (!lastReport) return;

  const lines = [
    `SELL2AI Agent Readiness Report — ${lastReport.domain || lastReport.url}`,
    `Score: ${lastReport.score}/100`,
    "",
    ...(lastReport.checks || []).map(
      (check) =>
        `${check.status === "pass" ? "PASS" : "FIX"} — ${check.title}: ${check.detail}`
    )
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copyReport.textContent = "Copied ✓";
    setTimeout(() => (copyReport.textContent = "Copy report summary"), 1600);
  } catch {
    copyReport.textContent = "Copy unavailable";
    setTimeout(() => (copyReport.textContent = "Copy report summary"), 1600);
  }
});

function setupRevealObserver() {
  const items = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("revealed"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );

  items.forEach((item) => observer.observe(item));
}

function updateScrollProgress() {
  const root = document.documentElement;
  const max = Math.max(1, root.scrollHeight - root.clientHeight);
  const progress = Math.min(1, Math.max(0, root.scrollTop / max));

  if (scrollProgress) {
    scrollProgress.style.width = `${progress * 100}%`;
  }

  if (orbitalStage) {
    const rect = orbitalStage.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    const center = rect.top + rect.height / 2;
    const normalized = Math.max(-1, Math.min(1, (center - viewport / 2) / viewport));
    orbitalStage.style.setProperty("--sy", `${normalized * -18}px`);
  }
}

function setupHeroDepth() {
  if (!orbitalStage || !reportStack) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  orbitalStage.addEventListener("pointermove", (event) => {
    const rect = orbitalStage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    orbitalStage.style.setProperty("--ry", `${x * 9}deg`);
    orbitalStage.style.setProperty("--rx", `${y * -8}deg`);
  });

  orbitalStage.addEventListener("pointerleave", () => {
    orbitalStage.style.setProperty("--ry", "0deg");
    orbitalStage.style.setProperty("--rx", "0deg");
  });
}

function setupFaq() {
  document.querySelectorAll(".faq-item").forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      document.querySelectorAll(".faq-item").forEach((other) => {
        if (other !== item) other.open = false;
      });
    });
  });
}

let scrollTicking = false;
window.addEventListener(
  "scroll",
  () => {
    if (scrollTicking) return;

    scrollTicking = true;
    requestAnimationFrame(() => {
      updateScrollProgress();
      scrollTicking = false;
    });
  },
  { passive: true }
);

window.addEventListener("DOMContentLoaded", () => {
  setupRevealObserver();
  setupHeroDepth();
  setupFaq();
  updateScrollProgress();
});
