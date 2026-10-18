// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Christelle Prophete. See LICENSE.
// Draws a saved map: the claim, the finding, where each person stands, the evidence for
// whoever is selected, what the views rest on, and the method. Data comes in as one JSON object.
(function () {
  const POS = [
    [1, "Disagrees", "#4F7CF6"], [2, "Leans disagree", "#A9C1FF"], [3, "Mixed or conditional", "#D9D9D9"],
    [4, "Leans agree", "#9EDBA8"], [5, "Agrees", "#1F8A4C"]
  ];
  const EVT = [
    ["data_private", "Own analysis of private or proprietary data"],
    ["data_public", "Own analysis of public data"],
    ["review", "Review of other people’s research"],
    ["org", "Own organization’s experience"],
    ["observation", "Observation, anecdote, or forecast"]
  ];
  const EVLABEL = Object.fromEntries(EVT);
  // Who someone is, from their bio: [key, group name, one person, description].
  const WHO = [
    ["res", "Researchers with original data", "Researcher with original data", "Academics, economists, and analysts who build and analyze their own datasets"],
    ["pol", "Policy researchers", "Policy researcher", "Analysts at think tanks, policy labs, and research nonprofits"],
    ["wri", "Journalists and writers", "Journalist or writer", "Reporters, columnists, authors, and newsletter writers"],
    ["lab", "Labor and advocacy", "Labor or advocacy", "Union leaders, worker advocates, and civil society groups"],
    ["ind", "Industry leaders", "Industry leader", "Executives, founders, and people who work at companies"],
    ["aca", "Academics and writers", "Academic or writer", "Researchers, analysts, and writers"]
  ];
  const WHOOF = Object.fromEntries(WHO.map(w => [w[0], w]));
  const STANCE = { supports: ["Supports the claim", "#9EDBA8"], against: ["Cuts against the claim", "#A9C1FF"], mixed: ["Mixed", "#D9D9D9"] };
  const CHECK = {
    found: ["✓", "Checked word for word"],
    close: ["≈", "Close match: small differences such as punctuation"],
    unreachable: ["!", "Couldn't open the source page, so this quote is unconfirmed"]
  };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const frag = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content; };
  // AP style: spell out zero through nine, use numerals for 10 and up.
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const num = n => (Number.isInteger(n) && n >= 0 && n < 10 ? WORDS[n] : String(n));
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
  const pubDate = s => { const [y, m] = String(s || "").split("-").map(Number); return y ? (m ? `${MONTHS[m - 1]} ${y}` : String(y)) : ""; };
  const apDate = iso => { const [y, m, d] = String(iso).split("-").map(Number); return y ? `${AP_MONTHS[m - 1]} ${d}, ${y}` : String(iso || ""); };
  const monthIndex = d => { const [m, y] = String(d).split(" "); const i = MONTHS.indexOf(m); return i < 0 ? -1 : Number(y) * 12 + i; };

  // Claude's summaries mark one lead sentence with <b>. Split it out as a headline.
  function lead(html) {
    const s = String(html || "");
    const m = s.match(/<b>([\s\S]*?)<\/b>/);
    const strip = t => t.replace(/<\/?b>/g, "").replace(/\s+/g, " ").trim();
    if (!m) { const parts = strip(s).split(/(?<=[.?!])\s+/); return { head: parts.shift() || "", rest: parts }; }
    const rest = strip(s.replace(m[0], "")).split(/(?<=[.?!])\s+/).filter(Boolean);
    return { head: strip(m[1]), rest };
  }
  function restParas(sentences) {
    if (!sentences.length) return [];
    if (sentences.length < 2) return [sentences.join(" ")];
    // Split where the two columns come out closest in length.
    const total = sentences.join(" ").length; let best = 1, gap = Infinity;
    for (let k = 1; k < sentences.length; k++) { const d = Math.abs(sentences.slice(0, k).join(" ").length * 2 - total); if (d < gap) { gap = d; best = k; } }
    return [sentences.slice(0, best).join(" "), sentences.slice(best).join(" ")];
  }
  function section(cls, label, id) {
    const s = el("section", cls); if (id) s.id = id;
    s.append(el("span", "eyebrow", label));
    const b = el("div", "body"); s.append(b); return [s, b];
  }

  function render(map, root, id) {
    const P = map.people.map((p, i) => ({ ...p, i }));
    const posOf = s => POS[s - 1];
    const groupOf = p => p.co ? "ind" : (WHOOF[p.who] && p.who !== "ind" ? p.who : "aca");
    const typeOf = p => WHOOF[groupOf(p)][2];
    // Quote tags: q[7] is "data" (cites data or a study) or "view" (a view or forecast).
    const kindsOf = p => (p.q || []).map(q => q[7]).filter(k => k === "data" || k === "view");
    const hasKinds = P.some(p => kindsOf(p).length);
    // Reading order for Previous and Next: by position, then as listed.
    const order = [...P].sort((a, b) => a.s - b.s || a.i - b.i);
    let picked = -1;
    const chipsByPerson = new Map();
    root.replaceChildren();

    // Finished bar
    const partial = map.partial || (Array.isArray(map.notes) && map.notes.some(n => /^Not researched because/.test(String(n))) ? {} : null);
    const bar = el("div", "finished" + (partial ? " partial" : ""));
    bar.append(frag(partial
      ? '<span class="mark"><span class="px i-info" aria-hidden="true"></span>PARTIAL MAP</span>'
      : '<span class="mark"><span class="px i-check" aria-hidden="true"></span>FINISHED MAP</span>'));
    const say = el("span", "say"); say.append(el("strong", null, (map.title || "This map") + "."), document.createTextNode(partialText() || (id
      ? " All five steps are done, every quote has been checked, and this map is saved to Your maps."
      : " A sample map made with this tool. Every quote was checked against its source page when the map was made.")));
    function partialText() {
      if (!partial) return "";
      const why = { stopped: "the research was stopped", budget: "the map reached its spending budget", failed: "a research group didn't finish" }[partial.reason];
      const skipped = Array.isArray(partial.skipped) ? partial.skipped.length : 0;
      const head = partial.total && skipped
        ? ` Built from ${plural(partial.total - skipped, "person", "people")} out of ${partial.total}${why ? `, because ${why}` : ""}.`
        : " Some people weren't researched.";
      return head + " Their names are in the notes under the chart." + (id ? " Run again to research everyone." : "");
    }
    const del = el("button", "btn"); del.type = "button"; del.append(frag('<span class="px i-bin" aria-hidden="true"></span>'), el("span", "lbl", "Delete map"));
    const again = el("a", "btn again"); const ag = el("span", "top"); ag.append(frag('<span class="px i-refresh" aria-hidden="true"></span>'), document.createTextNode("Run again")); again.append(ag, el("span", "sub", "Uses a new research budget")); again.href = "/?rerun=" + encodeURIComponent(id || "");
    const pdf = el("button", "btn solid"); pdf.type = "button";
    pdf.append(frag('<span class="px i-download" aria-hidden="true"></span>'), document.createTextNode("Download PDF"));
    const msg = el("p", "msg"); msg.setAttribute("role", "status");
    bar.append(say, again, pdf, del, msg);
    if (!id) { del.hidden = true; again.hidden = true; }
    // Delete asks first, inline, with a clear way out.
    const confirmBox = el("div", "confirm"); confirmBox.hidden = true; confirmBox.setAttribute("role", "alertdialog"); confirmBox.setAttribute("aria-label", "Confirm delete");
    const yes = el("button", "btn solid", "Delete"); yes.type = "button";
    const no = el("button", "btn", "Keep"); no.type = "button";
    confirmBox.append(el("span", "q", "Delete this map? This can't be undone."), yes, no);
    bar.append(confirmBox);
    del.addEventListener("click", () => { confirmBox.hidden = false; msg.textContent = ""; no.focus(); });
    no.addEventListener("click", () => { confirmBox.hidden = true; del.focus(); });
    yes.addEventListener("click", async () => {
      yes.disabled = no.disabled = true; msg.textContent = "Deleting…";
      try {
        const r = await fetch("/api/maps/" + encodeURIComponent(id), { method: "DELETE" });
        if (!r.ok) throw new Error();
        location.href = "/";
      } catch { yes.disabled = no.disabled = false; msg.textContent = "Couldn't delete the map. Try again."; }
    });
    pdf.addEventListener("click", () => window.print());
    root.append(bar);

    const main = el("main"); root.append(main);

    // The claim
    const ch = el("section", "claimhead"); ch.setAttribute("aria-labelledby", "h-claim");
    const h1 = el("h1", null, map.claim); h1.id = "h-claim";
    ch.append(el("span", "eyebrow", "The claim"), h1, el("span", "eyebrow", "Researched " + apDate(map.researched)));
    ch.append(el("p", "disclaim", "This map is a snapshot of what people had said as of the research date, and their views can change. It was built with Claude, which can make mistakes, so check the linked sources before relying on a placement."));
    main.append(ch);

    // The finding
    if (map.finding) {
      const [s, b] = section("msec", "The finding");
      const f = lead(map.finding);
      b.append(el("h2", null, f.head));
      const paras = restParas(f.rest);
      if (paras.length) { const g = el("div", "twocol"); paras.forEach(t => g.append(el("p", null, t))); b.append(g); }
      main.append(s);
    }

    // Where each person stands
    const land = el("section", "landscape"); land.id = "landscape"; land.setAttribute("aria-labelledby", "h-spectrum");
    const hr = el("div", "headrow"); hr.append(el("span", "eyebrow", "The positions"));
    const hb = el("div", "body");
    const shared = P.filter(p => p.name.includes(" and "));
    const dropped = Array.isArray(map.dropped) ? map.dropped : null;
    const notes = [];
    const groupCounts = WHO.map(([k, many, one]) => [P.filter(p => groupOf(p) === k).length, one.toLowerCase(), many.toLowerCase()]).filter(([n]) => n);
    const listed = groupCounts.map(([n, one, many]) => plural(n, one, many));
    notes.push(`In all, ${plural(P.length, "person", "people")}: ${listed.length > 1 ? listed.slice(0, -1).join(", ") + ", and " + listed[listed.length - 1] : listed[0]}.`);
    if (shared.length) notes.push(`Co-authors of one study are listed together and counted as one: ${shared.map(p => p.name).join("; ")}.`);
    if (dropped) notes.push(dropped.length
      ? `Couldn't place: ${dropped.map(d => `${d.name} (${d.reason})`).join("; ")}.`
      : "Couldn't place: none for this map. When the research can't confirm where someone stands, they're named here with the reason.");
    const h2 = el("h2", null, "Where each person stands"); h2.id = "h-spectrum";
    const sup = el("sup", "fn");
    notes.forEach((_, k) => { if (k) sup.append(", "); const a = el("a", null, String(k + 1)); a.href = "#fn" + (k + 1); a.setAttribute("aria-label", "Note " + (k + 1)); sup.append(a); });
    h2.append(sup);
    hb.append(h2, frag('<p class="legend-hint no-print">Select a name to see their commentary below.</p>'), frag('<div class="legend"><span><span class="sample">Name</span>Researcher, writer, or advocate</span><span><span class="sample co">Name <span class="dot" aria-hidden="true"></span></span>Industry leader</span><span><span class="sample sel">Name</span>Selected</span>' + (hasKinds ? '<span><span class="sq" aria-hidden="true"><i class="on"></i><i></i></span>Each square is one quote. Filled: cites data or a study. Open: a view or forecast.</span>' : '') + '</div>'));
    hr.append(hb); land.append(hr);

    // The chart: colored bars for each category on top, then one row per group of people.
    const lt = el("div", "lgrid"); lt.setAttribute("role", "table"); lt.setAttribute("aria-label", "Where each person stands, by who they are");
    const max = Math.max(1, ...POS.map(([s]) => P.filter(p => p.s === s).length));
    const corner = el("span", "lcorner"); corner.setAttribute("aria-hidden", "true"); lt.append(corner);
    POS.forEach(([s, label, fill]) => {
      const n = P.filter(p => p.s === s).length;
      const h = el("div", "lhead"); h.setAttribute("role", "columnheader");
      h.append(el("span", "clabel", label));
      const area = el("div", "larea");
      const cnt = el("span", "count", String(n)); cnt.append(el("span", "unit", n === 1 ? "person" : "people"));
      const b = el("span", "lbar"); b.style.cssText = `height:${n ? Math.max(8, Math.round(n / max * 64)) : 3}px;background:${fill}` + (s > 1 && s < 5 ? ";box-shadow:inset 0 0 0 1px #0A0A0A" : "");
      const hb2 = el("span", "hbar"); hb2.style.cssText = `width:${Math.max(4, Math.round(n / max * 100))}%;background:${fill}`;
      area.append(cnt, b, hb2); h.append(area); lt.append(h);
    });
    WHO.forEach(([k, many, , desc]) => {
      const people = P.filter(p => groupOf(p) === k); if (!people.length) return;
      const gh = el("div", "lgroup"); gh.setAttribute("role", "rowheader");
      const cnt = el("span", "gcount", String(people.length)); cnt.append(el("span", "unit", people.length === 1 ? "person" : "people"));
      const dist = el("span", "dist"); dist.setAttribute("aria-hidden", "true");
      POS.forEach(([s, , fill]) => { const n = people.filter(p => p.s === s).length; if (!n) return; const seg = el("span"); seg.style.flex = n; seg.style.background = fill; dist.append(seg); });
      gh.append(el("span", "eyebrow", many), cnt, dist, el("span", "gdesc", desc));
      lt.append(gh);
      POS.forEach(([s, label]) => {
        const here = people.filter(p => p.s === s);
        const cell = el("div", "lcell" + (here.length ? "" : " none")); cell.setAttribute("role", "cell"); cell.dataset.pos = label;
        if (here.length) here.forEach(p => cell.append(chip(p))); else cell.append(el("span", "noone", "No one"));
        lt.append(cell);
      });
    });
    land.append(lt);
    const fns = el("ol", "fns"); notes.forEach((n, k) => { const li = el("li", null, `${k + 1}. ${n}`); li.id = "fn" + (k + 1); fns.append(li); });
    land.append(fns);
    main.append(land);

    function chip(p) {
      const c = el("button", "chip" + (p.co ? " co" : "")); c.type = "button";
      c.setAttribute("aria-pressed", "false");
      const kd = kindsOf(p), nd = kd.filter(k => k === "data").length;
      c.setAttribute("aria-label", `${p.name}, ${typeOf(p).toLowerCase()}, ${posOf(p.s)[1].toLowerCase()}${kd.length ? `, ${num(nd)} of ${num(kd.length)} quotes cite data` : ""}. Show their commentary.`);
      c.append(el("span", null, p.name));
      const kinds = kindsOf(p);
      if (kinds.length) { const sq = el("span", "sq"); sq.setAttribute("aria-hidden", "true"); kinds.forEach(k => sq.append(el("i", k === "data" ? "on" : null))); c.append(sq); }
      else if (p.co) { const d = el("span", "dot"); d.setAttribute("aria-hidden", "true"); c.append(d); }
      c.addEventListener("click", () => pick(p.i, true));
      if (!chipsByPerson.has(p.i)) chipsByPerson.set(p.i, []);
      chipsByPerson.get(p.i).push(c);
      return c;
    }

    // The commentary from the selected person
    const [evs, evb] = section("msec evidence", "The commentary", "evidence");
    evs.setAttribute("aria-labelledby", "h-person");
    const live = el("p", "sr"); live.setAttribute("aria-live", "polite"); evs.append(live);
    main.append(evs);
    function drawEvidence() {
      evb.replaceChildren();
      if (picked < 0) { evb.append(el("p", "pick-prompt", "Select a name in the chart above to see that person's quotes, sources, and caveats.")); return; }
      const p = P[picked], [, plabel, fill] = posOf(p.s);
      const panel = el("div", "epanel");
      const left = el("div", "left"), who = el("div", "who");
      const pos = el("span", "eyebrow pos"); const sw = el("span", "swatch"); sw.style.background = fill; sw.setAttribute("aria-hidden", "true");
      pos.append(sw, document.createTextNode(plabel)); pos.style.color = "inherit";
      const name = el("h2", null, p.name); name.id = "h-person";
      // Who they are has its own note on the right, so the role line shows only their role.
      who.append(pos, name, el("span", "role", (p.who || p.co ? [p.role] : [p.role, typeOf(p)]).filter(Boolean).join(" · ")));
      if (p.bio) { const b = el("a", "biolink", "Bio and profile"); b.href = p.bio; b.target = "_blank"; b.rel = "noopener"; who.append(b); }
      const flags = [p.shift && "VIEW CHANGED", p.low && "LOW CONFIDENCE"].filter(Boolean);
      if (flags.length) { const f = el("div", "flags"); flags.forEach(t => f.append(el("span", null, t))); who.append(f); }
      const qs = el("div", "quotes");
      p.q.forEach(([text, title, outlet, date, url, note, check, kind]) => {
        const bq = el("blockquote", "quote");
        bq.append(el("p", "q", "“" + text + "”"));
        const src = el("span", "src"); const a = el("a", null, title); a.href = url; a.target = "_blank"; a.rel = "noopener";
        src.append(a, document.createTextNode([outlet, date].filter(Boolean).map(x => ", " + x).join("")));
        bq.append(src);
        if (note) bq.append(el("p", "qnote", note));
        const tags = el("div", "qtags");
        if (kind === "data" || kind === "view") tags.append(el("span", "kind" + (kind === "data" ? " data" : ""), kind === "data" ? "Cites data or a study" : "View or forecast"));
        if (CHECK[check]) { const c = el("span", check === "found" ? "check stamp" : "check"); const ic = el("span", "ic", CHECK[check][0]); ic.setAttribute("aria-hidden", "true"); c.append(ic, document.createTextNode(CHECK[check][1])); tags.append(c); }
        if (tags.childNodes.length) bq.append(tags);
        const mi = monthIndex(date), [ry, rm] = String(map.researched).split("-").map(Number);
        if (mi >= 0 && ry && ry * 12 + rm - 1 - mi > 12) bq.append(el("span", "qnote", "Over a year old"));
        qs.append(bq);
      });
      left.append(who, qs);
      const right = el("div", "right");
      const block = (t, x) => { if (!x) return; const d = el("div"); d.append(el("h3", null, t), el("p", null, x)); right.append(d); };
      if (p.who || p.co) block("Who they are", typeOf(p) + "." + (p.whoNote ? " " + p.whoNote : ""));
      block("Why this placement", p.why);
      const kinds = kindsOf(p), nd = kinds.filter(k => k === "data").length;
      if (kinds.length) block("What these quotes rest on", (nd
        ? `${cap(num(nd))} of ${num(kinds.length)} quotes ${nd === 1 ? "cites" : "cite"} data or a study.`
        : (kinds.length === 2 ? "Neither quote cites data or a study." : "None of these quotes cite data or a study.")) + (p.dataNote ? " " + p.dataNote : ""));
      else block("What this view rests on", p.ev ? EVLABEL[p.ev] + "." + (p.evn ? " " + p.evn : "") : "");
      block("Caveats", p.caveat);
      block("How the view changed", p.shift);
      block("Business interests to weigh", p.co ? p.interest : "");
      // Their latest work: papers from OpenAlex for academics, writing or talks found by web search for others.
      if (Array.isArray(p.pubs) && p.pubs.length) {
        const d = el("div", "pubs"); d.append(el("h3", null, p.co ? "Latest writing and talks" : "Latest work"));
        const ol = el("ol");
        p.pubs.slice(0, 3).forEach(w => {
          const li = el("li"); const a = el("a", null, w.title); a.href = w.url; a.target = "_blank"; a.rel = "noopener";
          li.append(a); const meta = [w.outlet, pubDate(w.date)].filter(Boolean).join(", "); if (meta) li.append(el("span", "meta", meta));
          ol.append(li);
        });
        d.append(ol);
        if (p.pubsFrom === "openalex") { const s = el("p", "src"); const a = el("a", null, "OpenAlex"); a.href = "https://openalex.org"; a.target = "_blank"; a.rel = "noopener"; s.append(document.createTextNode("From "), a, document.createTextNode(", an open index of research.")); d.append(s); }
        right.append(d);
      }
      panel.append(left, right);
      const at = order.findIndex(x => x.i === picked);
      const nav = el("nav", "movenav"); nav.setAttribute("aria-label", "Move between people");
      const prev = el("button", "btn", at > 0 ? "← Previous: " + order[at - 1].name : "← Previous"); prev.type = "button"; prev.disabled = at <= 0;
      prev.addEventListener("click", () => pick(order[at - 1].i, false, prev));
      const back = el("a", null, "Back to the chart"); back.href = "#landscape"; back.style.padding = "12px 4px";
      const next = el("button", "btn solid", at < order.length - 1 ? "Next: " + order[at + 1].name + " →" : "Next →"); next.type = "button"; next.disabled = at >= order.length - 1;
      next.addEventListener("click", () => pick(order[at + 1].i, false, next));
      nav.append(prev, back, next);
      evb.append(panel, nav);
    }
    function pick(i, scroll, from) {
      picked = i;
      chipsByPerson.forEach((list, k) => list.forEach(c => c.setAttribute("aria-pressed", String(k === i))));
      drawEvidence();
      const p = P[i]; live.textContent = `Showing commentary from ${p.name}: ${posOf(p.s)[1].toLowerCase()}.`;
      if (scroll) evs.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      if (from) { const again = evb.querySelector(from.classList.contains("solid") ? ".movenav .btn.solid" : ".movenav .btn:not(.solid)"); if (again && !again.disabled) again.focus(); else evb.querySelector("#h-person").focus(); }
    }
    drawEvidence();

    // Where data and commentary part ways, and the research behind the debate.
    if (map.gap || Array.isArray(map.studies)) {
      const [gs, gb] = section("msec gapsec", "Where data and commentary part ways");
      if (map.gap) {
        const g = lead(map.gap); gb.append(el("h2", null, g.head));
        const paras = restParas(g.rest); if (paras.length) { const tw = el("div", "twocol"); paras.forEach(x => tw.append(el("p", null, x))); gb.append(tw); }
      }
      if (Array.isArray(map.studies)) {
        const box = el("div", "studies");
        box.append(el("h3", null, "The research behind the debate"));
        box.append(el("p", "snote", "Up to six of the most recent studies on this claim from the past nine months, newest first, including new ones no one on this map has cited yet. Each tag reflects what the study itself found, checked against the study’s own page, not how the people citing it describe it."));
        const list = el("div", "slist");
        if (!map.studies.length) list.append(el("p", "snone", "No studies from the past nine months turned up for this claim."));
        map.studies.forEach(st => {
          const [lab, fill] = STANCE[st.stance] || STANCE.mixed;
          const row = el("div", "srow");
          const tag = el("span", "stance"); const sw = el("span", "swatch"); sw.style.background = fill; sw.setAttribute("aria-hidden", "true"); tag.append(sw, document.createTextNode(lab));
          const mid = el("div", "smid"); const a = el("a", "stitle", st.title); a.href = st.url; a.target = "_blank"; a.rel = "noopener";
          mid.append(a, el("span", "smeta", [st.authors, st.org && st.org !== st.authors ? st.org : "", pubDate(st.date)].filter(Boolean).join(" · ")));
          if (st.finding) mid.append(el("p", null, st.finding));
          const cb = el("div", "scited"); cb.append(el("span", "lbl", "Cited by"), el("span", null, st.citedBy && st.citedBy.length ? st.citedBy.join("; ") : "No one on this map yet"));
          row.append(tag, mid, cb); list.append(row);
        });
        box.append(list); gb.append(box);
      }
      main.append(gs);
    } else if (map.lens || P.some(p => p.ev)) {
    // What views rest on (maps made before the labels above)
    const [vs, vb] = section("msec views", "What views rest on");
    if (map.lens) {
      const l = lead(map.lens); vb.append(el("h2", null, l.head));
      const paras = restParas(l.rest); if (paras.length) { const g = el("div", "twocol"); paras.forEach(t => g.append(el("p", null, t))); vb.append(g); }
    } else vb.append(el("h2", null, "What each view rests on"));
    const mw = el("div", "matrixwrap"), mx = el("div", "matrix");
    mx.setAttribute("role", "table"); mx.setAttribute("aria-label", "People by what their view rests on and where they stand");
    const head = el("div"); head.setAttribute("role", "row"); head.style.display = "contents";
    const h0 = el("span", "h", "What the view rests on"); h0.setAttribute("role", "columnheader"); head.append(h0);
    POS.forEach(([, label, fill]) => { const h = el("span", "h"); h.setAttribute("role", "columnheader"); const sw = el("span", "swatch"); sw.style.background = fill; sw.setAttribute("aria-hidden", "true"); h.append(sw, document.createTextNode(label)); head.append(h); });
    mx.append(head);
    EVT.forEach(([k, label]) => {
      const inRow = P.filter(p => p.ev === k); if (!inRow.length) return;
      const row = el("div"); row.setAttribute("role", "row"); row.style.display = "contents";
      const rh = el("span", "rowh", label); rh.setAttribute("role", "rowheader"); rh.append(el("span", null, plural(inRow.length, "person", "people"))); row.append(rh);
      POS.forEach(([s]) => { const cell = el("div", "cell"); cell.setAttribute("role", "cell"); inRow.filter(p => p.s === s).forEach(p => cell.append(chip(p))); row.append(cell); });
      mx.append(row);
    });
    mw.append(mx); mw.style.cssText = "flex: 1 1 100%; min-width: 0"; vs.append(mw);
    main.append(vs);
    }

    // The PDF: its own print-only layout (letter pages), built from the same data.
    // Page 1 has the claim, the finding, and the chart. Page 2 has what views rest on.
    // The evidence for every person follows from page 3.
    root.append(buildPdf());
    function buildPdf() {
      const doc = el("div", "pdfdoc"); doc.setAttribute("aria-hidden", "true");
      // The map's title in each page's footer, next to the page number.
      const foot = el("style"); foot.textContent = `@media print { @page { @bottom-left { content: "${String(map.title || "").toUpperCase().replace(/["\\]/g, "\\$&").replace(/[\r\n]+/g, " ")}"; } } }`; doc.append(foot);
      const runhead = (a, b) => { const h = el("div", "runhead"); h.append(el("span", null, a), el("span", null, b)); return h; };
      const eyebrow = t => el("span", "peb", t.toUpperCase());
      const block = (...kids) => { const d = el("div", "pblock"); d.append(...kids); return d; };
      const leaderMark = p => p.name + (p.co ? " ■" : "");

      // Page 1
      const p1 = el("section", "ppage first");
      p1.append(runhead("IDEA LANDSCAPE MAP · " + (partial ? "PARTIAL MAP" : "FINISHED MAP"), "RESEARCHED " + apDate(map.researched).toUpperCase()));
      if (partial) p1.append(el("p", "pnote", "Partial map." + partialText().replace(" Run again to research everyone.", "")));
      p1.append(block(eyebrow("The claim"), el("h1", null, map.claim)));
      if (map.finding) { const f = lead(map.finding); p1.append(block(eyebrow("The finding"), el("h2", null, f.head), el("p", null, f.rest.join(" ")))); }
      const grid = el("div", "pchart");
      const most = Math.max(1, ...POS.map(([s]) => P.filter(p => p.s === s).length));
      POS.forEach(([s, label, fill]) => {
        const people = P.filter(p => p.s === s);
        const col = el("div", "pcol"); col.append(el("span", "plabel", label));
        const area = el("div", "parea");
        const n = el("span", "pn", String(people.length)); n.append(el("span", "unit", people.length === 1 ? "person" : "people"));
        const bar = el("div", "pbar"); bar.style.cssText = `height:${people.length ? Math.max(24, Math.round(people.length / most * 110)) : 3}px;background:${fill}`;
        if (s >= 2 && s <= 4) bar.style.boxShadow = "inset 0 0 0 1px #0A0A0A";
        area.append(n, bar); col.append(area);
        const names = el("span", "pnames"); people.forEach((p, k) => { if (k) names.append(el("br")); names.append(document.createTextNode(leaderMark(p))); });
        if (!people.length) names.textContent = "No one in this sample";
        col.append(names); grid.append(col);
      });
      p1.append(block(eyebrow("Where each person stands"), grid,
        el("p", "pnote", "■ Industry leader. " + notes.join(" ") + (map.gap || Array.isArray(map.studies) ? " Where data and commentary part ways is on page 2" : " What each view rests on is on page 2") + ", and each person's quotes and sources follow from page 3."),
        el("p", "pnote", "This map is a snapshot of what people had said as of the research date, and their views can change. It was built with Claude, which can make mistakes, so check the linked sources before relying on a placement.")));
      doc.append(p1);

      // Page 2
      const p2 = el("section", "ppage");
      if (map.gap || Array.isArray(map.studies)) {
        p2.append(runhead("WHERE DATA AND COMMENTARY PART WAYS", "NEWEST STUDIES FIRST"));
        if (map.gap) { const g = lead(map.gap); p2.append(block(el("h2", null, g.head), el("p", null, g.rest.join(" ")))); }
        if (Array.isArray(map.studies)) {
          const sb = el("div", "pstudies");
          sb.append(el("h3", null, "The research behind the debate"), el("p", "pnote", "Up to six of the most recent studies on this claim from the past nine months. Each tag reflects what the study itself found, checked against its own page."));
          if (!map.studies.length) sb.append(el("p", "pnote", "No studies from the past nine months turned up for this claim."));
          map.studies.forEach(st => {
            const [lab, fill] = STANCE[st.stance] || STANCE.mixed;
            const r = el("div", "pstudy");
            const tg = el("span", "pstance"); const sw = el("span", "swatch"); sw.style.background = fill; tg.append(sw, document.createTextNode(lab.toUpperCase()));
            const a = el("a", "ptitle", st.title); a.href = st.url;
            const meta = [st.authors, st.org && st.org !== st.authors ? st.org : "", pubDate(st.date)].filter(Boolean).join(" · ");
            const body = el("div"); body.append(a, el("p", "psrc", meta));
            if (st.finding) body.append(el("p", null, st.finding));
            body.append(el("p", "psrc", "Cited by: " + (st.citedBy && st.citedBy.length ? st.citedBy.join("; ") : "no one on this map yet")));
            const u = el("a", "purl", st.url); u.href = st.url; const up = el("p"); up.append(u); body.append(up);
            r.append(tg, body); sb.append(r);
          });
          p2.append(sb);
        }
      } else {
      p2.append(runhead("WHAT VIEWS REST ON", "BY POSITION"));
      const l = lead(map.lens || "");
      p2.append(block(el("h2", null, l.head || "What each view rests on"), el("p", null, l.rest.join(" "))));
      const mt = el("div", "pmatrix");
      mt.append(el("span", "ph", "What the view rests on"));
      POS.forEach(([, label, fill], k) => { const h = el("span", "ph sw"); const sw = el("span", "swatch"); sw.style.background = fill; if (k >= 1 && k <= 3) sw.style.boxShadow = "inset 0 0 0 1px #0A0A0A"; h.append(sw, document.createTextNode(label === "Mixed or conditional" ? "Mixed" : label)); mt.append(h); });
      EVT.forEach(([k, label]) => {
        const inRow = P.filter(p => p.ev === k); if (!inRow.length) return;
        const rh = el("span", "prow", label); rh.append(el("br"), el("span", "pcount", plural(inRow.length, "person", "people"))); mt.append(rh);
        POS.forEach(([s]) => { const c = el("span", "pcell"); inRow.filter(p => p.s === s).forEach((p, j) => { if (j) c.append(el("br")); c.append(document.createTextNode(leaderMark(p))); }); mt.append(c); });
      });
      p2.append(mt, el("p", "pnote", "■ Industry leader. Each person is tagged by the evidence behind the quotes on this map. A person tagged with observation or anecdote may do data work elsewhere."));
      }
      doc.append(p2);

      // Page 3 on: the evidence
      const p3 = el("section", "ppage evid");
      p3.append(runhead("THE COMMENTARY", "IN ORDER OF POSITION"));
      p3.append(el("p", "pnote", "Quote checks: ✓ found word for word on the source page. ≈ close match, with small differences such as punctuation. ! the source page couldn't be opened, so the quote is unconfirmed."));
      POS.forEach(([s, label, fill]) => {
        const people = P.filter(p => p.s === s); if (!people.length) return;
        const gh = el("h2", "pgroup", `${label.toUpperCase()} · ${people.length}`); gh.style.background = fill; if (s === 5) gh.style.color = "#FFFFFF";
        p3.append(gh);
        people.forEach(p => {
          const sec = el("section", "pperson");
          const nm = el("div", "pname"); nm.append(el("h3", null, p.name), el("span", null, (p.who || p.co ? [p.role] : [p.role, typeOf(p)]).filter(Boolean).join(" · "))); sec.append(nm);
          p.q.forEach(([text, title, outlet, date, url, note, check, kind]) => {
            const bq = el("blockquote", check === "unreachable" ? "unconf" : null);
            bq.append(el("p", "pq", "“" + text + "”"));
            const tag = kind === "data" ? " Cites data or a study." : kind === "view" ? " View or forecast." : "";
            bq.append(el("p", "psrc", `${CHECK[check] ? CHECK[check][0] + " " : ""}${[outlet, date].filter(Boolean).join(", ")}: “${title}.”${note ? " " + note : ""}${tag}`));
            const u = el("a", "purl", url); u.href = url; const up = el("p"); up.append(u); bq.append(up);
            sec.append(bq);
          });
          const dl = el("dl");
          const row = (k, v) => { if (!v) return; dl.append(el("dt", null, k)); const dd = el("dd"); if (typeof v === "string") dd.textContent = v; else dd.append(v); dl.append(dd); };
          if (p.who || p.co) row("Who they are", typeOf(p) + "." + (p.whoNote ? " " + p.whoNote : ""));
          row("Why this placement", p.why);
          const kinds = kindsOf(p), nd = kinds.filter(k => k === "data").length;
          if (kinds.length) row("What these quotes rest on", (nd ? `${cap(num(nd))} of ${num(kinds.length)} quotes ${nd === 1 ? "cites" : "cite"} data or a study.` : (kinds.length === 2 ? "Neither quote cites data or a study." : "None of these quotes cite data or a study.")) + (p.dataNote ? " " + p.dataNote : ""));
          else row("What this view rests on", p.ev ? EVLABEL[p.ev] + "." + (p.evn ? " " + p.evn : "") : "");
          row("Caveats", p.caveat);
          row("How the view changed", p.shift);
          row("Business interests", p.co ? p.interest : "");
          if (p.bio) { const b = el("a", "purl", p.bio); b.href = p.bio; row("Bio", b); }
          if (Array.isArray(p.pubs) && p.pubs.length) {
            const box = el("div"); const ol = el("ol");
            p.pubs.slice(0, 3).forEach(w => { const li = el("li"); const a = el("a", null, w.title); a.href = w.url; li.append(a); const meta = [w.outlet, pubDate(w.date)].filter(Boolean).join(", "); if (meta) li.append(document.createTextNode(", " + meta)); ol.append(li); });
            box.append(ol); if (p.pubsFrom === "openalex") box.append(el("span", "pcount", "From OpenAlex, an open index of research."));
            row(p.co ? "Latest writing and talks" : "Latest work", box);
          }
          sec.append(dl); p3.append(sec);
        });
      });
      doc.append(p3);
      return doc;
    }

    // Method
    const ft = el("footer", "method"); ft.id = "method";
    ft.append(el("span", "eyebrow", "Method"));
    const fb = el("div", "body");
    const para = t => { const p = el("p"); if (typeof t === "string") p.textContent = t; else p.append(...t); fb.append(p); };
    para("Placements are a starting point for discussion. Select any name to see the quotes behind the call, the caveats, and, for industry leaders, the business interests to weigh.");
    para("Claude researched each person through web searches and opened the source pages. The server then reopened each page and checked every quote against it word for word. Quotes it couldn’t find on the page were removed.");
    para("Quote checks: ✓ found word for word on the source page. ≈ close match, with small differences such as punctuation or spacing. ! the source page couldn't be opened, so the quote is unconfirmed.");
    (map.notes || []).filter(n => !/^Research used/.test(n) && !/share an entr/.test(n) && !(dropped && /^Left off the map/.test(n))).forEach(n => para(n));
    if (map.usage) {
      const u = map.usage, tokens = (u.i || 0) + (u.o || 0);
      const a = el("a", null, "See what it cost on your Anthropic usage page"); a.href = "https://console.anthropic.com/usage"; a.target = "_blank"; a.rel = "noopener";
      para([document.createTextNode(`Cost: ${map.usageAll ? "this map" : "the research for this map"} used ${plural(u.s || 0, "web search", "web searches")} and ${plural(u.f || 0, "page read", "page reads")}` + (tokens ? `, about ${tokens >= 1e6 ? (tokens / 1e6).toFixed(1) + " million" : Math.round(tokens / 1000) + ",000"} tokens${map.usageAll ? ", counting every step of making it" : ""}. ` : ". ")), a, document.createTextNode(".")]);
    }
    if (hasKinds) para("Each person is labeled by who they are, judged from their bio and body of work. Each quote is tagged as citing data or a study, or as a view or forecast.");
    if (Array.isArray(map.studies)) para("The research behind the debate lists up to six studies from the past nine months, found by web search. Each is tagged by what it found, read from the study's own page, and each link was checked to make sure it opens.");
    if (P.some(x => x.bio || (x.pubs && x.pubs.length))) para("Bio and latest-work links were found by web search, and each one was checked to make sure it opens. Academics' latest papers come from OpenAlex, an open index of research, matched by name and institution.");
    para("Run again researches the same claim and people as a new map, so you can see whether views have changed. It uses a new research budget. Delete removes the map for good.");
    ft.append(fb);
    root.append(ft);
  }

  window.LandscapeMap = { render, POS, EVT };
})();
