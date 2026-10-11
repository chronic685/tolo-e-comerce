// Copies openapi.json from the new API repo (chronic685/tolo-marketplace-api, branch main) into this package, then run `npm run generate`.
// Usage: npm run sync -w @tolo/api-client            (downloads from GitHub)
//        npm run sync -w @tolo/api-client -- ../tolo-marketplace-api/openapi.json   (a local copy)
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
const source = process.argv[2];
if (source) {
  copyFileSync(resolve(source), target);
} else {
  const response = await fetch("https://raw.githubusercontent.com/chronic685/tolo-marketplace-api/main/openapi.json");
  if (!response.ok) throw new Error(`Could not download openapi.json: HTTP ${response.status}`);
  writeFileSync(target, await response.text());
}
console.log(`Wrote ${target}. Now run: npm run generate -w @tolo/api-client`);
