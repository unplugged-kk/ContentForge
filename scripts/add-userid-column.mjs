// scripts/add-userid-column.mjs
// One-shot script: add a nullable userId integer column to every per-user
// table in shared/schema.ts. Skips:
//   - users              (IS the users table)
//   - user_profile       (already has userId NOT NULL)
//   - audit_logs         (already has nullable userId)
//   - discovery_settings (appears to be a single-row config table — userId
//                         decision deferred to a later migration)
//
// Usage: node scripts/add-userid-column.mjs
// Verify: git diff shared/schema.ts | head -100

import { readFileSync, writeFileSync } from "node:fs";

const TABLES = [
  "pillars",
  "posts",
  "tweets",
  "ideas",
  "templates",
  "analytics",
  "aiUsageLog",
  "conversations",
  "messages",
  "articles",
  "references",
  "styleProfiles",
  "referenceContent",
  "referencePosts",
  "discoveredIdeas",
  "viralScores",
  "monitoredAccounts",
  "rssSources",
  "generatedImages",
  "connectedAccounts",
  "contextVault",
  "carousels",
  "cannedResponses",
  "youtubeChannels",
];

const file = "shared/schema.ts";
let content = readFileSync(file, "utf8");
let applied = 0;
let skipped = 0;

for (const name of TABLES) {
  const exportPattern = `export const ${name} = pgTable(`;
  const exportIdx = content.indexOf(exportPattern);
  if (exportIdx === -1) {
    console.error(`[skip] ${name}: export not found`);
    skipped++;
    continue;
  }

  // Find the closing brace of this table's object.
  const tableEndIdx = content.indexOf("\n});", exportIdx);
  if (tableEndIdx === -1) {
    console.error(`[skip] ${name}: table closing not found`);
    skipped++;
    continue;
  }
  const tableBody = content.slice(exportIdx, tableEndIdx);

  if (/\buserId\s*:/.test(tableBody)) {
    console.error(`[skip] ${name}: already has userId`);
    skipped++;
    continue;
  }

  // Find the id line within this table.
  const idLinePattern = `id: serial("id").primaryKey(),`;
  const idLineIdx = content.indexOf(idLinePattern, exportIdx);
  if (idLineIdx === -1 || idLineIdx > tableEndIdx) {
    console.error(`[skip] ${name}: id line not found in table body`);
    skipped++;
    continue;
  }

  // Insert userId right after the id line's terminating newline.
  const insertAt = content.indexOf("\n", idLineIdx) + 1;
  content =
    content.slice(0, insertAt) +
    `  userId: integer("user_id"),\n` +
    content.slice(insertAt);
  applied++;
}

writeFileSync(file, content);
console.log(`Applied: ${applied}, Skipped: ${skipped}`);
