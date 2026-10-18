// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Christelle Prophete. See LICENSE.
// All prompts live on the server so the page can only run these steps.

export const STYLE_RULES = `Writing rules for any copy you write (never apply them to quotes, source titles, or outlet names, which stay exactly as published):
- AP style: "U.S.", lowercase titles after a name ("Professor of economics, MIT"), months spelled out with a year alone ("March 2026"), abbreviated with a day ("Oct. 16, 2026"), % with numerals, numerals for 10 and up.
- American spelling with no accents in our own words (write "resume", not "résumé").
- Oxford comma, active voice, plain words.
- Spell out acronyms on first use, except ones AP allows on first reference (AI, CEO, MIT).
- No em dashes. No "not just X, it's Y" or "not X, but Y" constructions. No colon-reveal sentences.
- Refer to where someone stands only by its category name (disagrees, leans disagree, mixed or conditional, leans agree, agrees), never by a number such as "position 4" or "a 2".
- Never write in the first person ("I", "me", "my", "we"). Readers see this text on the map, so describe the research neutrally: "the sources reviewed", "the linked page", "the page was cut off before the closing section".`;

export const EVIDENCE_TYPES = [
  ["data_private", "Own analysis of private or proprietary data"],
  ["data_public", "Own analysis of public data"],
  ["review", "Review of other people’s research"],
  ["org", "Own organization’s experience"],
  ["observation", "Observation, anecdote, or forecast"]
];

const today = () => new Date().toISOString().slice(0, 10);

// Who someone is, judged from their bio and body of work, not from the quotes on one map.
export const WHO_GROUPS = [
  ["res", "Researcher with original data", "academics, economists, and analysts who build and analyze their own datasets"],
  ["pol", "Policy researcher", "analysts at think tanks, policy labs, and research nonprofits"],
  ["wri", "Journalist or writer", "reporters, columnists, authors, and newsletter writers"],
  ["lab", "Labor or advocacy", "union leaders, worker advocates, and civil society groups"],
  ["ind", "Industry leader", "executives, founders, investors, and employees at companies, including company economists, researchers, and engineers"]
];
const WHO_LIST = WHO_GROUPS.map(([k, l, d]) => `${k} = ${l.toLowerCase()} (${d})`).join("; ");

export function sharpenPrompt(statement) {
  return `Today is ${today()}. A user wants to map where academics, writers, and industry leaders stand on an idea. They typed:

"""${statement}"""

A good map needs a claim people can agree or disagree with, with a clear scope, time frame, and direction. Decide what is vague or missing, then write up to four clarifying questions that would most change the claim. Each question gets two to four short answer options; put the option you would recommend first. Also write your best draft of the claim as it stands.

${STYLE_RULES}

Reply with only JSON, no other text:
{"assessment": "one or two sentences on what is vague or missing", "draft_claim": "...", "questions": [{"id": "q1", "question": "...", "options": ["...", "..."]}]}`;
}

export function refinePrompt(statement, answers) {
  const lines = answers.map(a => `- ${a.question}\n  Answer: ${a.answer}`).join("\n");
  return `Today is ${today()}. A user wants to map where academics, writers, and industry leaders stand on a claim. Their original statement:

"""${statement}"""

Their answers to clarifying questions:
${lines}

Write three versions of the claim that reflect these answers. Each must be one sentence that a person can agree or disagree with, with scope and time frame where they matter. Order them from most to least recommended. Also give a short page name for the map (two to four words, like "Early-Career AI Landscape").

${STYLE_RULES}

Reply with only JSON, no other text:
{"claims": ["...", "...", "..."], "title": "..."}`;
}

export function candidatesPrompt(claim) {
  return `Today is ${today()}. I'm building a research map of where people stand on this claim: "${claim}"

Propose who to research. Pick the key voices in this field: the people others in the debate cite, respond to, and argue with.
- About 8 academics, writers, and thought leaders: leading economists and researchers, think tank and policy scholars, journalists and authors who cover the topic closely, and widely followed commentators. Favor people with substantial, recent public work on this specific question over famous names who have only touched on it.
- About 4 industry leaders: people who work at the companies involved and have spoken publicly and substantively on it. Mix CEOs, founders, and senior executives with people who do the work inside those companies, such as company economists, researchers, policy leads, engineers, and other employees. People who are both go with industry leaders.
- No more than 12 people in all. Research costs grow with each person, so choose the most important voices.
- Use web search to check who is active in this debate now: recent papers, books, op-eds, testimony, reports, and interviews from the last two years. Don't rely only on what you already know.
- Choose people so the list spans the range of views. Include the most prominent skeptics and the most prominent believers.
- Out of scope: elected officials, government staff, and anyone's private or inferred information.
- Co-authors of one defining paper can share an entry; write the name as "First Person and Second Person".
- For each person, "why" names their key work or role in this debate (for example, "Author of the 2025 Stanford payroll study").

${STYLE_RULES}

When you're done searching, reply with only JSON, no other text:
{"academics": [{"name": "...", "role": "...", "why": "one short phrase on why they belong"}], "leaders": [{"name": "...", "role": "...", "why": "..."}]}`;
}

export function researchPrompt(claim, people) {
  const names = people.map(p => p.leader == null
    ? `${p.name}${p.role ? `, ${p.role}` : ""} (group not set; the note after the name is their organization or affiliation)`
    : `${p.name}${p.leader ? " (industry leader)" : ""}`).join("; ");
  const unsorted = people.some(p => p.leader == null);
  return `Today is ${today()}. I'm building a research map of where people stand on this claim: "${claim}"

Research these people: ${names}.
${unsorted ? `\nFor anyone marked "group not set", decide the group yourself: set "leader" to true if they mainly work at or run a company (an executive, founder, investor, or employee), and false if they're mainly an academic, writer, or thought leader.\n` : ""}
For EACH person:
1. Use web search and FETCH the actual source pages with the web fetch tool (search snippets alone don't count). Prefer their own words: papers, books, essays, op-eds, newsletters, testimony, shareholder letters, memos, or interviews where they're quoted directly. Prefer the last two years; use older work only when it's their defining statement.
2. Pull 2 short quotes (1 to 2 sentences each) that are VERBATIM from a page you fetched, character for character. If you can't confirm a quote word for word on a page you opened, don't use it. Never add ellipses or join separate passages. You may drop a trailing comma from a quote that ends mid-sentence.
3. Place them on this scale: 1 = disagrees, 2 = leans disagree, 3 = mixed or conditional, 4 = leans agree, 5 = agrees. Read the claim's specifics carefully, including any time frame, scope, or words like "already" or "net". Someone who predicts something but says it isn't happening yet does not agree with a present-tense claim.
4. Say who they are, judged from their bio and body of work, not from these two quotes. "who" is one of: ${WHO_LIST}. Use ind for every industry leader. "who_note" is one sentence on their work, such as the research they lead or what they cover.
5. Tag each quote. "kind" is "data" if the quote itself points to data, a number, or a study, and "view" if it states a view, an experience, or a forecast. "data_note" is one sentence naming the data or study their quotes cite, using its name when the source gives it, or null if neither quote cites data.
6. Note whether their view has changed over time; place them on their most recent view.
7. For industry leaders only, one sentence on business interests that could shape what they say.
8. Note on any quote that comes from a secondhand report, a repost, an automatic transcript, or a copy of a page you couldn't open.

${STYLE_RULES}

When you are done researching, end your reply with the results inside <json></json> tags, as a JSON array with one object per person:
<json>[{"name": "...", "role": "current role in AP style", "leader": false, "position": 1, "confidence": "high|medium|low", "why": "one sentence on why this placement", "caveat": "one sentence on conditions or caveats they attach", "shift": "one sentence on how their view changed, or null", "interest": "industry leaders only, else null", "who": "res", "who_note": "one sentence", "data_note": "one sentence, or null", "quotes": [{"text": "verbatim quote", "kind": "data", "title": "source title", "outlet": "outlet", "date": "YYYY-MM", "url": "exact URL you fetched", "note": "secondhand or transcript note, or null"}]}]</json>

If you can't verify someone, include {"name": "...", "unverified": true, "reason": "..."} instead of guessing.`;
}

export function summaryPrompt(claim, people) {
  const POS_LABEL = ["disagrees", "leans disagree", "mixed or conditional", "leans agree", "agrees"];
  const WHO = Object.fromEntries(WHO_GROUPS.map(([k, l]) => [k, l.toLowerCase()]));
  const rows = people.map(p => `${p.name} | ${WHO[p.who] || (p.leader ? "industry leader" : "academic or writer")} | ${POS_LABEL[p.position - 1] || "unplaced"} | ${p.quotes ? `${p.data} of ${p.quotes} quotes cite data or a study` : "quotes not tagged"} | ${p.why}`).join("\n");
  return `I researched where people stand on this claim: "${claim}"

Each line: name | who they are | where they stand | how many of their quotes cite data or a study | why placed there
${rows}

Write two short summaries for the map page:
1. "finding": the key finding. Lead with one bold sentence stating the main pattern, then two or three sentences on how the groups (researchers, policy researchers, journalists and writers, labor and advocacy, industry leaders) compare. Use counts that match the list exactly.
2. "gap": where data and commentary part ways. Lead with one bold sentence comparing how often people on each side of the claim cite data or a study, and which groups cite data most and least. Then two or three sentences with exact counts of quotes. If there's no real difference, say so plainly in the bold sentence. Don't claim a pattern the list doesn't support.

Mark the bold sentence with <b></b>. Keep each bold sentence under 25 words, since it's shown as a headline.
Readers never see the list behind this. Name where people stand with the category names above (disagrees, leans disagree, mixed or conditional, leans agree, agrees). Say "people" or name them, never "rows" or "entries".
${STYLE_RULES}

Reply with only JSON, no other text:
{"finding": "<b>...</b> ...", "gap": "<b>...</b> ..."}`;
}

// The most recent studies on the claim, for "The research behind the debate".
export function studiesPrompt(claim, since, people) {
  const cites = people.filter(p => p.data_note).map(p => `- ${p.name}: ${p.data_note}`).join("\n") || "- (No one's quotes named a study.)";
  return `Today is ${today()}. Find up to six of the most recent studies on this claim: "${claim}"

Only include studies published in ${since} or later (the past nine months). A study here means a research report, working paper, journal article, or data analysis from a university, research group, government agency, or company research team. News articles and opinion pieces don't count.

1. Use web search to find them. Then open each study's own page (the paper, the report, or its official summary) with the web fetch tool.
2. "stance": what the study itself found, read from its own page, not from how other people describe it. Use "supports" if its findings back the claim, "against" if they cut against it, and "mixed" if they point both ways or only partly apply.
3. "finding": one sentence on what it measured and found.
4. If there's a newer version of a study (a published paper after a working paper), use the newest version and its date.
5. "cited_by": names from this list whose quotes cite that study, spelled exactly as listed, or [] if none.
${cites}

Put U.S. studies first. Deprioritize international reports, such as those from the OECD, IMF, World Bank, or International Labour Organization, and studies of other countries. Include one only when the claim is about another country or the world, or when no U.S. study covers that part of the claim.

Fewer than six is fine. Don't add older studies to fill the list. Use only URLs you opened or saw in search results, and never guess a URL.

${STYLE_RULES}

Reply with only JSON, no other text, newest first:
[{"title": "...", "authors": "names, or the organization", "org": "university or organization", "date": "YYYY-MM", "url": "https://...", "stance": "supports", "finding": "...", "cited_by": []}]`;
}

// For maps made before these labels: who each person is, and what each quote rests on.
export function relabelPrompt(claim, people) {
  const list = people.map(p => `- ${p.name}${p.role ? ` (${p.role})` : ""}${p.leader ? ", industry leader" : ""}\n${p.quotes.map((q, k) => `  Quote ${k + 1}: "${q}"`).join("\n")}`).join("\n");
  return `Today is ${today()}. These people were researched for a map on this claim: "${claim}"

${list}

For each person:
1. "who": who they are, judged from their bio and body of work, not from these quotes. One of: ${WHO_LIST}. Use ind for every industry leader. Use web search if you're not sure.
2. "who_note": one sentence on their work, such as the research they lead or what they cover.
3. "kinds": one tag per quote, in order. "data" if the quote itself points to data, a number, or a study, and "view" if it states a view, an experience, or a forecast.
4. "data_note": one sentence naming the data or study their quotes cite, or null if none do.

${STYLE_RULES}

Reply with only JSON, no other text:
[{"name": "exactly as given", "who": "res", "who_note": "...", "kinds": ["data", "view"], "data_note": null}]`;
}

// Rewrites short pieces of map text written before the current writing rules.
export function tidyPrompt(items) {
  return `Rewrite each numbered line below so it follows the writing rules. Keep the meaning, facts, names, and numbers of people the same, and keep each line about as long. Change only what the rules require. Never change words inside quotation marks.

${items.map((s, k) => `${k + 1}. ${s}`).join("\n")}

${STYLE_RULES}

Reply with only JSON, no other text: a list of ${items.length} strings in the same order.`;
}

// Bio links and latest work for each person's card. Web search only, so it stays cheap.
export function profilesPrompt(people) {
  const list = people.map(p => `- ${p.name}${p.role ? ` (${p.role})` : ""}${p.leader ? ", industry leader" : ""}`).join("\n");
  return `Today is ${today()}. For each person below, use web search to find links for a profile card on a research map.

${list}

For each person:
1. "bio_url": their official bio or profile page. Prefer, in order: a university or employer profile page, their personal website, then their Wikipedia page. Use a URL that appeared in your search results. Use null if you can't find one.
2. "academic": true if they publish research papers (professors and researchers), false otherwise.
3. "institution": the university or organization they're with now, or null.
4. "recent": their 3 latest pieces of work in their own words, newest first. For industry leaders, use op-eds, essays, shareholder letters, company memos, testimony, or major talks and interviews. For writers and journalists, use their latest articles, books, or newsletters. For academics, leave this as [] because their papers are looked up separately, unless the entry names two people, in which case list their latest work together or separately. Use only URLs that appeared in your search results, and never guess a URL. If you find fewer than 3, list what you found.

${STYLE_RULES}

Reply with only JSON, no other text:
[{"name": "exactly as given", "bio_url": "https://...", "academic": true, "institution": "...", "recent": [{"title": "...", "outlet": "...", "date": "YYYY-MM", "url": "https://..."}]}]`;
}
