# Beyond the Hot Take

*An idea landscape map.*

Researched maps of where academics, writers, and industry leaders stand on specific policy claims. Each placement rests on verbatim quotes checked against the source page.

The web app (`public/`, `src/`) lets you type a statement, answer clarifying questions, pick who to research, and get a new map. It runs on Cloudflare Workers and uses your own Anthropic API key, so each person who runs a copy pays for their own research.

## How the app works

1. **Statement.** You type an idea. Claude points out what is vague and asks up to four clarifying questions.
2. **Claim.** Claude writes three versions of the claim from your answers. You pick or edit one and name the map.
3. **People.** Claude searches the web and proposes about 8 academics, writers, and thought leaders and 4 industry leaders. You remove or add names, up to 12 people per map to keep costs down.
4. **Research.** The server sends groups of three people to Claude with web search and page reading turned on. Claude returns placements, quotes, and sources.
5. **Quote check.** The server reopens every source page and confirms each quote word for word. Quotes it can't find are removed. Quotes from pages it can't open are kept and marked.
6. **Map.** Claude writes the summary, and the map is saved. Your saved maps are listed on the home page.

While research runs, the page shows how much of the map's spending budget is used, and **Stop and build with what's done** ends the remaining groups so they don't cost anything more.

Each person is labeled by who they are (researcher with original data, policy researcher, journalist or writer, labor or advocacy, or industry leader), judged from their bio, and the chart groups people that way. Each quote is tagged as citing data or a study, or as a view or forecast; the two small squares on each name show these tags. "Where data and commentary part ways" compares how often each side cites data, and "The research behind the debate" lists up to six studies from the past nine months, each tagged by what it found (supports, cuts against, or mixed), read from the study's own page. Maps made before these labels get them once, the next time they're opened.

Each person's card also links to their bio and their three latest pieces of work. For academics, the papers come from [OpenAlex](https://openalex.org), a free index of research. For everyone else, Claude finds their latest writing or talks with a web search, and the server checks that each link opens. OpenAlex allows only a few lookups a day without a key, so get a free key at openalex.org/settings/api and add it with `npx wrangler secret put OPENALEX_API_KEY`.

Research is saved after each group. If a map stops early (out of credits, over budget, or the tab was closed), it shows as **Paused** at the top of Your maps. Open it to continue the remaining groups with a new research budget, build the map from what's done, or discard it.

On a finished map:

- Select any name in the chart to see that person's quotes, sources, quote checks, and caveats.
- **Download PDF** opens the browser's print dialog. Choose **Save as PDF**. The PDF includes everyone's evidence.
- **Run again** starts a new map with the same claim and people, so you can see whether views have changed. It uses a new research budget.
- **Delete map** removes it for good.

The site follows your computer's light or dark setting.

Limits: each map stops when it reaches its research budget (`RUN_TOKEN_BUDGET` in `wrangler.toml`), and makes at most 12 research calls.

## Files

| File | What it does |
| --- | --- |
| `public/index.html`, `public/app.js` | The step-by-step page |
| `public/map.html`, `public/map.js` | Shows a saved map |
| `public/styles.css` | Shared styles |
| `src/worker.js` | The server: Claude calls, quote checking, research budget, saved maps, sign-in check |
| `src/prompts.js` | Every prompt and the writing rules |
| `wrangler.toml` | Cloudflare settings |

## Setup

You need [Node.js](https://nodejs.org) 20 or newer, a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, and an [Anthropic API](https://console.anthropic.com) account with credits.

1. **Install.** In this folder, run `npm install`.
2. **Settings file.** Copy `wrangler.example.toml` to a new file named `wrangler.toml`. Your copy holds your own Cloudflare details and is ignored by git, so it never goes in the repository.
3. **API key.** In the Anthropic Console, create an API key. Set a monthly spending limit while you're there.
4. **Sign in to Cloudflare.** Run `npx wrangler login`.
5. **Storage.** Run `npx wrangler kv namespace create MAPS` and paste the `id` it prints into `wrangler.toml`.
6. **Secret.** Run `npx wrangler secret put ANTHROPIC_API_KEY` and paste your key. It is stored by Cloudflare and never goes in this repository.
7. **Deploy.** Run `npx wrangler deploy`. It prints your app's address, ending in `workers.dev`.
8. **Lock it to you.** The server refuses every request until this step is done.
   - In the Cloudflare dashboard, open **Zero Trust**, then **Access**, then **Applications**, and add a **Self-hosted** application for your `workers.dev` address.
   - Add a policy that allows only your email address.
   - Copy the application's **Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.toml`, and your team domain (like `yourteam.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.
   - Run `npx wrangler deploy` again.

To change the model or the research budget per map, edit `MODEL` or `RUN_TOKEN_BUDGET` in `wrangler.toml` and deploy again.

## Testing on your computer

Copy `.dev.vars.example` to `.dev.vars`, put your API key in it, and run `npm run dev`. The app opens at `http://localhost:8787` with sign-in turned off. `.dev.vars` is ignored by git.

## Costs and limits to know

- Each map runs dozens of web searches and page reads on your Anthropic account. Check the usage line at the bottom of each map and your Anthropic Console to see what a map costs.
- New Anthropic accounts have low rate limits. The server waits and retries when it hits one, so a map may take longer.
- Cloudflare's free Workers plan caps processing time per request. If quote checks fail on long pages, the paid Workers plan raises that cap.

## Writing rules

- AP style, with American spelling and no accents in our own copy (for example, "resume").
- Quotes, source titles, and outlet names stay exactly as published.
- Oxford comma, active voice, plain words. No em dashes in our own copy.

## License

Copyright (C) 2026 Christelle Prophete.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. The full text is in [LICENSE](LICENSE).

In plain terms: anyone can use, change, and share this code, including for paid work. If you change it and let people use your version over a network, such as a website, you must offer those users the full source code of your version under the same license.

For a license on other terms, such as using this code in a closed product, contact the copyright holder.

Maps made with this tool, and the quotes in them, are not covered by this license. Quotes belong to their authors and publishers.

Icons by [Streamline](https://www.streamlinehq.com), used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Contributing

Contributions are welcome. So the project can keep offering other license terms, contributors will be asked to sign a short contributor agreement before a change is merged.
