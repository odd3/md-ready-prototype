/* MD-READY — opslag in een map op het netwerk (File System Access API)
 *
 * De applicatie draait vanaf een https-adres, de gegevens blijven in het pand:
 * de gebruiker wijst één keer een map op de netwerkshare aan en daarna schrijft
 * de applicatie daar rechtstreeks naartoe. Er gaat geen patiëntgegeven naar
 * buiten.
 *
 * Deze API bestaat alleen in Chrome en Edge, en alleen op https of localhost —
 * een bestand dat je rechtstreeks vanaf de share opent (file://) geldt niet als
 * veilige context en krijgt hem niet. Zie storageUnavailableReason().
 *
 * Eén persoon tegelijk. Dat is geen afspraak maar een grendelbestand naast de
 * gegevens, zoals Excel dat doet: wie het als tweede opent krijgt te zien wie
 * het al openheeft en kan alleen-lezen verder. Zonder grendel raakt er niets
 * beschadigd, maar overschrijft de tweede het werk van de eerste zonder dat
 * iemand het merkt — en dat is erger, want niemand ziet het gebeuren.
 */

const DATA_FILE = "mdready-daten.json";
const LOCK_FILE = "mdready.lock";

// Een grendel die niet meer wordt bijgewerkt is van een afgesloten browser of
// een vastgelopen pc. Na twee minuten stilte mag een ander hem overnemen.
const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_BEAT_MS = 30 * 1000;

const IDB_NAME = "mdready-fs";
const IDB_STORE = "handles";
const HANDLE_KEY = "data-dir";

/* ---------------- Map-verwijzing bewaren tussen sessies ---------------- */

// Een aangewezen map kun je niet als tekst bewaren; de browser geeft je een
// verwijzing die alleen in IndexedDB past. Daardoor hoeft de medewerker de map
// niet elke ochtend opnieuw op te zoeken.
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
    tx.onsuccess = () => resolve(tx.result || null);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(value, key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Beschikbaarheid ---------------- */

function fsaSupported() {
  return typeof window.showDirectoryPicker === "function";
}
// Waarom het niet kan, in woorden die de gebruiker iets zeggen.
function storageUnavailableReason() {
  if (fsaSupported()) return null;
  if (!window.isSecureContext) {
    return "Diese Seite wurde direkt von der Festplatte geöffnet (file://). Das Speichern im Netzlaufwerk funktioniert nur über eine https-Adresse.";
  }
  return "Dieser Browser kann nicht in einen Ordner schreiben. Chrome oder Edge können es.";
}

/* ---------------- Toestemming ---------------- */

// queryPermission mag altijd; requestPermission alleen vanuit een klik van de
// gebruiker. Vandaar de splitsing: bij het opstarten vragen we alleen na,
// opnieuw toestemming vragen gebeurt achter een knop.
async function handlePermission(handle, interactive) {
  if (!handle) return false;
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if (!interactive) return false;
  return (await handle.requestPermission(opts)) === "granted";
}

async function savedDirHandle() {
  try {
    return await idbGet(HANDLE_KEY);
  } catch (e) {
    return null;
  }
}
async function pickDataFolder() {
  const dir = await window.showDirectoryPicker({ id: "mdready-data", mode: "readwrite" });
  await idbSet(HANDLE_KEY, dir);
  return dir;
}
async function forgetDataFolder() {
  try {
    await idbSet(HANDLE_KEY, null);
  } catch (e) {
    /* niet erg genoeg om iets mee te doen */
  }
}

/* ---------------- Gegevensbestand ---------------- */

async function readTextFile(dir, name) {
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return await file.text();
  } catch (e) {
    return null; // bestaat nog niet
  }
}
async function writeTextFile(dir, name, text) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function readDataFile(dir) {
  const text = await readTextFile(dir, DATA_FILE);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // Liever hard stoppen dan een kapot bestand overschrijven met verse
    // voorbeelddata — wat erin stond is dan tenminste nog terug te halen.
    throw new Error("Die Datei " + DATA_FILE + " ist beschädigt und wurde nicht überschrieben.");
  }
}
async function writeDataFile(dir, data) {
  await writeTextFile(dir, DATA_FILE, JSON.stringify(data, null, 1));
}

// Eén kopie per dag, naast het gegevensbestand. Kost bijna niets en is het
// enige wat helpt als iemand per ongeluk een halve administratie weggooit.
async function writeDailyBackup(dir) {
  // Lokale datum: de kopie hoort bij de werkdag, niet bij de UTC-dag.
  const stamp = isoDate(new Date());
  const name = "mdready-daten.backup-" + stamp + ".json";
  try {
    await dir.getFileHandle(name, { create: false });
    return false; // die van vandaag staat er al
  } catch (e) {
    /* nog geen kopie van vandaag */
  }
  const current = await readTextFile(dir, DATA_FILE);
  if (!current) return false;
  await writeTextFile(dir, name, current);
  return true;
}

// Tijdstempel voor bestandsnamen: 2026-09-21-1410
function fileStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Kopie van het gegevensbestand onder een eigen naam. Gebruikt vlak voor een
// overname, zodat er altijd een punt is om op terug te vallen.
async function snapshotDataFile(dir, label) {
  const current = await readTextFile(dir, DATA_FILE);
  if (!current) return null;
  const name = `mdready-daten.${label}-${fileStamp()}.json`;
  await writeTextFile(dir, name, current);
  return name;
}

// Niet-weggeschreven werk van een overgenomen sessie apart neerzetten. Het mag
// niet in het hoofdbestand, want daar werkt inmiddels een ander in — maar
// weggooien mag het ook niet.
async function writeHandoverFile(dir, userName, data) {
  const name = `mdready-uebergabe-${(userName || "unbekannt").replace(/[^\p{L}\p{N}_-]/gu, "_")}-${fileStamp()}.json`;
  await writeTextFile(dir, name, JSON.stringify(data, null, 1));
  return name;
}

/* ---------------- Grendel ---------------- */

function newSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function readLock(dir) {
  const text = await readTextFile(dir, LOCK_FILE);
  if (!text) return null;
  try {
    const lock = JSON.parse(text);
    lock.stale = Date.now() - new Date(lock.heartbeat).getTime() > LOCK_STALE_MS;
    return lock;
  } catch (e) {
    return null; // onleesbare grendel telt als geen grendel
  }
}
async function writeLock(dir, lock) {
  await writeTextFile(dir, LOCK_FILE, JSON.stringify({ ...lock, heartbeat: new Date().toISOString() }, null, 1));
}
async function clearLock(dir) {
  try {
    await dir.removeEntry(LOCK_FILE);
  } catch (e) {
    /* al weg, of geen rechten — de verstreken tijd ruimt hem dan op */
  }
}
