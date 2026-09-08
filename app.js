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
const scanResult = $("scanResult");
const resultDomain = $("resultDomain");
const resultScore = $("resultScore");
const resultProgress = $("resultProgress");
const resultGrade = $("resultGrade");
const resultMode = $("resultMode");
const resultSummary = $("resultSummary");
const resultList = $("resultList");
const copyReport = $("copyReport");

let lastReport = null;

function normalizeUrl(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) throw new Error("Enter a website URL to scan.");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http:// and https:// websites can be scanned.");
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
  for (const c of url.hostname) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  const score = 42 + (Math.abs(hash) % 31);
  return {
    ok: true,
    mode: "demo",
    url: urlString,
    domain: url.hostname,
    score,
    summary: "This is a demo preview because the live scanner API is not available on this host. Deploy this repository on Vercel to activate server-side website scanning.",
    checks: [
      { status: "pass", title: "HTTPS website", detail: "Secure transport is available.", impact: "pass" },
      { status: "warn", title: "Product structured data", detail: "Demo mode cannot inspect remote HTML from this static host.", impact: "high" },
      { status: "warn", title: "Machine-readable pricing", detail: "Live API required to verify Offer/price signals.", impact: "high" },
      { status: "warn", title: "Shipping & return policies", detail: "Live API required to inspect public policy links.", impact: "medium" },
      { status: "warn", title: "Sitemap / discovery", detail: "Live API required to inspect discovery signals.", impact: "medium" }
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
  scanButton.textContent = show ? "Scanning…" : "Run scan";
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
  const grade = gradeFor(report.score);
  resultDomain.textContent = report.domain || new URL(report.url).hostname;
  resultScore.textContent = report.score;
  resultProgress.style.width = `${Math.max(0, Math.min(100, report.score))}%`;
  resultGrade.textContent = grade.label;
  resultGrade.className = `status ${grade.className}`;
  resultMode.textContent = report.mode === "demo" ? "DEMO PREVIEW" : "LIVE WEBSITE SCAN";
  resultSummary.textContent = report.summary || "Scan complete.";

  resultList.innerHTML = (report.checks || []).map((check) => {
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
      </div>`;
  }).join("");

  scanResult.hidden = false;
}

async function runScan(rawValue) {
  scanError.hidden = true;
  scanResult.hidden = true;

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
  scanStateText.textContent = "Checking product, policy and discovery signals";

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

heroScanForm.addEventListener("submit", (event) => {
  event.preventDefault();
  scanUrl.value = heroUrl.value;
  document.querySelector("#scanner").scrollIntoView({ behavior: "smooth" });
  setTimeout(() => runScan(scanUrl.value), 350);
});

scanForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runScan(scanUrl.value);
});

copyReport.addEventListener("click", async () => {
  if (!lastReport) return;
  const lines = [
    `SELL2AI Agent Readiness Report — ${lastReport.domain || lastReport.url}`,
    `Score: ${lastReport.score}/100`,
    "",
    ...(lastReport.checks || []).map((c) => `${c.status === "pass" ? "PASS" : "FIX"} — ${c.title}: ${c.detail}`)
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
