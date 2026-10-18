// One-time fix: saved maps written before the wording change say "company leader(s)".
// This rewrites that wording to "industry leader(s)" in every saved map's summary and notes.
// Run from the project folder:  node scripts/rename-company-leaders.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrangler = (...args) => execFileSync("npx", ["wrangler", "kv", "key", ...args, "--binding", "MAPS", "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const swap = s => typeof s === "string" ? s.replace(/\bCompany leader/g, "Industry leader").replace(/\bcompany leader/g, "industry leader") : s;

const keys = JSON.parse(wrangler("list", "--prefix", "map:")).map(k => k.name);
console.log(`Found ${keys.length} saved map${keys.length === 1 ? "" : "s"}.`);
for (const key of keys) {
  const map = JSON.parse(wrangler("get", key));
  const before = JSON.stringify(map);
  map.finding = swap(map.finding);
  map.lens = swap(map.lens);
  if (Array.isArray(map.notes)) map.notes = map.notes.map(swap);
  if (JSON.stringify(map) === before) { console.log(`${key}: nothing to change.`); continue; }
  const file = join(tmpdir(), "ilm-map.json");
  writeFileSync(file, JSON.stringify(map));
  wrangler("put", key, "--path", file);
  unlinkSync(file);
  console.log(`${key}: updated.`);
}
console.log("Done.");
