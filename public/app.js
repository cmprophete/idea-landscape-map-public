// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Christelle Prophete. See LICENSE.
// The home page and the new-map steps: statement, clarify, claim, people, research, then save.
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const svg = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const ARROW = '<span class="px sm arrow i-arrow" aria-hidden="true"></span>';
const OUT = '<span class="px sm i-external" aria-hidden="true"></span>';
const X = '<span class="px sm i-x" aria-hidden="true"></span>';
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const WHO_KEYS = ["res", "pol", "wri", "lab", "ind"];
const EVKEYS = ["data_private", "data_public", "review", "org", "observation"];
const POSFILL = ["#4F7CF6", "#A9C1FF", "#D9D9D9", "#9EDBA8", "#1F8A4C"];
const MAX_PEOPLE = 12;
const STEPS = ["Statement", "Clarify", "Claim", "People", "Research"];
const ALERT_ICON = { credits: "coin", busy: "cloud-error", budget: "piggy-bank", key: "key", signin: "lock", other: "alert" };
const BILLING = "https://console.anthropic.com/settings/billing";

const state = { extra: { s: 0, f: 0, i: 0, o: 0 }, statement: "", questions: [], draft: "", claim: "", title: "", acad: [], lead: [], added: [], runId: null, batches: [], spent: 0, budget: 0, stopped: false };

async function api(path, data, method, signal) {
  const r = await fetch(path, { method: method || (data ? "POST" : "GET"), headers: data ? { "content-type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined, signal });
  let out = {}; try { out = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(out.error || `The server returned an error (${r.status}).`), { status: r.status });
  return out;
}
const apDate = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${AP_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(iso || ""); };
// AP style: spell out zero through nine, use numerals for 10 and up.
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const num = n => (Number.isInteger(n) && n >= 0 && n < 10 ? WORDS[n] : String(n));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
// Tokens and searches used outside the research groups (sharpening, the claim, suggestions,
// bio lookups, the summary), so the cost line on the map counts every step.
function addUse(u) {
  if (!u) return;
  state.extra.s += u.web_search_requests || 0; state.extra.f += u.web_fetch_requests || 0;
  state.extra.i += u.input_tokens || 0; state.extra.o += u.output_tokens || 0;
}

// ---------- Views and the step bar ----------

let current = "home";
function go(view, step) {
  current = view;
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "v-" + view; });
  document.querySelectorAll("[data-only]").forEach(n => { n.hidden = n.dataset.only !== view; });
  const at = step != null ? step : { clarify: 1, claim: 2, people: 3, research: 4 }[view];
  const bar = $("#steps"); bar.hidden = view === "home";
  bar.querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("done", i < at);
    if (i === at) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    li.querySelector(".n").textContent = String(i + 1).padStart(2, "0") + (i < at ? " · DONE" : i === at ? " · NOW" : "");
  });
  window.scrollTo(0, 0);
  const h = $("#v-" + view + " h1");
  if (h && view !== "home") { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  document.title = view === "home" ? "Idea Landscape Map" : `${STEPS[at]} · Idea Landscape Map`;
}
document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => go(b.dataset.back)));
document.querySelectorAll("[data-home-link]").forEach(a => a.addEventListener("click", e => {
  if (current === "research" && state.batches.some(b => b.state === "working")) return; // let the unload warning speak
  if (location.pathname === "/") { e.preventDefault(); go("home"); $("#maps").scrollIntoView(); }
}));

// ---------- Messages when something stops ----------

function kindOf(msg) {
  const m = String(msg || "");
  if (/out of credits/i.test(m)) return "credits";
  if (/spending budget/i.test(m)) return "budget";
  if (/busy/i.test(m)) return "busy";
  if (/key was rejected/i.test(m)) return "key";
  if (/sign in/i.test(m)) return "signin";
  return "other";
}
// actions: [{ label, href } or { label, onClick, solid }]
function alertBox(kind, msg, actions = []) {
  const T = {
    credits: ["err", "!", "Stopped", "Your Anthropic account is out of credits", "The API key has no credits left. What's done is saved under Your maps. Add credits, then try again here, or come back later and continue it from Your maps."],
    busy: ["err", "!", "Couldn't get through", "The Anthropic API is busy", "The server tried several times and couldn't get through. Nothing was charged for the failed attempt. Wait a minute, then try again."],
    budget: ["", "$", "Spending limit", "This map reached its spending budget", "The remaining groups were stopped so the map doesn't cost more than you set. Build the map from the groups that are done, or continue it later from Your maps with a new research budget."],
    key: ["err", "!", "Setup", "The Anthropic API key was rejected", "Check the ANTHROPIC_API_KEY secret in Cloudflare, then try again."],
    signin: ["err", "!", "Signed out", "Sign in to use this app", "Your sign-in has expired. Reload the page to sign in again."],
    other: ["err", "!", "Something went wrong", "That step didn't finish", msg || "Try again."]
  }[kind];
  const box = el("section", "alert" + (T[0] ? " " + T[0] : ""));
  box.setAttribute("role", T[0] ? "alert" : "status");
  const icon = el("span", "icon"); icon.setAttribute("aria-hidden", "true"); icon.append(svg(`<span class="px i-${ALERT_ICON[kind] || "alert"}"></span>`));
  const txt = el("div", "txt");
  txt.append(el("span", "eyebrow", T[2]), el("h2", null, T[3]), el("p", null, T[4]));
  const acts = el("div", "acts");
  if (kind === "credits") actions = [{ label: "Add credits in the Anthropic Console", href: BILLING, solid: true }, ...actions];
  if (kind === "signin") actions = [{ label: "Reload", onClick: () => location.reload(), solid: true }];
  actions.forEach((a, i) => {
    let b;
    if (a.href) { b = el("a", "btn" + (a.solid ? " solid" : ""), a.label); b.href = a.href; b.target = "_blank"; b.rel = "noopener"; b.append(svg(OUT)); }
    else { b = el("button", "btn" + (a.solid || !i ? " solid" : ""), a.label); b.type = "button"; b.addEventListener("click", a.onClick); }
    acts.append(b);
  });
  if (acts.children.length) txt.append(acts);
  box.append(icon, txt);
  return box;
}
function showAlert(view, err, actions) {
  const slot = $(`#v-${view} .alertslot`); if (!slot) return;
  const msg = err && err.message ? err.message : String(err || "");
  slot.replaceChildren(alertBox(kindOf(msg), msg, actions));
  slot.scrollIntoView({ block: "center", behavior: "smooth" });
}
const clearAlert = view => { const s = $(`#v-${view} .alertslot`); if (s) s.replaceChildren(); };

// ---------- Waiting screens ----------

let waiting = null;
async function wait(cfg, fn) {
  const ctrl = new AbortController(); waiting = ctrl;
  $("#h-wait").textContent = cfg.title;
  $("#wait-text").textContent = cfg.text;
  // Step through short lines about what this step does, then hold on the last one.
  const lines = [].concat(cfg.msg); let li = 0;
  $("#wait-msg").textContent = lines[0];
  clearInterval(wait.timer);
  wait.timer = setInterval(() => {
    if (li >= lines.length - 1 || waiting !== ctrl) return clearInterval(wait.timer);
    $("#wait-msg").textContent = lines[++li];
  }, 3500);
  $("#wait-note").textContent = cfg.note;
  $("#wait-cancel").textContent = cfg.cancel;
  $("#wait-cancel").onclick = () => { ctrl.abort(); go(cfg.back); };
  clearAlert(cfg.back);
  go("wait", cfg.step);
  try { await fn(ctrl.signal); }
  catch (e) {
    if (ctrl.signal.aborted) return;
    go(cfg.back);
    showAlert(cfg.back, e, [{ label: "Try again", onClick: cfg.retry }]);
  } finally { if (waiting === ctrl) { waiting = null; clearInterval(wait.timer); } }
}
const QUICK = "This usually takes a few seconds and uses very few tokens.";

// ---------- 1. Statement ----------

function submitStatement() {
  state.statement = $("#statement").value.trim();
  if (!state.statement) return $("#statement").focus();
  state.extra = { s: 0, f: 0, i: 0, o: 0 };
  wait({
    title: "Reading your idea", text: state.statement, step: 1, back: "home", retry: submitStatement,
    msg: ["Looking for what's vague and writing a few questions.", "Checking which words could mean more than one thing.", "Thinking about who, what, and where the idea covers.", "Drafting up to four questions."], note: QUICK, cancel: "Cancel and edit your idea"
  }, async signal => {
    const r = await api("/api/sharpen", { statement: state.statement }, null, signal); addUse(r.usage);
    state.questions = (r.questions || []).slice(0, 4);
    state.draft = r.draft_claim || state.statement;
    $("#c-statement").textContent = state.statement;
    $("#assessment").textContent = (r.assessment || "") + (state.questions.length ? "" : " No questions needed. Continue to write the claim.");
    drawQuestions();
    go("clarify");
  });
}
$("#f-statement").addEventListener("submit", e => { e.preventDefault(); submitStatement(); });
// The Sharpen button brightens once there's an idea to sharpen.
(() => {
  const ta = $("#statement"), btn = $("#f-statement .go");
  const sync = () => {
    const ready = ta.value.trim().length > 0;
    if (ready && !btn.classList.contains("ready")) { btn.classList.add("hop"); setTimeout(() => btn.classList.remove("hop"), 500); }
    btn.classList.toggle("ready", ready);
  };
  ta.addEventListener("input", sync); sync();
})();

function drawQuestions() {
  const box = $("#questions"); box.replaceChildren();
  state.questions.forEach((q, qi) => {
    const fs = el("fieldset"); fs.append(el("legend", null, q.question));
    (q.options || []).forEach((o, oi) => {
      const lab = el("label", "opt");
      const inp = el("input"); inp.type = "radio"; inp.name = "q" + qi; inp.value = o; if (!oi) inp.checked = true;
      lab.append(inp, document.createTextNode(o));
      if (!oi) lab.append(el("span", "tag", "SUGGESTED"));
      fs.append(lab);
    });
    const row = el("div", "opt other");
    const r = el("input"); r.type = "radio"; r.name = "q" + qi; r.value = "__other"; r.id = `q${qi}o`;
    const l = el("label", null, "Other:"); l.htmlFor = r.id;
    const t = el("input"); t.type = "text"; t.id = `q${qi}other`; t.maxLength = 300; t.placeholder = "Type your own answer";
    t.setAttribute("aria-label", "Your own answer to: " + q.question);
    t.addEventListener("input", () => { r.checked = true; });
    row.append(r, l, t); fs.append(row); box.append(fs);
  });
}

// ---------- 2. Clarify ----------

function submitClarify() {
  const f = $("#f-clarify");
  const answers = state.questions.map((q, qi) => {
    const pick = f.querySelector(`input[name="q${qi}"]:checked`);
    const answer = pick && pick.value === "__other" ? ($(`#q${qi}other`).value.trim() || "No preference") : (pick ? pick.value : "No preference");
    return { question: q.question, answer };
  });
  wait({
    title: "Writing the claim", text: state.statement, step: 2, back: "clarify", retry: submitClarify,
    msg: ["Writing three versions of the claim from your answers.", "Making each one a sentence people can agree or disagree with.", "Choosing a short name for the map."], note: QUICK, cancel: "Cancel and go back to the questions"
  }, async signal => {
    const r = await api("/api/refine", { statement: state.statement, answers }, null, signal); addUse(r.usage);
    const claims = (r.claims || []).filter(Boolean).slice(0, 3); if (!claims.length) claims.push(state.draft);
    drawClaims(claims);
    $("#claim").value = claims[0]; $("#title").value = r.title || "";
    go("claim");
  });
}
$("#f-clarify").addEventListener("submit", e => { e.preventDefault(); submitClarify(); });

function drawClaims(claims) {
  const fs = $("#claims"); fs.querySelectorAll("label").forEach(l => l.remove());
  claims.forEach((c, i) => {
    const lab = el("label", "opt claim");
    const inp = el("input"); inp.type = "radio"; inp.name = "claimpick"; inp.value = c; if (!i) inp.checked = true;
    inp.addEventListener("change", () => { $("#claim").value = c; });
    const txt = el("span", "txt"); txt.append(el("span", null, c));
    if (!i && claims.length > 1) txt.append(el("span", "tag", "SUGGESTED"));
    lab.append(inp, txt); fs.append(lab);
  });
  fs.querySelector("legend").hidden = claims.length < 2;
}

// ---------- 3. Claim ----------

function submitClaim() {
  state.claim = $("#claim").value.trim(); state.title = $("#title").value.trim();
  if (!state.claim) return $("#claim").focus();
  if (!state.title) return $("#title").focus();
  wait({
    title: "Finding the key voices", text: state.claim, step: 3, back: "claim", retry: submitClaim,
    msg: ["Searching the web for who is active in this debate.", "Looking for academics and writers who've published on it.", "Looking for industry leaders who've spoken about it.", "Noting who others cite and argue with.", "Putting the list together."],
    note: "This usually takes about a minute. You can leave this tab open and come back. It runs a few web searches, which use a small number of tokens.",
    cancel: "Cancel and go back to the claim"
  }, async signal => {
    const r = await api("/api/candidates", { claim: state.claim }, null, signal); addUse(r.usage);
    state.acad = (r.academics || []).map(p => ({ name: p.name, role: p.role || "", leader: false })); state.added = [];
    state.lead = (r.leaders || []).map(p => ({ name: p.name, role: p.role || "", leader: true }));
    openPeople();
  });
}
$("#f-claim").addEventListener("submit", e => { e.preventDefault(); submitClaim(); });

// ---------- 4. People ----------

function openPeople(rerun) {
  $("#p-claim").textContent = state.claim;
  $("#p-note").textContent = rerun
    ? "Running this map again with the same claim and people, to see whether views have changed. It uses a new research budget. Remove or add names before you start."
    : "These are the voices others in the debate cite and argue with, found through a web search. Remove anyone who doesn't belong and add anyone missing.";
  $("#p-back").textContent = rerun ? "Back to your maps" : "Back to the claim";
  $("#p-back").dataset.back = rerun ? "home" : "claim";
  clearAlert("people");
  drawPeople(); go("people");
}
function drawPeople() {
  $("#g-added").hidden = !state.added.length;
  [["acad", "#l-acad", "#n-acad"], ["lead", "#l-lead", "#n-lead"], ["added", "#l-added", "#n-added"]].forEach(([k, list, count]) => {
    const ul = $(list); ul.replaceChildren();
    if (!state[k].length) ul.append(el("li", "empty", "No one here yet. Add someone below."));
    state[k].forEach((p, i) => {
      const li = el("li"); const who = el("div", "who");
      who.append(el("span", "name", p.name)); if (p.role) who.append(el("span", "role", p.role));
      const rm = el("button", "x"); rm.type = "button"; rm.setAttribute("aria-label", "Remove " + p.name); rm.append(svg(X));
      rm.addEventListener("click", () => {
        state[k].splice(i, 1); drawPeople();
        const next = $(list).querySelectorAll(".x")[Math.min(i, state[k].length - 1)];
        (next || $("#addname")).focus();
      });
      li.append(who, rm); ul.append(li);
    });
    $(count).textContent = state[k].length;
  });
  const n = total();
  const b = $("#startbtn"); b.replaceChildren(document.createTextNode(`Start research on ${plural(n, "person", "people")}`), svg(ARROW));
  // Up to MAX_PEOPLE per map, to keep research costs down.
  const full = n >= MAX_PEOPLE, add = $("#addbtn");
  add.disabled = full;
  add.firstChild.textContent = full ? "Remove someone to add another " : "Add to the list ";
  $("#p-limit").textContent = n > MAX_PEOPLE
    ? `This map has ${n} people. Remove ${n - MAX_PEOPLE} to get down to ${MAX_PEOPLE} before you start.`
    : `${n} of ${MAX_PEOPLE} people. Each map can research up to ${MAX_PEOPLE}, to keep costs down.`;
  $("#p-limit").classList.toggle("over", n > MAX_PEOPLE);
}
$("#addbtn").addEventListener("click", () => {
  const name = $("#addname").value.trim(); if (!name) return $("#addname").focus();
  // Claude decides the group for people added here.
  state.added.push({ name, role: $("#addrole").value.trim(), leader: null });
  $("#addname").value = ""; $("#addrole").value = ""; drawPeople(); $("#addname").focus();
});
$("#addname").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#addbtn").click(); } });
$("#addrole").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#addbtn").click(); } });

$("#f-people").addEventListener("submit", async e => {
  e.preventDefault();
  clearAlert("people");
  if (total() < 2) return showAlert("people", "Add at least two people to research.");
  if (total() > MAX_PEOPLE) { $("#p-limit").scrollIntoView({ block: "center" }); return; }
  const btn = $("#startbtn"); btn.disabled = true;
  try {
    const r = await api("/api/runs", { claim: state.claim, title: state.title });
    state.runId = r.runId;
    state.batches = chunk(mix([...state.acad, ...state.added], state.lead), 3).map((people, i) => ({ i, people, state: "waiting" }));
    state.spent = 0; state.budget = 0; state.stopped = false;
    $("#r-title").textContent = `Researching ${plural(total(), "person", "people")}`;
    $("#r-claim").textContent = state.claim;
    $("#r-state").textContent = "Working";
    $("#r-status").textContent = ""; $("#buildbtn").hidden = true; $("#stoprow").hidden = false;
    clearAlert("research");
    go("research"); tabBusy(true); drawBatches(); runAll();
  } catch (err) { showAlert("people", err, [{ label: "Try again", onClick: () => $("#startbtn").click() }]); }
  finally { btn.disabled = false; }
});
function total() { return state.acad.length + state.lead.length + state.added.length; }
// Spread industry leaders through the list, so a budget stop doesn't cut all of them.
function mix(acad, lead) {
  const out = [...acad], n = acad.length + lead.length;
  lead.forEach((p, k) => out.splice(Math.min(out.length, Math.floor((k + 0.5) * n / lead.length)), 0, p));
  return out;
}
const chunk = (a, n) => a.length ? Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n)) : [];

// ---------- 5. Research ----------

function drawBatches() {
  const ul = $("#groups"); ul.replaceChildren();
  state.batches.forEach(b => {
    const li = el("li", b.state); const who = el("div", "who");
    who.append(el("span", "names", b.people.map(p => p.name).join(", ")));
    let st = "", detail = "";
    if (b.state === "waiting") st = "WAITING";
    if (b.state === "working") { st = "READING SOURCES"; detail = b.searches != null ? `${plural(b.searches, "search", "searches")}, ${plural(b.fetches, "page", "pages")} opened` : "Starting"; }
    if (b.state === "checking") { st = "CHECKING QUOTES"; detail = "Reopening each source page to check the quotes word for word, and finding bio and recent work links"; }
    if (b.state === "stopped") { st = "STOPPED"; detail = "Not researched, because the research was stopped."; }
    if (b.state === "done") {
      st = "DONE"; const c = b.counts || {};
      const parts = [c.ok ? `${cap(plural(c.ok, "quote", "quotes"))} found on the source page.` : "No quotes found on the source page."];
      if (c.removed) parts.push(`${cap(num(c.removed))} removed because the page didn't contain ${c.removed === 1 ? "it" : "them"}.`);
      if (c.unreach) parts.push(`${cap(num(c.unreach))} kept but marked, because the page wouldn't open.`);
      detail = parts.join(" ");
    }
    if (b.state === "failed") detail = b.error || "This group didn't finish.";
    if (detail) who.append(el("span", "detail", detail));
    li.append(who);
    if (b.state === "failed" && b.kind !== "budget" && !state.stopped) {
      const retry = el("button", "btn", "Run again"); retry.type = "button";
      retry.setAttribute("aria-label", "Run this group again: " + b.people.map(p => p.name).join(", "));
      retry.addEventListener("click", () => { $("#stoprow").hidden = false; b.state = "waiting"; b.error = ""; clearAlert("research"); $("#buildbtn").hidden = true; drawBatches(); runAll(); });
      li.append(retry);
    } else if (st) li.append(el("span", "st", st));
    ul.append(li);
  });
  const done = state.batches.filter(b => b.state === "done");
  $("#s-groups").textContent = `${done.length}/${state.batches.length}`;
  $("#s-quotes").textContent = done.reduce((n, b) => n + ((b.counts && b.counts.ok) || 0), 0);
  $("#s-budget").textContent = state.budget ? Math.min(100, Math.round(state.spent / state.budget * 100)) + "%" : "0%";
}

let running = false;
async function runAll() {
  if (running) return; running = true; tabBusy(true);
  $("#r-status").textContent = "";
  const next = () => !state.stopped && state.batches.find(b => b.state === "waiting");
  const worker = async () => { let b; while ((b = next())) await runBatch(b); };
  await Promise.all([worker(), worker()]);
  running = false;
  tabBusy(false);
  if (state.stopped) return;
  const failed = state.batches.filter(b => b.state === "failed");
  const done = state.batches.filter(b => b.state === "done");
  if (!failed.length) return build();
  $("#stoprow").hidden = true;
  // Show the message for the most important failure.
  const order = ["credits", "budget", "key", "busy", "other"];
  const worst = failed.map(b => b.kind).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  const retryAll = () => { $("#stoprow").hidden = false; failed.forEach(b => { if (b.kind !== "budget") { b.state = "waiting"; b.error = ""; } }); clearAlert("research"); $("#buildbtn").hidden = true; drawBatches(); runAll(); };
  const acts = worst === "budget"
    ? (done.length ? [{ label: "Build the map with what's done", onClick: build, solid: true }] : [])
    : [{ label: failed.length > 1 ? "Run the failed groups again" : "Run this group again", onClick: retryAll }];
  showAlert("research", failed.find(b => b.kind === worst).error, acts);
  if (done.length && worst !== "budget") {
    const b = $("#buildbtn"); b.hidden = false;
    b.replaceChildren(document.createTextNode(failed.length > 1 ? "Build the map without the failed groups" : "Build the map without the failed group"), svg(ARROW));
  }
  $("#r-state").textContent = "Stopped";
}
$("#buildbtn").addEventListener("click", () => { $("#buildbtn").hidden = true; clearAlert("research"); build(); });

async function runBatch(b) {
  b.state = "working"; b.searches = null; b.ctrl = new AbortController(); drawBatches();
  try {
    const r = await fetch("/api/research", { method: "POST", headers: { "content-type": "application/json" }, signal: b.ctrl.signal, body: JSON.stringify({ runId: state.runId, people: b.people.map(p => ({ name: p.name, role: p.role, leader: p.leader })) }) });
    if (!r.ok) { let m = ""; try { m = (await r.json()).error; } catch {} throw new Error(m || `The server returned an error (${r.status}).`); }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = "", result = null;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "progress") { b.searches = ev.searches; b.fetches = ev.fetches; drawBatches(); }
        if (ev.type === "error") throw new Error(ev.error);
        if (ev.type === "result") result = ev;
      }
    }
    if (!result) throw new Error("The connection closed before the results arrived. Run this group again.");
    b.usage = result.usage;
    if (result.budget) { state.spent = Math.max(state.spent, result.spent || 0); state.budget = result.budget; }
    b.state = "checking"; drawBatches();
    // Check quotes and look up bio and latest-work links at the same time.
    [b.result] = await Promise.all([verify(result.people), profiles(result.people)]);
    const qs = b.result.flatMap(p => p.quotes || []);
    b.counts = { ok: qs.filter(q => q.check === "found" || q.check === "close").length, removed: qs.filter(q => q.check === "not_found").length, unreach: qs.filter(q => q.check === "unreachable").length };
    b.state = "done"; drawBatches(); saveDraft();
  } catch (e) {
    if (state.stopped) { b.state = "stopped"; drawBatches(); return; }
    b.state = "failed"; b.error = e.message; b.kind = kindOf(e.message);
    if (b.kind === "budget") { state.batches.forEach(x => { if (x.state === "waiting") x.state = "stopped"; }); }
    drawBatches(); saveDraft();
  }
}

// Bio and latest-work links for each person's card. If this fails, the map still builds,
// and the finished map tries again when it's opened.
async function profiles(people) {
  const list = people.filter(p => !p.unverified && p.name);
  for (let i = 0; i < list.length; i += 3) {
    const part = list.slice(i, i + 3);
    try {
      const r = await api("/api/profiles", { runId: state.runId, people: part.map(p => ({ name: p.name, role: p.role || "", leader: !!p.leader })) });
      addUse(r.usage);
      r.profiles.forEach((pr, j) => { part[j].bio = pr.bio || ""; part[j].pubs = pr.pubs || []; part[j].pubsFrom = pr.from; });
    } catch {}
  }
}

async function verify(people) {
  const quotes = [];
  people.forEach(p => (p.quotes || []).forEach(q => quotes.push(q)));
  for (let i = 0; i < quotes.length; i += 12) {
    const part = quotes.slice(i, i + 12);
    try {
      const r = await api("/api/verify", { runId: state.runId, quotes: part.map(q => ({ url: q.url, text: q.text })) });
      r.results.forEach((res, j) => { part[j].check = res.status; });
    } catch { part.forEach(q => { q.check = "unreachable"; }); }
  }
  return people;
}

// What happens after research ends, shown as a short list of steps so the switch from
// researching to building the map is clear, especially after Stop.
const BUILD_STEPS = ["Finish checking quotes", "Write the summary", "Find recent studies", "Save the map"];
function showPhase(head, note, at) {
  const box = el("div", "phase");
  box.append(el("strong", null, head)); if (note) box.append(el("p", null, note));
  const ol = el("ol", "psteps");
  BUILD_STEPS.forEach((label, k) => { const li = el("li", k < at ? "done" : k === at ? "now" : null, label); if (k === at) li.setAttribute("aria-current", "step"); ol.append(li); });
  box.append(ol);
  $("#r-status").replaceChildren(box);
}
let phaseHead = "", phaseNote = "";
const setPhase = at => showPhase(phaseHead, phaseNote, at);
const peopleIn = list => list.reduce((n, b) => n + b.people.length, 0);

$("#stopbtn").addEventListener("click", async () => {
  state.stopped = true;
  state.batches.forEach(b => { if (b.state === "waiting") b.state = "stopped"; if (b.state === "working" && b.ctrl) b.ctrl.abort(); });
  drawBatches(); clearAlert("research");
  $("#stoprow").hidden = true;
  api(`/api/runs/${state.runId}/stop`, {}).catch(() => {});
  const kept = state.batches.filter(b => b.state === "done" || b.state === "checking");
  const skipped = state.batches.filter(b => b.state === "stopped");
  if (kept.length) {
    $("#r-title").textContent = "Building the map";
    $("#r-state").textContent = "Stopped early";
    phaseHead = "You stopped the research. The map is being built from what's done.";
    phaseNote = `It will include the ${plural(peopleIn(kept), "person", "people")} whose research finished.` + (skipped.length ? ` The other ${plural(peopleIn(skipped), "person", "people")} won't be researched, and the map's notes will list them.` : "");
    setPhase(state.batches.some(b => b.state === "checking") ? 0 : 1);
    $("#r-status").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }
  // Groups already checking quotes have finished their research, so let them finish.
  while (state.batches.some(b => b.state === "checking" || b.state === "working")) await new Promise(ok => setTimeout(ok, 300));
  if (state.batches.some(b => b.state === "done")) return build();
  tabBusy(false);
  $("#r-state").textContent = "Stopped";
  $("#r-status").textContent = "Research stopped before any group finished, so there's nothing to map yet.";
});


// While research runs, the browser tab shows an hourglass so you can see it's still working.
function tabBusy(on) {
  const link = document.getElementById("favicon"); if (link) link.href = on ? "/icons/hourglass.svg" : "/icons/map.svg";
  document.title = on ? "Researching… · Idea Landscape Map" : document.title.replace(/^Researching… · /, "");
}

// ---------- 6. Build and save ----------

function monthLabel(ym) { const m = String(ym || "").match(/^(\d{4})-(\d{2})/); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(ym || "Date unknown"); }
function nyToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); }

let building = false;
async function build() {
  if (building) return; building = true;
  await draftSaving;
  $("#stoprow").hidden = true; $("#buildbtn").hidden = true;
  $("#r-title").textContent = "Building the map";
  if (!state.stopped) {
    $("#r-state").textContent = "Building";
    const failed = state.batches.filter(b => b.state !== "done");
    phaseHead = failed.length ? "Building the map from the groups that finished." : "Research is done. Now building the map.";
    phaseNote = failed.length ? `${cap(plural(peopleIn(failed), "person", "people"))} in groups that didn't finish won't be on the map, and the map's notes will list them.` : "";
  }
  setPhase(1);
  const all = state.batches.filter(b => b.state === "done").flatMap(b => b.result || []);
  const dropped = [], people = []; let removed = 0, unchecked = 0;
  all.forEach(r => {
    if (r.unverified) { dropped.push({ name: r.name, reason: r.reason || "no statements on the claim could be verified" }); return; }
    const q = (r.quotes || []).filter(x => { if (x.check === "not_found") { removed++; return false; } return true; }).map(x => {
      if (x.check === "unreachable") unchecked++;
      // The eighth item tags the quote: "data" if it cites data or a study, "view" if it's a view or forecast.
      return [String(x.text).replace(/,\s*$/, ""), x.title || "Source", x.outlet || "", monthLabel(x.date), x.url, x.note || undefined, x.check || undefined, x.kind === "data" || x.kind === "view" ? x.kind : undefined];
    });
    if (!q.length) { dropped.push({ name: r.name, reason: "no quote could be confirmed on its source page" }); return; }
    const pos = Math.min(5, Math.max(1, Math.round(Number(r.position) || 3)));
    people.push({ name: r.name, role: r.role || "", s: pos, co: !!r.leader, low: r.confidence === "low", why: r.why || "", caveat: r.caveat || "", shift: r.shift || undefined, interest: r.leader ? (r.interest || undefined) : undefined, q,
      who: r.leader ? "ind" : (WHO_KEYS.includes(r.who) && r.who !== "ind" ? r.who : undefined), whoNote: r.who_note || undefined, dataNote: r.data_note || undefined,
      ...(EVKEYS.includes(r.evidence_type) ? { ev: r.evidence_type, evn: r.evidence_note || "" } : {}),
      ...(typeof r.bio === "string" ? { bio: r.bio, pubs: r.pubs || [], pubsFrom: r.pubsFrom } : {}) });
  });
  if (!people.length) {
    building = false; $("#r-state").textContent = "Stopped"; $("#r-status").textContent = "";
    showAlert("research", "No one could be verified, so there's nothing to map. Try different people or a broader claim.", [{ label: "Back to the people", onClick: () => openPeople() }]);
    return;
  }
  try {
    // The summary and the recent studies run at the same time. If the studies step fails, the map still saves.
    let left = 2;
    const tick = x => { left--; if (!left) setPhase(3); return x; };
    const [sum, st] = await Promise.all([
      api("/api/summary", { runId: state.runId, people: people.map(x => { const k = x.q.map(q => q[7]).filter(Boolean); return { name: x.name, leader: x.co, who: x.who, position: x.s, data: k.filter(v => v === "data").length, quotes: k.length, why: x.why }; }) }).then(x => { setPhase(2); return tick(x); }),
      api("/api/studies", { runId: state.runId, people: people.map(x => ({ name: x.name, data_note: x.dataNote || "" })) }).catch(() => null).then(tick)
    ]);
    if (st) addUse(st.usage);
    addUse(sum.usage);
    const usage = state.batches.reduce((u, b) => { if (b.usage) { u.s += b.usage.web_search_requests || 0; u.f += b.usage.web_fetch_requests || 0; u.i += b.usage.input_tokens || 0; u.o += b.usage.output_tokens || 0; } return u; }, { ...state.extra });
    const notes = [];
    if (removed) notes.push(`The automatic check removed ${plural(removed, "quote", "quotes")} that didn't match ${removed > 1 ? "their" : "its"} source page.`);
    if (unchecked) notes.push(`${cap(plural(unchecked, "quote comes", "quotes come"))} from pages the automatic check couldn't open, and each is marked.`);
    const notRun = state.batches.filter(b => b.state !== "done").flatMap(b => b.people.map(x => x.name));
    // A map built without every group is labeled partial, with the reason.
    const why = state.stopped ? "stopped" : state.batches.some(b => b.kind === "budget") ? "budget" : "failed";
    const WHY_NOTE = { stopped: "the research was stopped", budget: "the map reached its spending budget", failed: "their group didn't finish" };
    if (notRun.length) notes.push(`Not researched because ${WHY_NOTE[why]}: ${notRun.join(", ")}.`);
    const map = {
      title: state.title, claim: state.claim, researched: nyToday(), finding: sum.finding || "", gap: sum.gap || "", gapV: 1, labelsV: 1,
      ...(st ? { studies: st.studies || [], studiesV: 1 } : {}),
      ...(notRun.length ? { partial: { reason: why, skipped: notRun, total: peopleIn(state.batches) } } : {}),
      headcount: people.reduce((n, x) => n + (x.name.includes(" and ") ? x.name.split(" and ").length : 1), 0),
      people, notes, usage, usageAll: true, dropped, summaryV: 2,
      ...(people.every(x => typeof x.bio === "string") ? { profilesV: 1 } : {}),
      roster: [...state.acad, ...state.lead, ...state.added].map(p => ({ name: p.name, role: p.role, leader: p.leader ?? !!(people.find(x => x.name === p.name) || {}).co }))
    };
    const saved = await api("/api/maps", { runId: state.runId, map });
    window.removeEventListener("beforeunload", guard);
    location.href = "/map?id=" + encodeURIComponent(saved.id);
  } catch (e) {
    building = false; $("#r-state").textContent = "Not saved"; $("#r-status").textContent = "";
    showAlert("research", e, [{ label: "Try saving again", onClick: () => { clearAlert("research"); build(); } }]);
  }
}
function guard(e) { if (current === "research" && state.batches.some(b => b.state === "working" || b.state === "checking")) { e.preventDefault(); e.returnValue = ""; } }
window.addEventListener("beforeunload", guard);

// ---------- Home: quota, saved maps, totals ----------

async function loadStatus() { try { await api("/api/status"); } catch (e) { if (e.status === 401) showAlert("home", e); } }
async function loadMaps() {
  const ul = $("#maplist");
  try {
    const [{ maps }, { drafts }] = await Promise.all([api("/api/maps"), api("/api/drafts").catch(() => ({ drafts: [] }))]);
    ul.replaceChildren();
    // Paused maps come first, with a link to continue their research.
    drafts.forEach(d => {
      const li = el("li", "paused"); const a = el("a", "item"); a.href = "/?resume=" + encodeURIComponent(d.id);
      const meta = el("span", "meta");
      const tag = el("span", "tag"); tag.append(svg('<span class="px sm i-hourglass" aria-hidden="true"></span>'), document.createTextNode("Paused"));
      meta.append(tag, el("span", "eyebrow", `${num(d.done)} of ${plural(d.total, "group", "groups")} done · ${apDate(d.updated)}`));
      a.append(el("span", "title", d.title), meta); li.append(a); ul.append(li);
    });
    if (!maps.length && !drafts.length) {
      const li = el("li"); const box = el("div", "empty");
      const head = el("strong"); head.append(svg('<span class="px lg i-map" aria-hidden="true"></span>'), document.createTextNode("No maps yet"));
      box.append(head, el("span", null, "Your finished maps will appear here, newest first. Each one is saved as soon as its research is done."));
      const a = el("a", null, "Start your first map"); a.href = "#new"; a.style.cssText = "align-self:flex-start;padding:8px 0;font-weight:500";
      a.addEventListener("click", e => { e.preventDefault(); $("#statement").focus(); });
      box.append(a); li.append(box); ul.append(li); return;
    }
    maps.forEach((m, k) => {
      const li = el("li", k === 0 ? "newest" : null); const a = el("a", "item"); a.href = "/map?id=" + encodeURIComponent(m.id);
      const t = el("span", "title", m.title);
      const meta = el("span", "meta");
      if (Array.isArray(m.dist) && m.dist.some(Boolean)) {
        const LBL = ["disagrees", "lean disagree", "mixed", "lean agree", "agrees"];
        const bar = el("span", "dist"); bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", m.dist.map((n, k) => `${n} ${LBL[k]}`).join(", "));
        m.dist.forEach((n, k) => { if (!n) return; const s = el("span"); s.style.flex = n; s.style.background = POSFILL[k]; bar.append(s); });
        meta.append(bar);
      }
      if (m.partial) {
        // Built before every person was researched (after Stop, a budget stop, or a failed group).
        const tag = el("span", "tag"); tag.append(svg('<span class="px sm i-info" aria-hidden="true"></span>'), document.createTextNode("Partial map"));
        meta.append(tag);
        if (Array.isArray(m.researchedOf)) meta.append(el("span", "eyebrow", `${num(m.researchedOf[0])} of ${plural(m.researchedOf[1], "person", "people")} researched`));
      }
      meta.append(el("span", "eyebrow", apDate(m.researched)));
      a.append(t, meta); li.append(a); ul.append(li);
    });
    const li = el("li"); const a = el("a", "another"); a.href = "#new";
    a.append(document.createTextNode("Map another claim"), svg('<span class="px i-plus" aria-hidden="true"></span>'));
    a.addEventListener("click", e => { e.preventDefault(); window.scrollTo(0, 0); $("#statement").focus(); });
    li.append(a); ul.append(li);
  } catch (e) {
    ul.replaceChildren(el("li", "empty status err", e.message));
  }
}

// ---------- Paused maps ----------
// After each group finishes or fails, the research so far is saved, so a map stopped by
// low credits, the budget, or a closed tab can be picked up from Your maps.
let draftSaving = Promise.resolve();
function saveDraft() {
  const draft = {
    title: state.title, claim: state.claim,
    roster: { acad: state.acad, lead: state.lead, added: state.added }, extra: state.extra,
    batches: state.batches.map(b => ({ people: b.people, state: b.state === "done" ? "done" : "waiting", result: b.result, counts: b.counts, usage: b.usage }))
  };
  draftSaving = draftSaving.then(() => api(`/api/drafts/${state.runId}`, { draft }, "PUT")).catch(() => {});
  return draftSaving;
}

async function startResume(id) {
  history.replaceState(null, "", "/");
  try {
    const d = await api("/api/drafts/" + encodeURIComponent(id));
    Object.assign(state, { runId: id, claim: d.claim, statement: d.claim, title: d.title, stopped: false, spent: 0, budget: 0 });
    Object.assign(state, { acad: [], lead: [], added: [] }, d.roster || {});
    state.extra = { s: 0, f: 0, i: 0, o: 0, ...(d.extra || {}) };
    state.batches = d.batches.map((b, i) => ({ ...b, i }));
    const left = state.batches.filter(b => b.state !== "done").length, done = state.batches.length - left;
    $("#r-title").textContent = d.title;
    $("#r-claim").textContent = d.claim;
    $("#r-state").textContent = "Paused";
    $("#stoprow").hidden = true;
    $("#r-status").textContent = `${cap(plural(done, "group is", "groups are"))} done and ${plural(left, "group", "groups")} still to research. Continuing gives the rest a new research budget. If research stopped because your Anthropic account ran out of credits, add credits first.`;
    $("#resumebtn").hidden = !left;
    const bb = $("#buildbtn"); bb.hidden = !done;
    bb.replaceChildren(document.createTextNode(left ? "Build the map with what's done" : "Build the map"), svg(ARROW));
    bb.classList.toggle("ghost", !!left);
    $("#discardbtn").hidden = false; $("#discardbtn").textContent = "Discard this map";
    clearAlert("research");
    go("research"); drawBatches();
  } catch (e) { go("home"); showAlert("home", e); }
}
$("#resumebtn").addEventListener("click", async () => {
  const btn = $("#resumebtn"); btn.disabled = true;
  try {
    const r = await api(`/api/runs/${state.runId}/resume`, {});
    state.budget = r.budget || 0; state.spent = 0;
    btn.hidden = true; $("#buildbtn").hidden = true; $("#buildbtn").classList.remove("ghost"); $("#discardbtn").hidden = true;
    $("#r-title").textContent = `Researching ${plural(state.batches.filter(b => b.state !== "done").reduce((n, b) => n + b.people.length, 0), "person", "people")}`;
    $("#r-state").textContent = "Working"; $("#r-status").textContent = ""; $("#stoprow").hidden = false;
    runAll();
  } catch (e) { showAlert("research", e); }
  finally { btn.disabled = false; }
});
$("#discardbtn").addEventListener("click", async () => {
  const btn = $("#discardbtn");
  // Two clicks, since this can't be undone.
  if (!btn.dataset.sure) { btn.dataset.sure = "1"; btn.textContent = "Discard for good? Click again to confirm."; return; }
  delete btn.dataset.sure;
  try { await api("/api/drafts/" + encodeURIComponent(state.runId), null, "DELETE"); location.href = "/#maps"; }
  catch (e) { showAlert("research", e); }
});

// "Run again" on a finished map opens the people step with the same claim and people.
async function startRerun(id) {
  history.replaceState(null, "", "/");
  try {
    const map = await api("/api/maps/" + encodeURIComponent(id));
    state.statement = map.claim; state.claim = map.claim; state.title = map.title; state.extra = { s: 0, f: 0, i: 0, o: 0 };
    const roster = Array.isArray(map.roster) && map.roster.length ? map.roster
      : map.people.map(p => ({ name: p.name, role: p.role, leader: p.co }));
    state.acad = roster.filter(p => !p.leader).map(p => ({ name: p.name, role: p.role || "", leader: false }));
    state.lead = roster.filter(p => p.leader).map(p => ({ name: p.name, role: p.role || "", leader: true })); state.added = [];
    $("#statement").value = map.claim; $("#claim").value = map.claim; $("#title").value = map.title;
    drawClaims([map.claim]);
    openPeople(true);
  } catch (e) { go("home"); showAlert("home", e); }
}

loadStatus(); loadMaps();
const qs = new URLSearchParams(location.search);
if (qs.get("rerun")) startRerun(qs.get("rerun"));
else if (qs.get("resume")) startResume(qs.get("resume"));
else go("home");
