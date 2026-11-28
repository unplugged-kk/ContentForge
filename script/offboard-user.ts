import { offboardUser } from "../server/user/offboard";

function parseArgs(argv: string[]): { userId: number; confirm: boolean } {
  let rawUserId: string | undefined;
  let confirm = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--confirm") {
      confirm = true;
    } else if (arg === "--dry-run") {
      confirm = false;
    } else if (arg.startsWith("--user-id=")) {
      rawUserId = arg.slice("--user-id=".length);
    } else if (arg === "--user-id") {
      rawUserId = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!rawUserId) {
    throw new Error("Missing required --user-id=<id> argument");
  }
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`Invalid --user-id value: ${rawUserId}`);
  }
  return { userId, confirm };
}

async function main() {
  let parsed: { userId: number; confirm: boolean };
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Usage: tsx script/offboard-user.ts --user-id=<id> [--dry-run | --confirm]");
    process.exit(1);
  }

  const { db, pool } = await import("../server/db");
  try {
    const result = await offboardUser(db, parsed.userId, { dryRun: !parsed.confirm });
    console.log(JSON.stringify(result, null, 2));
    if (!result.found) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

void main();
