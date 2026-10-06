/* Wachtwoorden en sessies.
 *
 * Wachtwoorden worden gehasht met scrypt uit node:crypto — geen extra
 * afhankelijkheid nodig. Opgeslagen wordt alleen de hash met zijn zout; het
 * wachtwoord zelf staat nergens, ook niet voor de beheerder. Kwijt is kwijt,
 * en dan zet je een nieuw wachtwoord.
 *
 * Belangrijk: dit werkt alleen omdat de controle hier gebeurt, op de server.
 * Een wachtwoordcontrole in de browser houdt niemand tegen die de opslag van
 * zijn eigen browser openmaakt.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { one, run } from "./db.js";

const scrypt = promisify(scryptCb);

// Kosten van het hashen. Hoger is veiliger en trager; 16384 kost ongeveer een
// tiende seconde, wat voor inloggen prima is en voor raden onaangenaam.
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

const SESSION_DAYS = 14;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < 8) {
    throw new Error("Passwort muss mindestens 8 Zeichen haben.");
  }
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(plain, stored) {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, sN, sr, sp, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(plain, salt, expected.length, { N: +sN, r: +sr, p: +sp });
  // Vergelijken in vaste tijd: anders verraadt de duur hoeveel tekens klopten.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------------- Rem op herhaald proberen ---------------- */

export async function loginBlockedFor(name) {
  const row = await one(`select fails, locked_till from login_attempt where name = $1`, [name]);
  if (!row || !row.locked_till) return 0;
  const left = new Date(row.locked_till).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

export async function noteFailedLogin(name) {
  // Eén statement, geen lezen-dan-schrijven: vijf gelijktijdige pogingen lezen
  // anders allemaal nul en schrijven allemaal één.
  await run(
    `insert into login_attempt (name, fails, locked_till)
     values ($1, 1, null)
     on conflict (name) do update
       set fails = login_attempt.fails + 1,
           locked_till = case when login_attempt.fails + 1 >= $2
                              then now() + ($3 || ' minutes')::interval
                              else null end`,
    [name, MAX_FAILS, String(LOCK_MINUTES)]
  );
}

export async function clearFailedLogins(name) {
  await run(`delete from login_attempt where name = $1`, [name]);
}

/* ---------------- Sessies ---------------- */

export async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  await run(`insert into session (token, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`, [
    token,
    userId,
    String(SESSION_DAYS),
  ]);
  return token;
}

export async function userForToken(token) {
  if (!token) return null;
  const row = await one(
    `select u.id, u.name, u.initials, u.role, u.active
       from session s join app_user u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now() and u.active`,
    [token]
  );
  if (row) await run(`update session set last_seen = now() where token = $1`, [token]);
  return row;
}

export async function endSession(token) {
  if (token) await run(`delete from session where token = $1`, [token]);
}

/** Verlopen sessies opruimen — draait bij het opstarten en daarna elk uur. */
export async function purgeExpiredSessions() {
  await run(`delete from session where expires_at < now()`);
  await run(`delete from login_attempt where locked_till is not null and locked_till < now() - interval '1 day'`);
}

/* ---------------- Inloggen ---------------- */

export async function login(name, password) {
  const blockedMinutes = await loginBlockedFor(name);
  if (blockedMinutes > 0) {
    return { ok: false, reason: "locked", minutes: blockedMinutes };
  }
  const user = await one(`select id, name, password_hash, active from app_user where name = $1`, [name]);
  // Ook bij een onbekende naam het wachtwoord doorrekenen, zodat de duur van
  // het antwoord niet verraadt of die naam bestaat.
  const stored = user && user.active ? user.password_hash : null;
  const good = await verifyPassword(password, stored || (await dummyHash()));
  if (!user || !user.active || !user.password_hash || !good) {
    await noteFailedLogin(name);
    return { ok: false, reason: "invalid" };
  }
  await clearFailedLogins(name);
  const token = await createSession(user.id);
  return { ok: true, token, user: { id: user.id, name: user.name } };
}

let dummy = null;
async function dummyHash() {
  if (!dummy) dummy = await hashPassword("x".repeat(16));
  return dummy;
}
