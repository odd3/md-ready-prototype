/* Wachtwoorden, sessies en de rem op herhaald proberen. */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(path.join(tmpdir(), "mdready-auth-"));
process.env.PGLITE_DIR = path.join(dir, "pgdata");
delete process.env.DATABASE_URL;

const { db, execFile, one, run } = await import("../server/db.js");
const auth = await import("../server/auth.js");

before(async () => {
  await db();
  await execFile(await readFile(path.join(ROOT, "server", "schema.sql"), "utf8"));
  await run(`insert into app_user (id, name, initials, password_hash) values (1, 'Nasrat', 'NA', $1)`, [
    await auth.hashPassword("geheim-wachtwoord"),
  ]);
  await run(`insert into app_user (id, name, initials, password_hash) values (2, 'Michael', 'MI', null)`);
  await run(`insert into app_user (id, name, initials, password_hash, active) values (3, 'Oud', 'OU', $1, false)`, [
    await auth.hashPassword("geheim-wachtwoord"),
  ]);
});

after(async () => {
  await (await db()).close();
  rmSync(dir, { recursive: true, force: true });
});

test("het wachtwoord staat niet leesbaar in de database", async () => {
  const row = await one(`select password_hash from app_user where name = 'Nasrat'`);
  assert.ok(!row.password_hash.includes("geheim-wachtwoord"));
  assert.match(row.password_hash, /^scrypt\$16384\$8\$1\$/);
});

test("twee keer hetzelfde wachtwoord geeft twee verschillende hashes", async () => {
  // Elk met zijn eigen zout, anders zie je aan de database wie hetzelfde
  // wachtwoord gebruikt.
  const a = await auth.hashPassword("hetzelfde123");
  const b = await auth.hashPassword("hetzelfde123");
  assert.notEqual(a, b);
  assert.ok(await auth.verifyPassword("hetzelfde123", a));
  assert.ok(await auth.verifyPassword("hetzelfde123", b));
});

test("te korte wachtwoorden worden geweigerd", async () => {
  await assert.rejects(() => auth.hashPassword("kort"), /mindestens 8/);
});

test("inloggen met het juiste wachtwoord geeft een sessie", async () => {
  const res = await auth.login("Nasrat", "geheim-wachtwoord");
  assert.equal(res.ok, true);
  const user = await auth.userForToken(res.token);
  assert.equal(user.name, "Nasrat");
});

test("inloggen met het verkeerde wachtwoord lukt niet", async () => {
  const res = await auth.login("Nasrat", "fout");
  assert.equal(res.ok, false);
  await auth.clearFailedLogins("Nasrat");
});

test("een gebruiker zonder wachtwoord kan niet inloggen", async () => {
  const res = await auth.login("Michael", "");
  assert.equal(res.ok, false);
  await auth.clearFailedLogins("Michael");
});

test("een geblokkeerd account kan niet inloggen, ook niet met het juiste wachtwoord", async () => {
  const res = await auth.login("Oud", "geheim-wachtwoord");
  assert.equal(res.ok, false);
  await auth.clearFailedLogins("Oud");
});

test("na vijf mislukte pogingen gaat het account op slot", async () => {
  for (let i = 0; i < 5; i++) await auth.login("Nasrat", "fout");
  const res = await auth.login("Nasrat", "geheim-wachtwoord");
  assert.equal(res.ok, false, "ook het juiste wachtwoord werkt tijdens de blokkade niet");
  assert.equal(res.reason, "locked");
  assert.ok(res.minutes > 0 && res.minutes <= 15);
  await auth.clearFailedLogins("Nasrat");
  const na = await auth.login("Nasrat", "geheim-wachtwoord");
  assert.equal(na.ok, true, "na opheffen werkt inloggen weer");
});

test("afmelden maakt de sessie ongeldig", async () => {
  const res = await auth.login("Nasrat", "geheim-wachtwoord");
  await auth.endSession(res.token);
  assert.equal(await auth.userForToken(res.token), null);
});

test("een verlopen sessie geldt niet meer", async () => {
  const res = await auth.login("Nasrat", "geheim-wachtwoord");
  await run(`update session set expires_at = now() - interval '1 hour' where token = $1`, [res.token]);
  assert.equal(await auth.userForToken(res.token), null);
  await auth.purgeExpiredSessions();
  const row = await one(`select count(*)::int as n from session where token = $1`, [res.token]);
  assert.equal(row.n, 0, "opruimen haalt hem ook echt weg");
});

test("een verzonnen token geeft niemand", async () => {
  assert.equal(await auth.userForToken("zomaar-wat"), null);
  assert.equal(await auth.userForToken(null), null);
});
