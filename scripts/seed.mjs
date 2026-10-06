/* Zet de voorbeelddata uit data.js in de database.
 *
 *   npm run seed            vult aan wat er nog niet is
 *   npm run seed -- --reset gooit eerst alles weg (behalve gebruikers)
 *
 * data.js is het bestand dat de browser ook laadt; het wordt hier uitgevoerd
 * zodat de demo-inhoud maar op één plek staat. Daarmee is dit meteen een
 * toets op het datamodel: past de volledige demo erin, dan klopt het schema.
 *
 * Bestaande gebruikers worden niet aangeraakt. Demo-namen die nog niet
 * bestaan komen erbij zónder wachtwoord — inloggen kan dus pas als er met
 * `npm run adduser` een wachtwoord voor is gezet.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, one, run, tx } from "../server/db.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reset = process.argv.includes("--reset");

// data.js is browsercode zonder export; uitvoeren in een eigen scope levert
// seedState() op.
const source = await readFile(path.join(ROOT, "data.js"), "utf8");
const seedState = new Function(`${source}; return seedState;`)();
const demo = seedState();

await db();

await tx(async () => {
  if (reset) {
    // Volgorde volgt de verwijzingen: eerst wat naar iets anders wijst.
    await run(`delete from item_event`);
    await run(`delete from item_comment`);
    await run(`delete from item_assignee`);
    await run(`delete from checklist_item`);
    await run(`delete from patient`);
    await run(`delete from staff`);
    await run(`delete from organization`);
    console.log("Bestaande gegevens verwijderd (gebruikers bleven staan).");
  }

  for (const c of demo.categories) {
    await run(
      `insert into category (id, label, scope) values ($1, $2, $3)
       on conflict (id) do update set label = excluded.label, scope = excluded.scope`,
      [c.id, c.label, c.scope]
    );
  }

  // Gebruikers: alleen aanvullen, nooit overschrijven. Een bestaand account
  // heeft mogelijk al een wachtwoord en dat mag een seed niet wegnemen.
  const userId = new Map();
  for (const u of demo.users) {
    const found = await one(`select id from app_user where name = $1`, [u.name]);
    if (found) {
      userId.set(u.id, found.id);
    } else {
      const row = await one(`insert into app_user (name, initials, role) values ($1, $2, 'admin') returning id`, [
        u.name,
        u.initials,
      ]);
      userId.set(u.id, row.id);
    }
  }

  const orgId = new Map();
  for (const o of demo.organizations) {
    const row = await one(
      `insert into organization (name, color, active, last_audit, audit_interval_months)
       values ($1, $2, $3, $4, $5) returning id`,
      [o.name, o.color, o.active !== false, o.createdAt, o.auditIntervalMonths]
    );
    orgId.set(o.id, row.id);
  }

  const patientId = new Map();
  for (const p of demo.patients) {
    const row = await one(
      `insert into patient (org_id, name, pflegegrad, sgb_v, active) values ($1, $2, $3, $4, $5) returning id`,
      [orgId.get(p.orgId), p.name, p.pflegegrad, p.sgbV || [], p.active !== false]
    );
    patientId.set(p.id, row.id);
  }

  const staffId = new Map();
  for (const s of demo.staff) {
    const row = await one(`insert into staff (org_id, name, category, active) values ($1, $2, $3, $4) returning id`, [
      orgId.get(s.orgId),
      s.name,
      s.category,
      s.active !== false,
    ]);
    staffId.set(s.id, row.id);
  }

  let items = 0;
  let assignees = 0;
  let comments = 0;
  for (const it of demo.items) {
    const row = await one(
      `insert into checklist_item
         (org_id, category_id, label, level, status, priority, deadline, link_type, patient_id, staff_id, completed_at, completed_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        orgId.get(it.orgId),
        it.category,
        it.label,
        it.level || 1,
        it.status,
        it.priority,
        it.deadline,
        it.linkType,
        it.linkType === "patient" ? patientId.get(it.linkId) : null,
        it.linkType === "staff" ? staffId.get(it.linkId) : null,
        it.completedAt,
        it.completedBy ? userId.get(it.completedBy) : null,
      ]
    );
    items++;
    for (const a of it.assignees || []) {
      if (!userId.has(a)) continue;
      await run(`insert into item_assignee (item_id, user_id) values ($1, $2) on conflict do nothing`, [
        row.id,
        userId.get(a),
      ]);
      assignees++;
    }
    for (const c of it.comments || []) {
      if (!userId.has(c.author)) continue;
      await run(`insert into item_comment (item_id, author_id, body, created_at) values ($1, $2, $3, $4)`, [
        row.id,
        userId.get(c.author),
        c.text,
        c.createdAt,
      ]);
      comments++;
    }
  }

  console.log(
    `Geseed: ${orgId.size} organisaties, ${userId.size} gebruikers, ${patientId.size} patiënten, ` +
      `${staffId.size} medewerkers, ${items} checklistpunten, ${assignees} toewijzingen, ${comments} opmerkingen.`
  );
});

process.exit(0);
