// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Christelle Prophete. See LICENSE.
// Idea Landscape Map server. Runs on Cloudflare Workers.
// The page calls these routes; every prompt and model setting stays here.
import { sharpenPrompt, refinePrompt, candidatesPrompt, researchPrompt, summaryPrompt, tidyPrompt, profilesPrompt, studiesPrompt, relabelPrompt, WHO_GROUPS } from "./prompts.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_CONTINUATIONS = 12;
const MAX_RESEARCH_CALLS_PER_RUN = 12;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!(await allowed(request, env))) return json({ error: "Sign in through Cloudflare Access to use this app." }, 401);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "The server has no Anthropic API key. Add ANTHROPIC_API_KEY as a secret." }, 500);
    try {
      return await route(request, env, ctx, url);
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.expose ? e.message : "Something went wrong on the server. Try again." , detail: String(e.message || e).slice(0, 300) }, status);
    }
  }
};

async function route(request, env, ctx, url) {
  const p = url.pathname, m = request.method;
  if (p === "/api/status" && m === "GET") {
    return json({ model: model(env), budget: budget(env) });
  }
  if (p === "/api/sharpen" && m === "POST") {
    const { statement } = await body(request);
    need(text(statement, 1000), "Type a statement of 1,000 characters or less.");
    return json(await metered(m => askJSON(env, sharpenPrompt(statement.trim()), 2000, undefined, m)));
  }
  if (p === "/api/refine" && m === "POST") {
    const { statement, answers } = await body(request);
    need(text(statement, 1000) && Array.isArray(answers) && answers.length <= 6, "Missing statement or answers.");
    const clean = answers.map(a => ({ question: String(a.question).slice(0, 400), answer: String(a.answer).slice(0, 400) }));
    return json(await metered(m => askJSON(env, refinePrompt(statement.trim(), clean), 1500, undefined, m)));
  }
  if (p === "/api/candidates" && m === "POST") {
    const { claim } = await body(request);
    need(text(claim, 400), "Missing claim.");
    // A few web searches so the list reflects who is active in the debate now.
    return json(await metered(m => askJSON(env, candidatesPrompt(claim.trim()), 8000, [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }], m)));
  }
  if (p === "/api/runs" && m === "POST") {
    const { claim, title } = await body(request);
    need(text(claim, 400) && text(title, 80), "Missing claim or title.");
    const day = nyDate();
    const run = { id: rid(), claim: claim.trim(), title: title.trim(), day, calls: 0 };
    await putRun(env, run);
    return json({ runId: run.id });
  }
  const stopm = p.match(/^\/api\/runs\/([a-z0-9]{10,40})\/stop$/);
  if (stopm && m === "POST") {
    // The page's "Stop and build with what's done" button. Calls in progress stop at their next step.
    const run = await getRun(env, stopm[1]);
    run.stopped = true;
    await putRun(env, run);
    return json({ ok: true });
  }
  const resm = p.match(/^\/api\/runs\/([a-z0-9]{10,40})\/resume$/);
  if (resm && m === "POST") {
    // "Continue research" on a paused map. The remaining groups get a new research budget.
    const run = await getRun(env, resm[1]);
    run.stopped = false; run.tokens = 0; run.calls = 0;
    await putRun(env, run);
    return json({ ok: true, budget: budget(env) });
  }
  // Paused maps: research saved after each group, so it can be picked up later.
  if (p === "/api/drafts" && m === "GET") {
    return json({ drafts: JSON.parse((await env.MAPS.get("drafts:index")) || "[]") });
  }
  const dm = p.match(/^\/api\/drafts\/([a-z0-9]{10,40})$/);
  if (dm && m === "PUT") {
    const run = await getRun(env, dm[1]);
    const { draft } = await body(request);
    const raw = JSON.stringify(draft || {});
    need(raw.length < 900000 && Array.isArray(draft.batches), "The saved research is missing or too large.");
    run.kept = true; await putRun(env, run);
    await env.MAPS.put("draft:" + run.id, raw);
    const done = draft.batches.filter(b => b.state === "done").length;
    const index = JSON.parse((await env.MAPS.get("drafts:index")) || "[]").filter(x => x.id !== run.id);
    index.unshift({ id: run.id, title: run.title, updated: nyDate(), done, total: draft.batches.length });
    await env.MAPS.put("drafts:index", JSON.stringify(index));
    return json({ ok: true });
  }
  if (dm && m === "GET") {
    const raw = await env.MAPS.get("draft:" + dm[1]);
    return raw ? new Response(raw, { headers: { "content-type": "application/json" } }) : json({ error: "This paused map is no longer saved." }, 404);
  }
  if (dm && m === "DELETE") {
    await dropDraft(env, dm[1]);
    return json({ ok: true });
  }
  if (p === "/api/research" && m === "POST") {
    const { runId, people } = await body(request);
    const run = await getRun(env, runId);
    need(Array.isArray(people) && people.length >= 1 && people.length <= 6 && people.every(x => text(x.name, 120)), "Send one to six names.");
    need(!run.stopped, "This map's research was stopped.");
    need(run.calls < MAX_RESEARCH_CALLS_PER_RUN, "This map has reached its research limit.");
    need((run.tokens || 0) < budget(env), "This map has used its spending budget, so the remaining groups were stopped. Build the map with what's done, or raise RUN_TOKEN_BUDGET in wrangler.toml.");
    run.calls++; await putRun(env, run);
    return stream(ctx, async send => {
      // Cost control: every page Claude opens is re-read on each later step of the call,
      // so the number of searches and pages, and how much of each page is kept, drive the bill.
      const n = people.length;
      const tools = [
        { type: "web_search_20250305", name: "web_search", max_uses: 2 * n + 1 },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3 * n, max_content_tokens: 5000 }
      ];
      const out = await callClaude(env, {
        prompt: researchPrompt(run.claim, people.map(x => ({ name: String(x.name).trim(), role: String(x.role || "").slice(0, 160), leader: x.leader == null ? null : !!x.leader }))),
        tools, maxTokens: 16000, model: env.RESEARCH_MODEL || model(env),
        onProgress: pr => send({ type: "progress", ...pr }),
        shouldStop: async () => !!JSON.parse((await env.MAPS.get("run:" + run.id)) || "{}").stopped
      });
      // Add this call's tokens to the map's running total for the budget check.
      const fresh = JSON.parse((await env.MAPS.get("run:" + run.id)) || JSON.stringify(run));
      fresh.tokens = (fresh.tokens || 0) + out.usage.input_tokens + out.usage.output_tokens;
      await putRun(env, fresh);
      const result = lastJSONBlock(out.text);
      if (!Array.isArray(result)) throw Object.assign(new Error("The research came back without readable results. Run this group again."), { expose: true });
      send({ type: "result", people: result, usage: out.usage, spent: fresh.tokens, budget: budget(env) });
    });
  }
  if (p === "/api/profiles" && m === "POST") {
    // Bio links and the 3 latest pieces of work for each person's card, a few people at a time.
    // With runId it counts toward that map's research budget. With mapId it fills in a saved map.
    const { runId, mapId, people } = await body(request);
    need(Array.isArray(people) && people.length >= 1 && people.length <= 3 && people.every(x => text(x.name, 120)), "Send one to three names.");
    let run = null, mapRaw = null;
    if (mapId) { mapRaw = await env.MAPS.get("map:" + String(mapId).slice(0, 90)); need(mapRaw, "No map with that link."); }
    else { run = await getRun(env, runId); need(!run.stopped, "This map's research was stopped."); }
    const clean = people.map(x => ({ name: String(x.name).trim(), role: String(x.role || "").slice(0, 160), leader: !!x.leader }));
    const out = await callClaude(env, {
      prompt: profilesPrompt(clean), maxTokens: 6000, model: model(env),
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 * clean.length + 1 }]
    });
    if (run) {
      const fresh = JSON.parse((await env.MAPS.get("run:" + run.id)) || JSON.stringify(run));
      fresh.tokens = (fresh.tokens || 0) + out.usage.input_tokens + out.usage.output_tokens;
      await putRun(env, fresh);
    }
    const found = looseJSON(out.text);
    const rows = Array.isArray(found) ? found : [];
    const profiles = await Promise.all(clean.map(async x => {
      const r = rows.find(y => y && typeof y.name === "string" && y.name.trim().toLowerCase() === x.name.toLowerCase()) || {};
      const shared = / and /.test(x.name);
      let pubs = [], from = "web";
      if (r.academic && !shared && !x.leader) {
        pubs = await openAlexWorks(env, x.name, [r.institution, x.role].filter(Boolean).join(" "));
        if (pubs.length) from = "openalex";
      }
      if (!pubs.length) {
        const items = (Array.isArray(r.recent) ? r.recent : []).slice(0, 4)
          .filter(w => w && typeof w.title === "string" && /^https?:\/\//.test(w.url || ""))
          .map(w => ({ title: w.title.slice(0, 300), outlet: String(w.outlet || "").slice(0, 120), date: String(w.date || "").slice(0, 10), url: w.url }));
        const ok = await Promise.all(items.map(w => linkWorks(w.url)));
        pubs = items.filter((_, k) => ok[k]).slice(0, 3);
      }
      const bio = /^https?:\/\//.test(r.bio_url || "") && await linkWorks(r.bio_url) ? r.bio_url : "";
      return { name: x.name, bio, pubs, from };
    }));
    if (mapRaw) {
      // Fill in the saved map, then mark it done once everyone has been looked up.
      const map = JSON.parse((await env.MAPS.get("map:" + mapId)) || mapRaw);
      profiles.forEach(pr => { const pp = (map.people || []).find(y => y.name === pr.name); if (pp) { pp.bio = pr.bio; pp.pubs = pr.pubs; pp.pubsFrom = pr.from; } });
      if ((map.people || []).every(y => typeof y.bio === "string")) map.profilesV = 1;
      await env.MAPS.put("map:" + mapId, JSON.stringify(map));
    }
    return json({ profiles, usage: out.usage });
  }
  if (p === "/api/verify" && m === "POST") {
    const { runId, quotes } = await body(request);
    await getRun(env, runId);
    need(Array.isArray(quotes) && quotes.length <= 12, "Send up to 12 quotes at a time.");
    return json({ results: await verifyQuotes(quotes) });
  }
  if (p === "/api/studies" && m === "POST") {
    // "The research behind the debate": up to six recent studies, tagged by their own findings.
    const { runId, people } = await body(request);
    const run = await getRun(env, runId);
    need(Array.isArray(people) && people.length <= 40, "Missing people.");
    const { studies, usage } = await findStudies(env, run.claim, people);
    const fresh = JSON.parse((await env.MAPS.get("run:" + run.id)) || JSON.stringify(run));
    fresh.tokens = (fresh.tokens || 0) + usage.input_tokens + usage.output_tokens;
    await putRun(env, fresh);
    return json({ studies, usage });
  }
  if (p === "/api/summary" && m === "POST") {
    const { runId, people } = await body(request);
    const run = await getRun(env, runId);
    need(Array.isArray(people) && people.length <= 40, "Missing people.");
    return json(await metered(m => askJSON(env, summaryPrompt(run.claim, people), 1500, undefined, m)));
  }
  if (p === "/api/maps" && m === "GET") {
    const index = JSON.parse((await env.MAPS.get("maps:index")) || "[]");
    // Maps saved before the redesign lack quote counts and the position bar. Fill them in once.
    let changed = false;
    for (let k = 0; k < index.length; k++) {
      if (Array.isArray(index[k].dist)) continue;
      const raw = await env.MAPS.get("map:" + index[k].id);
      if (raw) { index[k] = indexEntry(index[k].id, JSON.parse(raw)); changed = true; }
    }
    if (changed) await env.MAPS.put("maps:index", JSON.stringify(index));
    return json({ maps: index });
  }
  if (p === "/api/maps" && m === "POST") {
    const { runId, map } = await body(request);
    const run = await getRun(env, runId);
    const raw = JSON.stringify(map || {});
    need(raw.length < 900000 && Array.isArray(map.people), "The map is missing or too large.");
    const id = slug(run.title) + "-" + run.id.slice(0, 6);
    await env.MAPS.put("map:" + id, raw);
    const index = JSON.parse((await env.MAPS.get("maps:index")) || "[]").filter(x => x.id !== id);
    index.unshift(indexEntry(id, map));
    await env.MAPS.put("maps:index", JSON.stringify(index));
    await dropDraft(env, run.id);
    return json({ id });
  }
  const rl = p.match(/^\/api\/maps\/([a-z0-9-]{1,90})\/(relabel|studies)$/);
  if (rl && m === "POST") {
    // For maps made before these labels: who each person is and what each quote rests on,
    // then the recent studies. Each runs once, when the map is next opened.
    const raw = await env.MAPS.get("map:" + rl[1]);
    need(raw, "No map with that link.");
    const map = JSON.parse(raw);
    if (rl[2] === "relabel") {
      const people = (map.people || []).map(x => ({ name: x.name, role: x.role, leader: !!x.co, quotes: (x.q || []).map(q => String(q[0]).slice(0, 600)) }));
      const out = await askJSON(env, relabelPrompt(map.claim, people), 6000, [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }]);
      const rows = Array.isArray(out) ? out : [];
      (map.people || []).forEach(x => {
        const r = rows.find(y => y && typeof y.name === "string" && y.name.trim().toLowerCase() === x.name.toLowerCase());
        if (!r) return;
        x.who = x.co ? "ind" : WHO_KEYS.has(r.who) && r.who !== "ind" ? r.who : x.who;
        if (typeof r.who_note === "string") x.whoNote = r.who_note.slice(0, 400);
        x.dataNote = typeof r.data_note === "string" ? r.data_note.slice(0, 400) : "";
        (x.q || []).forEach((q, k) => { const kind = Array.isArray(r.kinds) ? r.kinds[k] : null; if (kind === "data" || kind === "view") q[7] = kind; });
      });
      map.labelsV = 1;
    } else {
      const { studies } = await findStudies(env, map.claim, (map.people || []).map(x => ({ name: x.name, data_note: x.dataNote || "" })));
      map.studies = studies; map.studiesV = 1;
    }
    await env.MAPS.put("map:" + rl[1], JSON.stringify(map));
    return json(map);
  }
  const sm = p.match(/^\/api\/maps\/([a-z0-9-]{1,90})\/summary$/);
  if (sm && m === "POST") {
    // Rewrites the two summaries of a saved map. Used once for maps whose summaries
    // were written before they named positions in words.
    const raw = await env.MAPS.get("map:" + sm[1]);
    need(raw, "No map with that link.");
    const map = JSON.parse(raw);
    const sum = await askJSON(env, summaryPrompt(map.claim, summaryPeople(map.people || [])), 1500);
    if (sum.finding) map.finding = sum.finding;
    if (map.labelsV) { map.gap = sum.gap || ""; map.gapV = 1; }
    // Shorter notes on each person (and quote notes) that use the first person or position numbers.
    const slots = [];
    const flag = s => typeof s === "string" && OLD_STYLE.test(s);
    (map.people || []).forEach(x => {
      ["why", "caveat", "shift", "interest", "evn"].forEach(k => { if (flag(x[k])) slots.push([x, k]); });
      (x.q || []).forEach(q => { if (flag(q[5])) slots.push([q, 5]); });
    });
    (map.dropped || []).forEach(d => { if (flag(d.reason)) slots.push([d, "reason"]); });
    if (slots.length) {
      try {
        const fixed = await askJSON(env, tidyPrompt(slots.map(([o, k]) => o[k])), 4000);
        if (Array.isArray(fixed) && fixed.length === slots.length) slots.forEach(([o, k], j) => { if (typeof fixed[j] === "string" && fixed[j].trim()) o[k] = fixed[j].trim(); });
      } catch {}
    }
    map.summaryV = 2;
    await env.MAPS.put("map:" + sm[1], JSON.stringify(map));
    return json(map);
  }
  const mm = p.match(/^\/api\/maps\/([a-z0-9-]{1,90})$/);
  if (mm && m === "GET") {
    const raw = await env.MAPS.get("map:" + mm[1]);
    return raw ? new Response(raw, { headers: { "content-type": "application/json" } }) : json({ error: "No map with that link." }, 404);
  }
  if (mm && m === "DELETE") {
    await env.MAPS.delete("map:" + mm[1]);
    const index = JSON.parse((await env.MAPS.get("maps:index")) || "[]").filter(x => x.id !== mm[1]);
    await env.MAPS.put("maps:index", JSON.stringify(index));
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

// ---------- Claude calls ----------

// Runs a Claude call and adds what it used to the reply, so the map's cost line counts every step.
async function metered(fn) {
  const meter = { input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
  const value = await fn(meter);
  return { ...value, usage: meter };
}

async function askJSON(env, prompt, maxTokens, tools, meter) {
  let out;
  for (let attempt = 0; attempt < 2; attempt++) {
    // A second try gets twice the room, in case the first answer was cut off.
    out = await callClaude(env, { prompt, tools, maxTokens: maxTokens * (attempt + 1), model: model(env) });
    if (meter) for (const k in meter) meter[k] += out.usage[k] || 0;
    const value = looseJSON(out.text);
    if (value != null) return value;
    console.log("askJSON could not parse", JSON.stringify({ attempt, stop: out.stop, chars: out.text.length, start: out.text.slice(0, 400), end: out.text.slice(-400) }));
  }
  throw Object.assign(new Error(out.stop === "max_tokens"
    ? "Claude's answer was too long and got cut off. Try again."
    : "Claude's answer couldn't be read. Try again."), { expose: true, status: 502 });
}

async function callClaude(env, { prompt, tools, maxTokens, model, onProgress, shouldStop }) {
  const messages = [{ role: "user", content: prompt }];
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
  let texts = [], searches = 0, fetches = 0, stop = null;
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const res = await post(env, { model, max_tokens: maxTokens, messages, ...(tools ? { tools } : {}) });
    for (const k of ["input_tokens", "output_tokens"]) usage[k] += res.usage?.[k] || 0;
    usage.web_search_requests += res.usage?.server_tool_use?.web_search_requests || 0;
    usage.web_fetch_requests += res.usage?.server_tool_use?.web_fetch_requests || 0;
    for (const b of res.content || []) {
      if (b.type === "text") texts.push(b.text);
      if (b.type === "server_tool_use" && b.name === "web_search") searches++;
      if (b.type === "server_tool_use" && b.name === "web_fetch") fetches++;
    }
    onProgress?.({ searches, fetches });
    stop = res.stop_reason;
    if (res.stop_reason !== "pause_turn") break;
    if (shouldStop && await shouldStop()) throw Object.assign(new Error("This map's research was stopped."), { expose: true, status: 409 });
    messages.push({ role: "assistant", content: res.content });
  }
  return { text: texts.join(""), usage, stop };
}

async function post(env, payload) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(env.ANTHROPIC_BASE_URL || API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload)
    });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status === 529 || r.status >= 500) {
      const wait = Math.min(60, Number(r.headers.get("retry-after")) || 5 * 2 ** attempt);
      await new Promise(ok => setTimeout(ok, wait * 1000));
      continue;
    }
    const detail = await r.text();
    const msg = r.status === 401 ? "The Anthropic API key was rejected. Check the ANTHROPIC_API_KEY secret."
      : r.status === 400 && /credit/i.test(detail) ? "Your Anthropic account is out of credits."
      : `The Anthropic API returned an error (${r.status}).`;
    throw Object.assign(new Error(msg), { expose: true, status: 502 });
  }
  throw Object.assign(new Error("The Anthropic API is busy. Wait a minute and try again."), { expose: true, status: 503 });
}

// ---------- Quote checking ----------

async function verifyQuotes(quotes) {
  const pages = new Map();
  const load = url => {
    if (!pages.has(url)) pages.set(url, fetchPageText(url));
    return pages.get(url);
  };
  return Promise.all(quotes.map(async q => {
    const t = String(q.text || "").slice(0, 1500), u = String(q.url || "");
    if (!/^https?:\/\//.test(u) || !t) return { status: "not_found" };
    const page = await load(u);
    if (page == null) return { status: "unreachable" };
    const a = norm(t), b = page.norm;
    if (b.includes(a)) return { status: "found" };
    if (page.loose.includes(loose(t))) return { status: "close" };
    return { status: "not_found" };
  }));
}

// OpenAlex (openalex.org) is a free index of scholarly work. Match the name exactly, and when
// several authors share it, keep the one whose institution appears in the hint. Otherwise skip.
async function openAlexWorks(env, name, hint) {
  // A free OpenAlex key (OPENALEX_API_KEY) allows about 1,000 name searches a day. Without one, only about 10.
  const key = env.OPENALEX_API_KEY ? "&api_key=" + encodeURIComponent(env.OPENALEX_API_KEY) : "";
  try {
    const base = s => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const want = base(name);
    const r = await fetch("https://api.openalex.org/authors?per-page=10&search=" + encodeURIComponent(name) + key, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const authors = ((await r.json()).results || []).filter(a => base(a.display_name || "") === want && a.works_count > 0);
    if (!authors.length) return [];
    const h = base(hint || "");
    const inst = a => (a.last_known_institutions || []).map(i => base(i.display_name || ""));
    const hits = authors.filter(a => inst(a).some(n => n && h.includes(n)));
    const author = hits.length === 1 ? hits[0] : authors.length === 1 ? authors[0] : null;
    if (!author) return [];
    const id = String(author.id).split("/").pop();
    const w = await fetch(`https://api.openalex.org/works?per-page=6&sort=publication_date:desc&filter=author.id:${id},type:article|book|book-chapter|preprint|report${key}`, { signal: AbortSignal.timeout(10000) });
    if (!w.ok) return [];
    const seen = new Set();
    return ((await w.json()).results || []).filter(x => {
      const k = base(x.title || x.display_name || ""); if (!k || seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, 3).map(x => ({
      title: String(x.title || x.display_name).slice(0, 300),
      outlet: String(x.primary_location?.source?.display_name || "").slice(0, 120),
      date: String(x.publication_date || x.publication_year || "").slice(0, 7),
      url: x.doi || x.primary_location?.landing_page_url || x.id
    }));
  } catch { return []; }
}

// A link counts unless the page is missing (404 or 410) or the site can't be reached.
// Many publishers block automated visits, so other errors still count as working links.
async function linkWorks(url) {
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; IdeaLandscapeMap/1.0; link check)" }, signal: AbortSignal.timeout(8000) });
    r.body?.cancel?.();
    return r.status !== 404 && r.status !== 410;
  } catch { return false; }
}

async function fetchPageText(url) {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; IdeaLandscapeMap/1.0; quote check)", "accept": "text/html,application/xhtml+xml,text/plain" },
      redirect: "follow", signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!/text|html|xml|json/.test(type)) return null;
    const raw = (await r.text()).slice(0, 3_000_000);
    const plain = decode(raw.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
    return { norm: norm(plain), loose: loose(plain) };
  } catch { return null; }
}

const ENT = { amp: "&", quot: '"', apos: "'", nbsp: " ", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", lt: "<", gt: ">" };
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function norm(s) {
  return s.normalize("NFKC").replace(/[​-‍﻿­]/g, "")
    .replace(/[‘’‛′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ").trim().toLowerCase();
}
function loose(s) { return norm(s).replace(/[^\p{L}\p{N}]+/gu, ""); }

// ---------- Access ----------

let jwks = null, jwksAt = 0;
async function allowed(request, env) {
  if (env.DEV_NO_AUTH === "1") return true;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  try {
    const [h, p, s] = token.split(".");
    const header = JSON.parse(b64text(h)), payload = JSON.parse(b64text(p));
    const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(env.ACCESS_AUD) || payload.iss !== "https://" + team || payload.exp * 1000 < Date.now()) return false;
    if (!jwks || Date.now() - jwksAt > 3600_000) {
      jwks = (await (await fetch(`https://${team}/cdn-cgi/access/certs`)).json()).keys; jwksAt = Date.now();
    }
    const jwk = jwks.find(k => k.kid === header.kid); if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64bytes(s), new TextEncoder().encode(h + "." + p));
  } catch { return false; }
}
function b64bytes(s) { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
function b64text(s) { return new TextDecoder().decode(b64bytes(s)); }

// ---------- Helpers ----------

function stream(ctx, work) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter(), enc = new TextEncoder();
  const send = o => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
  ctx.waitUntil((async () => {
    const beat = setInterval(() => send({ type: "ping" }), 15000);
    try { await work(send); }
    catch (e) { await send({ type: "error", error: e.expose ? e.message : "The research step failed. Run this group again." }); }
    finally { clearInterval(beat); await w.close().catch(() => {}); }
  })());
  return new Response(readable, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
async function body(request) { try { return await request.json(); } catch { throw Object.assign(new Error("The request wasn't valid JSON."), { expose: true, status: 400 }); } }
function need(ok, msg) { if (!ok) throw Object.assign(new Error(msg), { expose: true, status: 400 }); }
function text(v, max) { return typeof v === "string" && v.trim().length > 0 && v.length <= max; }
const WHO_KEYS = new Set(WHO_GROUPS.map(([k]) => k));

// What the summary needs from each saved person: who they are, where they stand, and how many
// of their quotes cite data or a study.
function summaryPeople(people) {
  return people.map(x => {
    const kinds = (x.q || []).map(q => q[7]).filter(Boolean);
    return { name: x.name, leader: !!x.co, who: x.who, position: x.s, data: kinds.filter(k => k === "data").length, quotes: kinds.length, why: x.why };
  });
}

// Up to six studies from the past nine months, newest first. Each link must open, and each study
// is tagged by what it found, read from its own page.
async function findStudies(env, claim, people) {
  const now = new Date(), from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 9, 1));
  const since = from.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const sinceYM = from.toISOString().slice(0, 7);
  const meter = { input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
  const list = people.map(x => ({ name: String(x.name || "").slice(0, 120), data_note: String(x.data_note || "").slice(0, 300) })).filter(x => x.name);
  const out = await askJSON(env, studiesPrompt(claim, since, list), 6000, [
    { type: "web_search_20250305", name: "web_search", max_uses: 6 },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 6, max_content_tokens: 4000 }
  ], meter);
  const names = new Set(list.map(x => x.name));
  const rows = (Array.isArray(out) ? out : []).filter(s => s && typeof s.title === "string" && /^https?:\/\//.test(s.url || "")
    && ["supports", "against", "mixed"].includes(s.stance) && /^\d{4}-\d{2}/.test(s.date || "") && String(s.date).slice(0, 7) >= sinceYM);
  const ok = await Promise.all(rows.map(s => linkWorks(s.url)));
  const studies = rows.filter((_, k) => ok[k]).map(s => ({
    title: s.title.slice(0, 300), authors: String(s.authors || "").slice(0, 200), org: String(s.org || "").slice(0, 160),
    date: String(s.date).slice(0, 7), url: s.url, stance: s.stance, finding: String(s.finding || "").slice(0, 500),
    citedBy: (Array.isArray(s.cited_by) ? s.cited_by : []).filter(n => names.has(n))
  })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return { studies, usage: meter };
}

// Text written before the current rules: first person, position numbers, or "rows".
const OLD_STYLE = /\b(I|I'm|I've|I'd|[Mm]e|[Mm]y|[Ww]e|[Ww]e're|[Oo]ur|us)\b|\bpositions? \d|\b(at|between) [1-5]\b|\b[1-5] (or|and|to) [1-5]\b|\brows?\b/;
// Runs expire after two days, unless their research was saved to continue later.
async function putRun(env, run) {
  await env.MAPS.put("run:" + run.id, JSON.stringify(run), run.kept ? {} : { expirationTtl: 60 * 60 * 48 });
}
async function dropDraft(env, id) {
  if (!(await env.MAPS.get("draft:" + id))) return;
  await env.MAPS.delete("draft:" + id);
  const index = JSON.parse((await env.MAPS.get("drafts:index")) || "[]").filter(x => x.id !== id);
  await env.MAPS.put("drafts:index", JSON.stringify(index));
}
async function getRun(env, runId) {
  const raw = typeof runId === "string" && /^[a-z0-9]{10,40}$/.test(runId) ? await env.MAPS.get("run:" + runId) : null;
  if (!raw) throw Object.assign(new Error("This research run has expired. Start the map again."), { expose: true, status: 404 });
  return JSON.parse(raw);
}
function budget(env) { return Number(env.RUN_TOKEN_BUDGET) || 1500000; }
function model(env) { return env.MODEL || "claude-sonnet-5-5"; }
function nyDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); }
function rid() { return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 20); }
function indexEntry(id, map) {
  const people = Array.isArray(map.people) ? map.people : [];
  return {
    id, title: map.title, claim: map.claim, researched: map.researched, count: people.length,
    quotes: people.reduce((n, p) => n + (Array.isArray(p.q) ? p.q.length : 0), 0),
    dist: [1, 2, 3, 4, 5].map(s => people.filter(p => p.s === s).length)
  };
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "map"; }
function looseJSON(s) {
  const t = String(s).replace(/```(?:json)?/g, "");
  // Try each opening brace or bracket, matched to its closing partner, so stray text around the JSON doesn't break it.
  for (let a = 0, tries = 0; a < t.length && tries < 40; a++) {
    const o = t[a];
    if (o !== "{" && o !== "[") continue;
    tries++;
    const c = o === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < t.length; i++) {
      const ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          if (ch === c) { try { return JSON.parse(t.slice(a, i + 1)); } catch {} }
          break;
        }
      }
    }
  }
  return null;
}
function lastJSONBlock(s) {
  const all = [...String(s).matchAll(/<json>([\s\S]*?)<\/json>/g)];
  for (let i = all.length - 1; i >= 0; i--) { const v = looseJSON(all[i][1]); if (v != null) return v; }
  return null;
}

export const _test = { norm, loose, decode, looseJSON, lastJSONBlock, nyDate };
