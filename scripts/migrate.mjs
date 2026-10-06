/* Schema aanleggen of bijwerken. Idempotent: alles is "if not exists", dus
 * nog een keer draaien kan geen kwaad. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, dbKind, execFile } from "../server/db.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const sql = await readFile(path.join(ROOT, "server", "schema.sql"), "utf8");
await db();
await execFile(sql);
console.log(`Schema bijgewerkt (${dbKind()}).`);
process.exit(0);
