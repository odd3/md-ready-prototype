/* Gebruikers aanmaken en wachtwoorden zetten.
 *
 *   npm run adduser -- --list
 *   npm run adduser -- --name "Nasrat"                 nieuw account, wachtwoord wordt bedacht
 *   npm run adduser -- --name "Nasrat" --password "…"  zelf een wachtwoord kiezen
 *   npm run adduser -- --name "Nasrat" --reset         nieuw wachtwoord voor een bestaand account
 *   npm run adduser -- --name "Nasrat" --block         account blokkeren
 *   npm run adduser -- --name "Nasrat" --unblock
 *
 * Het wachtwoord wordt één keer getoond en daarna nooit meer: in de database
 * staat alleen de hash. Geef het door via een kanaal dat je vertrouwt, en niet
 * in dezelfde mail als het adres van de applicatie.
 */

import { randomBytes } from "node:crypto";
import { all, db, one, run } from "../server/db.js";
import { hashPassword, clearFailedLogins } from "../server/auth.js";

function arg(name) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return null;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

// Uitspreekbaar genoeg om door te geven, lang genoeg om niet te raden.
function makePassword() {
  const abc = "abcdefghijkmnopqrstuvwxyz";
  const num = "23456789";
  const bytes = randomBytes(24);
  let out = "";
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) out += abc[bytes[i * 5 + j] % abc.length];
    if (i < 3) out += num[bytes[i * 5 + 4] % num.length] + "-";
  }
  return out;
}

function initialsFor(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

await db();

if (arg("list")) {
  const rows = await all(
    `select u.id, u.name, u.role, u.active, u.password_hash is not null as has_password,
            (select count(*)::int from session s where s.user_id = u.id and s.expires_at > now()) as sessions
       from app_user u order by u.id`
  );
  if (!rows.length) console.log("Nog geen gebruikers. Maak er een aan met --name.");
  for (const r of rows) {
    const flags = [r.active ? "actief" : "GEBLOKKEERD", r.has_password ? "wachtwoord ingesteld" : "GEEN WACHTWOORD"];
    console.log(`${String(r.id).padStart(3)}  ${r.name.padEnd(20)} ${r.role.padEnd(12)} ${flags.join(" · ")} · ${r.sessions} sessie(s)`);
  }
  process.exit(0);
}

const name = arg("name");
if (!name || name === true) {
  console.error("Gebruik: npm run adduser -- --name \"Naam\" [--password \"…\"] [--reset] [--block] [--unblock] [--list]");
  process.exit(1);
}

const existing = await one(`select id, active from app_user where name = $1`, [name]);

if (arg("block") || arg("unblock")) {
  if (!existing) {
    console.error(`Geen gebruiker met de naam "${name}".`);
    process.exit(1);
  }
  const active = !!arg("unblock");
  await run(`update app_user set active = $2 where id = $1`, [existing.id, active]);
  // Blokkeren moet meteen effect hebben, niet pas als de sessie verloopt.
  if (!active) await run(`delete from session where user_id = $1`, [existing.id]);
  console.log(`${name} is nu ${active ? "actief" : "geblokkeerd"}.`);
  process.exit(0);
}

const chosen = arg("password");
const password = typeof chosen === "string" ? chosen : makePassword();

if (existing && !arg("reset") && typeof chosen !== "string") {
  console.error(`"${name}" bestaat al. Gebruik --reset voor een nieuw wachtwoord, of --list voor een overzicht.`);
  process.exit(1);
}

const hash = await hashPassword(password);

if (existing) {
  await run(`update app_user set password_hash = $2 where id = $1`, [existing.id, hash]);
  // Oude sessies vervallen bij een nieuw wachtwoord — anders blijft wie al
  // ingelogd was gewoon binnen, en dat is meestal juist de reden om te resetten.
  await run(`delete from session where user_id = $1`, [existing.id]);
  await clearFailedLogins(name);
  console.log(`Nieuw wachtwoord voor ${name}. Lopende sessies zijn beëindigd.`);
} else {
  await run(`insert into app_user (name, initials, role, password_hash) values ($1, $2, 'admin', $3)`, [
    name,
    initialsFor(name),
    hash,
  ]);
  console.log(`Gebruiker ${name} aangemaakt.`);
}

console.log("");
console.log(`  Wachtwoord:  ${password}`);
console.log("");
console.log("Dit wordt niet nog een keer getoond — in de database staat alleen de hash.");
process.exit(0);
