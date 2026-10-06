/* Controleert de regels die het datamodel zelf moet afdwingen.
 *
 * Deze draaien tegen PGlite — dezelfde Postgres-engine als op de server — dus
 * wat hier wordt geweigerd, wordt daar ook geweigerd.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(path.join(tmpdir(), "mdready-test-"));
process.env.PGLITE_DIR = path.join(dir, "pgdata");
delete process.env.DATABASE_URL;

const { db, execFile, one, run, today, close } = await import("../server/db.js").then(async (m) => ({
  ...m,
  close: async () => (await m.db()).close(),
}));

before(async () => {
  await db();
  await execFile(await readFile(path.join(ROOT, "server", "schema.sql"), "utf8"));
  await run(`insert into category (id, label, scope) values ('akte', 'Patientenakte', 'patient'), ('hygiene', 'Hygiene', 'org')`);
  await run(`insert into organization (id, name, last_audit) values (1, 'Dienst A', '2026-01-01'), (2, 'Dienst B', '2026-01-01')`);
  await run(`insert into patient (id, org_id, name) values (10, 1, 'Patient van A'), (20, 2, 'Patient van B')`);
});

after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test("een punt mag naar een patiënt van de eigen organisatie wijzen", async () => {
  await run(
    `insert into checklist_item (org_id, category_id, label, link_type, patient_id) values (1, 'akte', 'SIS', 'patient', 10)`
  );
  const row = await one(`select count(*)::int as n from checklist_item where org_id = 1`);
  assert.equal(row.n, 1);
});

test("een punt van organisatie A mag NIET naar een patiënt van B wijzen", async () => {
  // Dit is de regel die kruisbesmetting tussen Pflegediensten onmogelijk maakt.
  await assert.rejects(
    () =>
      run(`insert into checklist_item (org_id, category_id, label, link_type, patient_id) values (1, 'akte', 'Lek', 'patient', 20)`),
    /violates foreign key constraint/i
  );
});

test("een organisatiepunt mag geen patiënt hebben", async () => {
  await assert.rejects(
    () =>
      run(`insert into checklist_item (org_id, category_id, label, link_type, patient_id) values (1, 'hygiene', 'Fout', 'org', 10)`),
    /link_consistent/i
  );
});

test("een patiëntpunt zonder patiënt wordt geweigerd", async () => {
  await assert.rejects(
    () => run(`insert into checklist_item (org_id, category_id, label, link_type) values (1, 'akte', 'Fout', 'patient')`),
    /link_consistent/i
  );
});

test("status kent alleen de drie bekende waarden", async () => {
  await assert.rejects(
    () =>
      run(
        `insert into checklist_item (org_id, category_id, label, link_type, patient_id, status) values (1, 'akte', 'X', 'patient', 10, 'vielleicht')`
      ),
    /check constraint/i
  );
});

test("het audittrail is append-only", async () => {
  const item = await one(`select id from checklist_item where org_id = 1 limit 1`);
  await run(`insert into item_event (item_id, org_id, field, old_value, new_value) values ($1, 1, 'status', 'open', 'done')`, [
    item.id,
  ]);
  await assert.rejects(() => run(`update item_event set new_value = 'open'`), /append-only/i);
  await assert.rejects(() => run(`delete from item_event`), /append-only/i);
  const row = await one(`select count(*)::int as n from item_event`);
  assert.equal(row.n, 1, "de regel staat er na beide pogingen nog steeds");
});

test("twee gebruikers kunnen niet dezelfde naam hebben", async () => {
  await run(`insert into app_user (name, initials) values ('Nasrat', 'NA')`);
  await assert.rejects(() => run(`insert into app_user (name, initials) values ('Nasrat', 'NA')`), /unique/i);
});

test("today() geeft de kalenderdag van de Pflegedienst, niet die van UTC", async () => {
  const d = await today();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  // Vergelijk met wat de tijdzone zelf zegt — dit is de fout die eerder élke
  // datum een dag te vroeg zette.
  const verwacht = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.SITE_TZ || "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.equal(d, verwacht);
});
