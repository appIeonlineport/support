const $ = function(id){ return document.getElementById(id); };

const state = {
  config: null,
  supabase: null,
  session: null,
  guest: false,
  stores: [],
  selectedId: null
};

const LOCAL_KEY = "sell2ai_beta_workspace_v1";
const GUEST_KEY = "sell2ai_guest_mode";

function localData() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{"stores":[],"feedback":[],"buyerTests":[]}');
  } catch {
    return { stores: [], feedback: [], buyerTests: [] };
  }
}
function saveLocal(data){ localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); }

async function jsonFetch(url, options) {
  const response = await fetch(url, options || {});
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || ("Request failed: " + response.status));
  return body;
}

function normalizeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Enter a store URL.");
  return /^https?:\/\//i.test(value) ? value : "https://" + value;
}

function setWorkspaceVisible(visible) {
  $("workspace").hidden = !visible;
  $("authGate").hidden = visible;
}

async function init() {
  state.config = await jsonFetch("/api/public-config");
  state.guest = localStorage.getItem(GUEST_KEY) === "1";

  if (state.config.supabaseReady && window.supabase) {
    state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey);
    const result = await state.supabase.auth.getSession();
    state.session = result.data.session;

    state.supabase.auth.onAuthStateChange(function(event, session){
      state.session = session;
      if (session) {
        localStorage.removeItem(GUEST_KEY);
        state.guest = false;
        openWorkspace();
      }
    });
  }

  if (state.session || state.guest || !state.config.supabaseReady) {
    if (!state.config.supabaseReady) state.guest = true;
    await openWorkspace();
  } else {
    setWorkspaceVisible(false);
    $("accountState").textContent = "Sign in to sync";
  }

  wireEvents();

  const requestedTab = location.hash ? location.hash.slice(1) : "";
  if (["overview","buyer","fixes","billing","feedback"].includes(requestedTab)) switchTab(requestedTab);

  const params = new URLSearchParams(location.search);
  if (params.get("billing") === "success") { const plan=params.get("plan")||"selected"; $("billingNote").textContent = "Stripe test checkout completed for " + plan + ". No real charge was made."; switchTab("billing"); }
  if (params.get("billing") === "cancelled") { $("billingNote").textContent = "Checkout cancelled. No charge was made."; switchTab("billing"); }\n  if (location.hash) { const tab=location.hash.slice(1); if (["overview","buyer","fixes","billing","feedback"].includes(tab)) switchTab(tab); }
}

async function openWorkspace() {
  setWorkspaceVisible(true);
  $("signOutBtn").hidden = !state.session;
  $("accountState").textContent = state.session ? state.session.user.email : "Local beta workspace";
  await loadStores();
}

async function loadStores() {
  if (state.session && state.supabase) {
    const storesResult = await state.supabase.from("stores").select("*").order("updated_at", { ascending:false });
    if (storesResult.error) throw storesResult.error;
    const scansResult = await state.supabase.from("scans").select("*").order("created_at", { ascending:false }).limit(100);
    if (scansResult.error) throw scansResult.error;
    const latestByStore = new Map();
    (scansResult.data || []).forEach(function(scan){
      if (!latestByStore.has(scan.store_id)) latestByStore.set(scan.store_id, scan.report);
    });
    state.stores = (storesResult.data || []).map(function(store){
      return Object.assign({}, store, { latestReport: latestByStore.get(store.id) || null });
    });
  } else {
    state.stores = localData().stores || [];
  }

  if (!state.selectedId && state.stores.length) state.selectedId = state.stores[0].id;
  if (state.selectedId && !state.stores.some(function(s){ return s.id === state.selectedId; })) {
    state.selectedId = state.stores.length ? state.stores[0].id : null;
  }

  renderStores();
}

function selectedStore() {
  return state.stores.find(function(store){ return store.id === state.selectedId; }) || null;
}

function renderStores() {
  $("metricStores").textContent = state.stores.length;
  const list = $("storeList");
  list.innerHTML = "";

  state.stores.forEach(function(store){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "store-card" + (store.id === state.selectedId ? " active" : "");
    button.innerHTML = "<strong>" + escapeHtml(store.domain || store.url) + "</strong><span><b>" + escapeHtml(store.platform || "Unknown") + "</b><b class='store-score'>" + (store.latest_score != null ? store.latest_score + "/100" : "—") + "</b></span>";
    button.addEventListener("click", function(){
      state.selectedId = store.id;
      renderStores();
    });
    list.appendChild(button);
  });

  renderOverview();
}

function renderOverview() {
  const store = selectedStore();
  if (!store || !store.latestReport) {
    $("overviewEmpty").hidden = false;
    $("overviewContent").hidden = true;
    $("metricScore").textContent = "—";
    $("metricScoreDomain").textContent = "no scan yet";
    $("metricProducts").textContent = "—";
    $("metricPlatform").textContent = "—";
    return;
  }

  const report = store.latestReport;
  $("overviewEmpty").hidden = true;
  $("overviewContent").hidden = false;
  $("reportDomain").textContent = report.domain || store.domain || store.url;
  $("reportScore").textContent = report.score;
  $("reportBar").style.width = Math.max(0, Math.min(100, report.score)) + "%";
  $("metricScore").textContent = report.score;
  $("metricScoreDomain").textContent = report.domain || store.domain;
  $("metricProducts").textContent = report.detected && report.detected.products != null ? report.detected.products : "—";
  $("metricPlatform").textContent = report.platform || store.platform || "—";

  const facts = [];
  facts.push("v" + (report.version || "0.1"));
  facts.push((report.pages || []).length + " pages sampled");
  if (report.detected) {
    facts.push((report.detected.sitemapUrls || 0) + " sitemap URLs");
    facts.push(report.detected.robotsTxt ? "robots.txt ✓" : "robots.txt ?");
  }
  $("reportFacts").innerHTML = facts.map(function(f){ return "<span>" + escapeHtml(f) + "</span>"; }).join("");

  $("issueList").innerHTML = (report.checks || []).map(function(check){
    const pass = check.status === "pass";
    return "<div class='issue-row " + (pass ? "pass" : "") + "'><i>" + (pass ? "✓" : "!") + "</i><div><strong>" + escapeHtml(check.title) + "</strong><small>" + escapeHtml(check.detail) + "</small></div><em>" + escapeHtml(check.impact || check.status) + "</em></div>";
  }).join("");
}

async function scanStore(url) {
  $("addStoreBtn").disabled = true;
  $("addStoreBtn").textContent = "Scanning…";
  $("scanNotice").textContent = "Deep-scanning homepage, discovery files and product/catalog sample.";

  try {
    const report = await jsonFetch("/api/scan?url=" + encodeURIComponent(url));
    let store;

    if (state.session && state.supabase) {
      const payload = {
        user_id: state.session.user.id,
        url: report.url,
        domain: report.domain,
        platform: report.platform,
        latest_score: report.score,
        updated_at: new Date().toISOString()
      };
      const upsert = await state.supabase.from("stores").upsert(payload, { onConflict:"user_id,url" }).select().single();
      if (upsert.error) throw upsert.error;
      store = upsert.data;
      const insertScan = await state.supabase.from("scans").insert({
        user_id: state.session.user.id,
        store_id: store.id,
        scan_id: report.scanId,
        score: report.score,
        report: report
      });
      if (insertScan.error) throw insertScan.error;
    } else {
      const data = localData();
      const existing = (data.stores || []).find(function(x){ return x.url === report.url || x.domain === report.domain; });
      store = existing || { id:"local_" + Date.now().toString(36), created_at:new Date().toISOString() };
      store.url = report.url;
      store.domain = report.domain;
      store.platform = report.platform;
      store.latest_score = report.score;
      store.latestReport = report;
      store.updated_at = new Date().toISOString();
      if (!existing) data.stores.unshift(store);
      saveLocal(data);
    }

    state.selectedId = store.id;
    $("scanNotice").textContent = "Scan complete: " + report.score + "/100 · " + (report.detected.products || 0) + " products detected.";
    await loadStores();
  } finally {
    $("addStoreBtn").disabled = false;
    $("addStoreBtn").textContent = "Scan store ↗";
  }
}

async function runBuyer() {
  const store = selectedStore();
  if (!store) throw new Error("Add or select a store first.");
  const query = $("buyerQuery").value.trim();
  if (!query) throw new Error("Enter a shopping request.");

  $("buyerBtn").disabled = true;
  $("buyerBtn").textContent = "Testing…";
  $("buyerResult").innerHTML = "";

  try {
    const body = await jsonFetch("/api/buyer-test", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ url:store.url, query:query })
    });

    const test = body.test;
    if (!test.candidates.length) {
      $("buyerResult").innerHTML = "<div class='billing-note'>No product candidates were machine-readable enough to rank. Run the Fix Pack first.</div>";
      return;
    }

    $("buyerResult").innerHTML = test.candidates.map(function(candidate, index){
      return "<article class='buyer-card " + (index === 0 ? "winner" : "") + "'><div class='buyer-card-head'><strong>" + (index === 0 ? "Best visible candidate · " : "") + escapeHtml(candidate.product.name) + "</strong><span>" + candidate.confidence + "%</span></div><p>" + escapeHtml(candidate.product.description || candidate.product.url || "") + "</p><ul>" +
        candidate.reasons.slice(0,4).map(function(x){ return "<li>✓ " + escapeHtml(x) + "</li>"; }).join("") +
        candidate.gaps.slice(0,4).map(function(x){ return "<li>△ " + escapeHtml(x) + "</li>"; }).join("") +
        "</ul></article>";
    }).join("") + "<div class='billing-note'>" + escapeHtml(test.disclaimer) + "</div>";

    await saveBuyerTest(store, query, test);
  } finally {
    $("buyerBtn").disabled = false;
    $("buyerBtn").textContent = "Run buyer test →";
  }
}

async function saveBuyerTest(store, query, result) {
  if (state.session && state.supabase) {
    await state.supabase.from("buyer_tests").insert({
      user_id:state.session.user.id,
      store_id:store.id,
      query:query,
      result:result
    });
  } else {
    const data = localData();
    data.buyerTests = data.buyerTests || [];
    data.buyerTests.unshift({ storeId:store.id, query:query, result:result, createdAt:new Date().toISOString() });
    data.buyerTests = data.buyerTests.slice(0,30);
    saveLocal(data);
  }
}

async function generateFixes() {
  const store = selectedStore();
  if (!store) throw new Error("Add or select a store first.");

  $("fixBtn").disabled = true;
  $("fixBtn").textContent = "Generating…";
  $("fixResult").innerHTML = "";

  try {
    const body = await jsonFetch("/api/fixes", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ url:store.url })
    });

    const pack = body.fixPack;
    const fixes = pack.fixes.length ? pack.fixes.map(function(fix){
      return "<div class='fix-card'><strong>" + escapeHtml(fix.title) + " · " + escapeHtml(fix.impact.toUpperCase()) + "</strong><p>" + escapeHtml(fix.why) + "<br><b>Action:</b> " + escapeHtml(fix.action) + "</p></div>";
    }).join("") : "<div class='billing-note'>No priority fix was generated from the current checks.</div>";

    $("fixResult").innerHTML = "<div class='billing-note'>" + escapeHtml(pack.platformInstructions) + "</div>" + fixes + "<div class='download-row' id='downloadRow'></div>";
    const row = $("downloadRow");
    pack.files.forEach(function(file){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Download " + file.name;
      btn.addEventListener("click", function(){ downloadText(file.name, file.mime, file.content); });
      row.appendChild(btn);
    });
  } finally {
    $("fixBtn").disabled = false;
    $("fixBtn").textContent = "Generate fix pack ↗";
  }
}

function downloadText(name, mime, content) {
  const blob = new Blob([content], {type:mime || "text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

async function checkout(plan) {
  $("billingNote").textContent = "Opening secure checkout…";
  try {
    const email = state.session && state.session.user ? state.session.user.email : "";
    const body = await jsonFetch("/api/checkout", {
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan:plan,email:email})
    });
    if (body.url) { $("billingNote").textContent = body.note || "Opening secure checkout…"; setTimeout(function(){ location.href = body.url; }, 250); }
  } catch (error) {
    $("billingNote").textContent = error.message + " Connect/configure Stripe to activate live subscriptions.";
  }
}

async function submitFeedback() {
  const store = selectedStore();
  const payload = {
    type:$("feedbackType").value,
    rating:Number($("feedbackRating").value),
    message:$("feedbackMessage").value.trim(),
    metadata:{domain:store ? store.domain : null, score:store ? store.latest_score : null}
  };
  if (!payload.message) throw new Error("Write a feedback message.");

  if (state.session && state.supabase) {
    const insert = await state.supabase.from("feedback").insert({
      user_id:state.session.user.id,
      store_id:store ? store.id : null,
      type:payload.type,
      rating:payload.rating,
      message:payload.message,
      metadata:payload.metadata
    });
    if (insert.error) throw insert.error;
    $("feedbackNote").textContent = "Feedback saved to SELL2AI beta workspace. Thank you.";
  } else {
    const data = localData();
    data.feedback = data.feedback || [];
    data.feedback.unshift(Object.assign({createdAt:new Date().toISOString()}, payload));
    saveLocal(data);
    $("feedbackNote").textContent = "Saved in this browser. It will sync only after account backend is connected.";
  }
  $("feedbackMessage").value = "";
}

function switchTab(name) {
  if (history.replaceState) history.replaceState(null, "", location.pathname + location.search + "#" + name);
  document.querySelectorAll(".tabs button").forEach(function(button){ button.classList.toggle("active", button.dataset.tab === name); });
  document.querySelectorAll(".tab-panel").forEach(function(panel){ panel.classList.toggle("active", panel.id === "tab-" + name); });
}

function wireEvents() {
  $("authForm").addEventListener("submit", async function(event){
    event.preventDefault();
    if (!state.supabase) { $("authMessage").textContent = "Account sync backend is not connected yet."; return; }
    const email = $("authEmail").value.trim();
    const result = await state.supabase.auth.signInWithOtp({ email:email, options:{ emailRedirectTo:location.origin + "/dashboard.html" } });
    $("authMessage").textContent = result.error ? result.error.message : "Magic sign-in link sent. Check your inbox.";
  });

  $("guestBtn").addEventListener("click", async function(){
    localStorage.setItem(GUEST_KEY, "1"); state.guest = true; await openWorkspace();
  });

  $("signOutBtn").addEventListener("click", async function(){
    if (state.supabase) await state.supabase.auth.signOut();
    state.session = null; localStorage.removeItem(GUEST_KEY); location.reload();
  });

  $("addStoreForm").addEventListener("submit", async function(event){
    event.preventDefault();
    try { await scanStore(normalizeUrl($("storeUrl").value)); $("storeUrl").value = ""; }
    catch (error) { $("scanNotice").textContent = error.message; }
  });

  $("refreshBtn").addEventListener("click", function(){ loadStores().catch(function(e){ $("scanNotice").textContent=e.message; }); });

  document.querySelectorAll(".tabs button").forEach(function(button){
    button.addEventListener("click", function(){ switchTab(button.dataset.tab); });
  });

  $("buyerForm").addEventListener("submit", function(event){
    event.preventDefault(); runBuyer().catch(function(e){ $("buyerResult").innerHTML="<div class='billing-note'>"+escapeHtml(e.message)+"</div>"; });
  });

  $("fixBtn").addEventListener("click", function(){
    generateFixes().catch(function(e){ $("fixResult").innerHTML="<div class='billing-note'>"+escapeHtml(e.message)+"</div>"; });
  });

  document.querySelectorAll("[data-plan]").forEach(function(button){
    button.addEventListener("click", function(){ checkout(button.dataset.plan); });
  });

  $("feedbackForm").addEventListener("submit", function(event){
    event.preventDefault();
    submitFeedback().catch(function(e){ $("feedbackNote").textContent=e.message; });
  });
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

init().catch(function(error){
  $("accountState").textContent = "Workspace error";
  $("authGate").hidden = false;
  $("authMessage").textContent = error.message;
});
