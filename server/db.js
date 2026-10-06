/* Databaseverbinding.
 *
 * Lokaal draait PGlite: Postgres gecompileerd naar WebAssembly, in hetzelfde
 * proces. Dat is dezelfde database-engine als op de server, dus het schema en
 * de queries die hier werken werken daar ook — geen SQLite-achtige verschillen
 * die pas bij de verhuizing boven water komen.
 *
 * Staat DATABASE_URL in de omgeving, dan verbindt hij met een echte Postgres.
 * Dat is het enige verschil tussen deze laptop en Hetzner.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Gitignored: hier staan de lokale ontwikkelgegevens.
const LOCAL_DIR = process.env.PGLITE_DIR || path.join(ROOT, "data", "pgdata");

let client = null;
let kind = null;

export async function db() {
  if (client) return client;
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    client = {
      query: (text, params) => pool.query(text, params),
      // Meerdere statements achter elkaar — alleen voor het schema.
      exec: (text) => pool.query(text),
      close: () => pool.end(),
    };
    kind = "postgres";
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    // PGlite maakt zelf geen bovenliggende mappen aan.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(LOCAL_DIR), { recursive: true });
    const lite = await PGlite.create(LOCAL_DIR);
    client = {
      query: (text, params) => lite.query(text, params),
      // query() van PGlite neemt één statement; exec() een heel bestand.
      exec: (text) => lite.exec(text),
      close: () => lite.close(),
    };
    kind = "pglite";
  }
  return client;
}

export function dbKind() {
  return kind;
}

/** Eén rij of null. */
export async function one(text, params) {
  const res = await (await db()).query(text, params);
  return res.rows[0] || null;
}

/** Alle rijen. */
export async function all(text, params) {
  const res = await (await db()).query(text, params);
  return res.rows;
}

/** Uitvoeren zonder resultaat te gebruiken. */
export async function run(text, params) {
  return (await db()).query(text, params);
}

/** Een heel sql-bestand met meerdere statements. */
export async function execFile(text) {
  return (await db()).exec(text);
}

/* Alles-of-niets. Een patiënt aanmaken zet ook zijn checklistpunten neer; gaat
 * dat tweede mis, dan mag de patiënt er ook niet staan. */
export async function tx(fn) {
  const c = await db();
  await c.query("begin");
  try {
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (err) {
    await c.query("rollback");
    throw err;
  }
}

/* De zakelijke datum van vandaag in de tijdzone van de Pflegedienst. Nooit
 * now()::date kaal gebruiken: de server draait straks op UTC en dan rolt de dag
 * om 02:00 lokale tijd om. */
export const TZ = process.env.SITE_TZ || "Europe/Berlin";
export async function today() {
  const row = await one(`select (now() at time zone $1)::date as d`, [TZ]);
  return typeof row.d === "string" ? row.d : row.d.toISOString().slice(0, 10);
}
