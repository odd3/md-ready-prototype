/* MD-READY Prototyp — geen backend; de gegevens staan in een map op het
   netwerk (zie storage.js) of, als terugvaloptie, in deze browser. */

const STORAGE_KEY = "mdready-demo-state-v1";
const MODE_KEY = "mdready-storage-mode";
// Wie je bent hoort bij deze werkplek, niet bij het gedeelde bestand: anders
// erft de volgende die het opent de naam van de vorige.
const USER_KEY = "mdready-current-user";
let state = null;
let route = "dashboard";
const EMPTY_FILTERS = { quick: [], patient: "", category: "", assignee: "", status: "" };
let activeFilters = { ...EMPTY_FILTERS };

// Welk filter hoort bij welk dashboardblok. De telling in het blok en de lijst
// waar je op uitkomt moeten hetzelfde zijn, anders klopt het blok niet.
const KPI_FILTERS = {
  open: { quick: ["open"] },
  done: { status: "done" },
  today: { quick: ["today"] },
  overdue: { quick: ["overdue"] },
  mine: { quick: ["mine", "open"] },
};
let openItemId = null;
let staffTab = "examinierte";
// { kind: "patient-new"|"patient-edit"|"staff-new"|"staff-edit"|"item-new"|"pdf-export", id?, category?, categoryIds?, scope?, scopeValue? }
let modalState = null;

/* ---------------- Opslag: netwerkmap of deze browser ---------------- */

let storageMode = "none"; // "none" | "file" | "local"
let storageDir = null;
let storageDirName = "";
let storageReadOnly = false;
let storageNote = "";
let storageError = "";
let saveStatus = "idle"; // "idle" | "saving" | "saved" | "error"
let lockConflict = null;
let lockSince = null;
let lockHeld = false;
let takenOverBy = null;
let wasTakenOver = false;
let handoverFile = null;
let savedHandleName = null;
const sessionId = newSessionId();
let lockTimer = null;
let writeTimer = null;
let writePending = false;
let writeInFlight = false;

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.version === SEED_VERSION) return parsed;
      // Nieuwe seed-versie beschikbaar: eerdere handmatige wijzigingen van
      // deze bezoeker vervallen, zodat iedereen de actuele voorbeelddata ziet.
    } catch (e) {
      /* fall through to reseed */
    }
  }
  return seedState();
}

// Wat er naar het gedeelde bestand gaat. De ingelogde naam blijft eruit; die
// hoort bij de werkplek en niet bij de administratie.
function stateForFile() {
  return { ...state, currentUserId: null };
}

function saveState() {
  if (storageReadOnly) return;
  if (storageMode === "file") {
    scheduleFileWrite();
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    storageError = "Speichern im Browser nicht möglich.";
  }
}

// Schrijven wordt even opgespaard: één vinkje zetten is drie aanrakingen van
// de state, en dan is één keer wegschrijven genoeg.
function scheduleFileWrite() {
  writePending = true;
  setSaveStatus("saving");
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushFileWrite, 500);
}
async function flushFileWrite() {
  if (writeInFlight) {
    // Nooit twee schrijfacties tegelijk op hetzelfde bestand.
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushFileWrite, 300);
    return;
  }
  if (!storageDir || storageReadOnly) return;
  writeInFlight = true;
  try {
    const lock = await readLock(storageDir);
    if (lock && lock.sessionId !== sessionId) {
      // Overgenomen terwijl wij nog iets klaar hadden staan.
      await handleTakenOver(lock);
      return;
    }
    await writeDataFile(storageDir, stateForFile());
    writePending = false;
    storageError = "";
    setSaveStatus("saved");
  } catch (e) {
    storageError = e.message || "Schreiben fehlgeschlagen.";
    setSaveStatus("error");
  } finally {
    writeInFlight = false;
  }
}
// Alleen het lampje bijwerken. render() zou het hele scherm opnieuw opbouwen
// en de cursor uit een invoerveld halen terwijl iemand aan het typen is.
function setSaveStatus(status) {
  saveStatus = status;
  const el = document.getElementById("save-indicator");
  if (el) el.outerHTML = saveIndicatorHtml();
}
function saveIndicatorHtml() {
  const txt = {
    idle: storageReadOnly ? "Nur Lesen" : "Bereit",
    saving: "Speichert …",
    saved: "Gespeichert",
    error: "Nicht gespeichert",
  }[saveStatus];
  const icon = { idle: "·", saving: "⟳", saved: "✓", error: "!" }[saveStatus];
  return `<div id="save-indicator" class="save-indicator ${saveStatus}" title="${storageError || ""}">${icon} ${txt}</div>`;
}

async function connectFolder(dir) {
  storageDir = dir;
  storageDirName = dir.name || "Datenordner";
  storageMode = "file";
  storageError = "";
  localStorage.setItem(MODE_KEY, "file");

  const lock = await readLock(dir);
  if (lock && !lock.stale && lock.sessionId !== sessionId) {
    // Iemand anders heeft het open — de gebruiker kiest zelf wat er gebeurt.
    lockConflict = lock;
    storageReadOnly = true;
    await loadFromFile();
    return;
  }
  storageReadOnly = false;
  await loadFromFile();
  await writeDailyBackup(dir).catch(() => {});
  await takeLock();
}

async function loadFromFile() {
  const data = await readDataFile(storageDir);
  if (data) {
    state = data;
    storageNote =
      data.version === SEED_VERSION
        ? ""
        : `Die Datei stammt aus Version ${data.version}, diese Anwendung ist Version ${SEED_VERSION}. Die Daten wurden unverändert übernommen.`;
  } else {
    // Lege map: begin met de voorbeelddata en zet het bestand meteen neer.
    state = seedState();
    if (!storageReadOnly) await writeDataFile(storageDir, stateForFile());
  }
  state.currentUserId = sessionStorage.getItem(USER_KEY) || null;
}

async function takeLock() {
  lockSince = lockSince || new Date().toISOString();
  lockHeld = true;
  takenOverBy = null;
  wasTakenOver = false;
  handoverFile = null;
  await refreshLock();
  clearInterval(lockTimer);
  lockTimer = setInterval(() => heartbeat().catch(() => {}), LOCK_BEAT_MS);
}
async function refreshLock() {
  if (storageMode !== "file" || storageReadOnly || !storageDir) return;
  const u = currentUser();
  await writeLock(storageDir, {
    sessionId,
    user: state ? state.currentUserId : null,
    userName: u ? u.name : "—",
    since: lockSince,
  });
}

// Elke hartslag eerst kijken of de grendel nog van ons is. Een collega kan hem
// hebben overgenomen omdat deze sessie ergens open bleef staan.
async function heartbeat() {
  if (storageMode !== "file" || storageReadOnly || !storageDir) return;
  const lock = await readLock(storageDir);
  if (lock && lock.sessionId !== sessionId) {
    await handleTakenOver(lock);
    return;
  }
  await refreshLock();
}

// Onze sessie is overgenomen. Vanaf nu niets meer naar het hoofdbestand
// schrijven — daar werkt een ander in. Wat hier nog niet was weggeschreven gaat
// naar een apart bestand, zodat het niet verloren gaat en later is na te kijken.
async function handleTakenOver(lock) {
  storageReadOnly = true;
  lockHeld = false;
  wasTakenOver = true;
  takenOverBy = lock.userName && lock.userName !== "—" ? lock.userName : null;
  clearInterval(lockTimer);
  clearTimeout(writeTimer);
  if (writePending) {
    try {
      const u = currentUser();
      handoverFile = await writeHandoverFile(storageDir, u ? u.name : "unbekannt", stateForFile());
    } catch (e) {
      storageError = "Nicht gespeicherte Änderungen konnten nicht gesichert werden.";
    }
    writePending = false;
  }
  setSaveStatus("idle");
  render();
}

// Netjes afmelden: eerst wegschrijven, dan de grendel vrijgeven.
async function releaseLock() {
  clearInterval(lockTimer);
  if (writePending) await flushFileWrite();
  if (storageMode === "file" && lockHeld && storageDir) await clearLock(storageDir);
  lockHeld = false;
  lockSince = null;
}

// Terug aan het werk nadat de grendel is vrijgegeven — bijvoorbeeld na het
// afmelden. Kan mislukken als iemand anders inmiddels binnen is.
async function reacquireLock() {
  if (storageMode !== "file" || lockHeld || !storageDir) return true;
  const lock = await readLock(storageDir);
  if (lock && !lock.stale && lock.sessionId !== sessionId) {
    lockConflict = lock;
    storageReadOnly = true;
    return false;
  }
  storageReadOnly = false;
  await takeLock();
  return true;
}

function useLocalStorageMode() {
  storageMode = "local";
  storageReadOnly = false;
  localStorage.setItem(MODE_KEY, "local");
  state = loadLocalState();
  state.currentUserId = sessionStorage.getItem(USER_KEY) || null;
}

async function boot() {
  loadPanelPrefs();
  const saved = await savedDirHandle();
  if (saved) {
    savedHandleName = saved.name;
    // Alleen navragen, niet opnieuw vragen: daarvoor is een klik nodig.
    if (await handlePermission(saved, false)) {
      try {
        await connectFolder(saved);
      } catch (e) {
        storageError = e.message;
        storageMode = "none";
      }
    }
  }
  if (storageMode === "none" && localStorage.getItem(MODE_KEY) === "local") useLocalStorageMode();
  render();
}

// De grendel weghalen bij het sluiten. Lukt dat niet — afsluiten geeft weinig
// tijd — dan verloopt hij vanzelf door de stilte in de hartslag.
window.addEventListener("pagehide", () => {
  if (storageMode === "file" && lockHeld && storageDir) clearLock(storageDir);
});
window.addEventListener("beforeunload", (e) => {
  if (writePending) {
    e.preventDefault();
    e.returnValue = "";
  }
});
function resetDemo() {
  const where = storageMode === "file" ? `Die Datei im Ordner "${storageDirName}" wird überschrieben.` : "Die Daten in diesem Browser werden überschrieben.";
  if (!confirm("Demo-Daten zurücksetzen? Alle Änderungen gehen verloren.\n\n" + where)) return;
  const user = state ? state.currentUserId : null;
  state = seedState();
  state.currentUserId = user;
  saveState();
  render();
}

function currentUser() {
  return state && state.users.find((u) => u.id === state.currentUserId);
}
function isAdmin() {
  const u = currentUser();
  return !!u && u.role === "admin";
}
function todayStr() {
  // Lokale kalenderdatum — zie isoDate() in data.js.
  return isoDate(new Date());
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
function fmtDate(s) {
  if (!s) return "–";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}
function deadlineInfo(deadline, status) {
  if (status === "done") return { cls: "", label: fmtDate(deadline) };
  const today = todayStr();
  if (deadline < today) return { cls: "overdue", label: fmtDate(deadline) + " · überfällig" };
  if (deadline === today) return { cls: "today", label: "Heute" };
  return { cls: "", label: fmtDate(deadline) };
}
function userLabel(id) {
  const u = state.users.find((x) => x.id === id);
  return u ? u.name : id;
}
function staffLabel(id) {
  const s = state.staff.find((x) => x.id === id);
  return s ? s.name : id;
}
function staffCategoryLabel(id) {
  const c = STAFF_CATEGORIES.find((x) => x.id === id);
  return c ? c.label : id;
}
function categoryLabel(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.label : id;
}
function isSimpleDocCategory(categoryId) {
  return categoryId === "qm" || categoryId === "hygiene";
}
function visibleCategories() {
  if (isAdmin()) return state.categories;
  return state.categories.filter((c) => c.id !== "personal");
}
function visibleItems() {
  const catIds = visibleCategories().map((c) => c.id);
  return state.items.filter((it) => catIds.includes(it.category));
}
function patientCategories() {
  return state.categories.filter((c) => c.scope === "patient");
}
function patientScopedItems() {
  return state.items.filter((it) => it.linkType === "patient");
}
function itemLabelsForCategory(categoryId) {
  const refPatient = state.patients[0];
  if (!refPatient) return [];
  return state.items.filter((it) => it.linkType === "patient" && it.linkId === refPatient.id && it.category === categoryId).map((it) => it.label);
}
function itemLinkLabel(item) {
  if (item.linkType === "patient") {
    const p = state.patients.find((x) => x.id === item.linkId);
    return p ? p.name : "–";
  }
  if (item.linkType === "staff") return staffLabel(item.linkId);
  return "Organisation";
}
function isFullyDone(item) {
  return item.status === "done" && (!item.nachkontrolleRequired || item.nachkontrolleDone);
}
function computeAggregateStatus(linkType, linkId) {
  const items = state.items.filter((it) => it.linkType === linkType && it.linkId === linkId);
  if (items.length === 0) return "korrektur";
  if (items.every((it) => isFullyDone(it))) return "vollstaendig";
  const today = todayStr();
  const hasCritical = items.some((it) => it.status !== "done" && (it.deadline < today || (it.priority === "high" && it.deadline <= today)));
  if (hasCritical) return "dringend";
  return "korrektur";
}
const AGGREGATE_LABEL = { vollstaendig: "Vollständig", korrektur: "Korrektur erforderlich", dringend: "Dringend" };

// Pflegedienste: aanmaakdatum + interval → eerstvolgende MD-controle, countdown en voortgang.
function pflegedienstInfo(pd) {
  const nextDate = addMonths(pd.createdAt, pd.auditIntervalMonths);
  const totalDays = daysBetween(pd.createdAt, nextDate);
  const elapsedDays = daysBetween(pd.createdAt, todayStr());
  const daysLeft = daysBetween(todayStr(), nextDate);
  const pct = Math.max(0, Math.min(100, Math.round((elapsedDays / totalDays) * 100)));
  return { nextDate, daysLeft, pct };
}

/* ---------------- Rendering ---------------- */

function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  // Eerst: waar komen de gegevens vandaan. Zonder die keuze is er geen state.
  if (storageMode === "none") {
    app.appendChild(renderStorageSetup());
    return;
  }
  // Iemand anders heeft het bestand open. Zelf kiezen wat er gebeurt.
  if (lockConflict) {
    app.appendChild(renderLockConflict());
    return;
  }

  // Op een netwerkshare start iedereen dezelfde applicatie op. De Pflegedienst
  // staat dan al goed; het enige wat de medewerker nog kiest is wie hij is,
  // want elke afvinking en elke opmerking wordt op zijn naam vastgelegd.
  if (!currentUser()) {
    app.appendChild(renderUserPicker());
    return;
  }

  app.appendChild(renderSidebar());

  const main = document.createElement("div");
  main.className = "main";
  if (storageReadOnly || storageNote || storageError) {
    const banner = document.createElement("div");
    banner.className = "storage-warning inline" + (storageReadOnly ? " strong" : "");
    banner.textContent = storageReadOnly
      ? wasTakenOver
        ? `${takenOverBy ? takenOverBy + " hat" : "Eine andere Sitzung hat"} diesen Ordner übernommen. Ihre gespeicherte Arbeit steht im Ordner${handoverFile ? `, noch nicht gespeicherte Änderungen liegen in ${handoverFile}` : ""}. Sie können nur noch lesen.`
        : "Nur-Lese-Modus — Änderungen werden nicht gespeichert."
      : storageError || storageNote;
    main.appendChild(banner);
  }
  if (route === "dashboard") main.appendChild(renderDashboard());
  else if (route === "checklist") main.appendChild(renderChecklist());
  else if (route === "patients") main.appendChild(renderPatients());
  else if (route === "personal" && isAdmin()) main.appendChild(renderPersonal());
  else if (route === "qm") main.appendChild(renderSimpleDocPage("qm"));
  else if (route === "hygiene") main.appendChild(renderSimpleDocPage("hygiene"));
  else if (route === "admin" && isAdmin()) main.appendChild(renderAdmin());
  else { route = "dashboard"; main.appendChild(renderDashboard()); }
  app.appendChild(main);

  app.appendChild(renderOverlayAndPanel());
  app.appendChild(renderModalPanel());
}

// Waar komen de gegevens vandaan? Eén keer kiezen; daarna onthoudt de browser
// de map en komt dit scherm niet meer terug.
function renderStorageSetup() {
  const el = document.createElement("div");
  el.className = "user-picker";
  const reason = storageUnavailableReason();
  el.innerHTML = `
    <div class="picker-card">
      <div class="picker-brand">
        <div class="brand-mark">M</div>
        <div>
          <div class="brand-name">MD-READY</div>
          <div class="tenant-name">Einrichtung</div>
        </div>
      </div>
      <h1>Wo liegen die Daten?</h1>
      <p class="picker-sub">Die Anwendung schreibt in einen Ordner auf Ihrem Netzlaufwerk. Die Daten verlassen das Haus nicht.</p>
      ${storageError ? `<div class="storage-warning">${storageError}</div>` : ""}
      ${reason ? `<div class="storage-warning">${reason}</div>` : ""}
      <div class="storage-choices">
        ${
          reason
            ? ""
            : `<button class="btn primary" id="pick-folder">${savedHandleName ? `Mit Ordner „${savedHandleName}" verbinden` : "Ordner im Netzlaufwerk wählen"}</button>`
        }
        ${savedHandleName && !reason ? '<button class="btn" id="pick-other">Anderen Ordner wählen</button>' : ""}
        <button class="btn" id="use-local">Nur auf diesem Computer (Demo)</button>
      </div>
      <p class="picker-footnote">„Nur auf diesem Computer" ist zum Ausprobieren: die Daten bleiben in diesem Browser und niemand sonst sieht sie.</p>
    </div>
  `;
  const connect = async (chooseNew) => {
    try {
      storageError = "";
      let dir = chooseNew ? null : await savedDirHandle();
      if (dir) {
        // Toestemming opnieuw vragen mag hier: we zitten in een klik.
        if (!(await handlePermission(dir, true))) dir = null;
      }
      if (!dir) dir = await pickDataFolder();
      await connectFolder(dir);
      render();
    } catch (e) {
      if (e && e.name === "AbortError") return; // gebruiker klikte de kiezer weg
      storageError = e.message || String(e);
      render();
    }
  };
  const pick = el.querySelector("#pick-folder");
  if (pick) pick.addEventListener("click", () => connect(false));
  const other = el.querySelector("#pick-other");
  if (other)
    other.addEventListener("click", async () => {
      await forgetDataFolder();
      savedHandleName = null;
      connect(true);
    });
  el.querySelector("#use-local").addEventListener("click", () => {
    useLocalStorageMode();
    render();
  });
  return el;
}

// Eén tegelijk. Wie als tweede komt ziet wie er al in zit en kiest zelf.
function renderLockConflict() {
  const el = document.createElement("div");
  el.className = "user-picker";
  const since = new Date(lockConflict.since || lockConflict.heartbeat);
  const sinceTxt = since.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const quietMin = Math.floor((Date.now() - new Date(lockConflict.heartbeat).getTime()) / 60000);
  // Hoe lang er geen teken van leven was, is de informatie waarop je besluit of
  // iemand echt weg is of gewoon even koffie haalt.
  const quietTxt = quietMin < 1 ? "gerade eben" : quietMin < 60 ? `vor ${quietMin} Minuten` : `vor ${Math.floor(quietMin / 60)} Stunden`;
  const abandoned = quietMin >= 2;
  el.innerHTML = `
    <div class="picker-card">
      <h1>Die Datei ist in Benutzung</h1>
      <p class="picker-sub">
        <strong>${lockConflict.userName || "Jemand"}</strong> hat den Ordner seit ${sinceTxt} geöffnet.
        Letztes Lebenszeichen: <strong>${quietTxt}</strong>.
      </p>
      ${
        abandoned
          ? `<div class="storage-warning">Seit ${quietTxt} keine Aktivität. Vermutlich wurde die Sitzung nicht richtig geschlossen — etwa weil der Rechner noch ansteht oder die Kollegin krank ist.</div>`
          : `<div class="storage-warning">Es sieht so aus, als würde dort gerade gearbeitet. Bitte kurz nachfragen, bevor Sie übernehmen.</div>`
      }
      <div class="storage-choices">
        <button class="btn ${abandoned ? "" : "primary"}" id="lock-read">Nur lesen — nichts wird gespeichert</button>
        <button class="btn ${abandoned ? "primary" : ""}" id="lock-take">Sitzung übernehmen</button>
      </div>
      <p class="picker-footnote">
        Beim Übernehmen wird nichts gelöscht: die gespeicherte Arbeit bleibt, und es wird zuerst eine Kopie abgelegt.
        Die andere Sitzung merkt die Übernahme und kann danach nur noch lesen.
      </p>
    </div>
  `;
  el.querySelector("#lock-read").addEventListener("click", () => {
    lockConflict = null;
    storageReadOnly = true;
    setSaveStatus("idle");
    render();
  });
  el.querySelector("#lock-take").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Übernimmt …";
    try {
      // Eerst een kopie van wat er staat, dan pas de grendel overnemen. Gaat er
      // daarna iets mis, dan is dit het punt om op terug te vallen.
      await snapshotDataFile(storageDir, "vor-uebernahme");
      // Opnieuw inlezen: de ander kan in de tussentijd nog iets hebben opgeslagen.
      await loadFromFile();
      lockConflict = null;
      storageReadOnly = false;
      lockSince = new Date().toISOString();
      await takeLock();
      setSaveStatus("idle");
    } catch (err) {
      storageError = err.message || "Übernehmen fehlgeschlagen.";
    }
    render();
  });
  return el;
}

// Aanmeldscherm — geen wachtwoord, geen echte authenticatie. Dit kiest alleen
// namens wie er gewerkt wordt; de beveiliging komt in de architectuurfase.
function renderUserPicker() {
  const el = document.createElement("div");
  el.className = "user-picker";
  el.innerHTML = `
    <div class="picker-card">
      <div class="picker-brand">
        <div class="brand-mark">M</div>
        <div>
          <div class="brand-name">MD-READY</div>
          <div class="tenant-name">${state.tenant.name}</div>
        </div>
      </div>
      <h1>Wer arbeitet heute?</h1>
      <p class="picker-sub">Alle Eintragungen werden unter diesem Namen gespeichert.</p>
      <div class="picker-grid">
        ${state.users
          .map(
            (u) => `<button class="picker-btn" data-user="${u.id}">
              <span class="picker-initials">${u.initials}</span>
              <span class="picker-name">${u.name}</span>
              <span class="picker-role">${u.roleLabel}</span>
            </button>`
          )
          .join("")}
      </div>
    </div>
  `;
  el.querySelectorAll("[data-user]").forEach((b) =>
    b.addEventListener("click", async () => {
      state.currentUserId = b.dataset.user;
      route = "dashboard";
      try {
        sessionStorage.setItem(USER_KEY, b.dataset.user);
      } catch (e) {
        /* naam onthouden is meegenomen, niet noodzakelijk */
      }
      // Na afmelden is de grendel vrij; iemand anders kan er inmiddels in zitten.
      const gotLock = await reacquireLock().catch(() => true);
      if (gotLock) {
        refreshLock().catch(() => {});
        saveState();
      }
      render();
    })
  );
  return el;
}

function renderSidebar() {
  const el = document.createElement("div");
  el.className = "sidebar";

  const nav = [
    { id: "dashboard", label: "Dashboard", ic: "◆" },
    { id: "checklist", label: "Checkliste", ic: "☑" },
    { id: "patients", label: "Patienten", ic: "◎" },
  ];
  if (isAdmin()) nav.push({ id: "personal", label: "Personal", ic: "◧" });
  nav.push({ id: "qm", label: "QM-Handbuch", ic: "▤" });
  nav.push({ id: "hygiene", label: "Hygiene", ic: "✚" });
  if (isAdmin()) nav.push({ id: "admin", label: "Beheer", ic: "⚙" });

  el.innerHTML = `
    <div class="brand">
      <div class="brand-mark">M</div>
      <div>
        <div class="brand-name">MD-READY</div>
        <div class="tenant-name">${state.tenant.name}</div>
      </div>
    </div>
    <nav class="primary">
      ${nav.map((n) => `<a data-route="${n.id}" class="${route === n.id ? "active" : ""}"><span class="ic">${n.ic}</span>${n.label}</a>`).join("")}
    </nav>
    <div class="sidebar-footer">
      <div class="user-switch">
        <label>Angemeldet als</label>
        <div class="current-user">
          <span class="picker-initials small">${currentUser().initials}</span>
          <span>
            <span class="cu-name">${currentUser().name}</span>
            <span class="cu-role">${currentUser().roleLabel}</span>
          </span>
        </div>
        <button class="theme-toggle" id="switch-user">Benutzer wechseln</button>
        <button class="theme-toggle" id="sign-off">Abmelden${storageMode === "file" ? " & freigeben" : ""}</button>
      </div>
      <div class="storage-badge">
        <span class="sb-where">${storageMode === "file" ? "📁 " + storageDirName : "💻 Nur dieser Computer"}</span>
        ${saveIndicatorHtml()}
        <button class="linklike" id="change-storage">Ordner wechseln</button>
      </div>
      <button class="theme-toggle" id="theme-toggle">Hell / Dunkel</button>
      <button class="theme-toggle" id="reset-demo">Demo zurücksetzen</button>
    </div>
  `;

  el.querySelectorAll("[data-route]").forEach((a) =>
    a.addEventListener("click", () => {
      route = a.dataset.route;
      render();
    })
  );
  el.querySelector("#change-storage").addEventListener("click", async () => {
    if (writePending) await flushFileWrite();
    await releaseLock();
    storageMode = "none";
    storageDir = null;
    storageReadOnly = false;
    lockSince = null;
    state = null;
    savedHandleName = (await savedDirHandle())?.name || null;
    render();
  });
  // Afmelden geeft de grendel vrij, zodat een collega er meteen in kan.
  el.querySelector("#sign-off").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    await releaseLock().catch(() => {});
    state.currentUserId = null;
    try {
      sessionStorage.removeItem(USER_KEY);
    } catch (err) {
      /* niet belangrijk */
    }
    setSaveStatus("idle");
    render();
  });
  el.querySelector("#switch-user").addEventListener("click", () => {
    state.currentUserId = null;
    try {
      sessionStorage.removeItem(USER_KEY);
    } catch (e) {
      /* niet belangrijk */
    }
    saveState();
    render();
  });
  el.querySelector("#theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme");
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  });
  el.querySelector("#reset-demo").addEventListener("click", resetDemo);

  return el;
}

function renderDashboard() {
  const wrap = document.createElement("div");
  const items = visibleItems();
  const my = items.filter((it) => it.assignees.includes(state.currentUserId));
  const today = todayStr();
  const open = items.filter((it) => !isFullyDone(it));
  const overdue = open.filter((it) => it.status !== "done" && it.deadline < today);
  const dueToday = open.filter((it) => it.status !== "done" && it.deadline === today);
  const done = items.filter((it) => isFullyDone(it));

  wrap.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="page-sub">Willkommen, ${currentUser().name} — was ist heute zu tun?</div>
      </div>
    </div>
    <div class="kpi-grid">
      ${[
        { kpi: "open", cls: "", value: open.length, label: "Offene Punkte" },
        { kpi: "done", cls: "accent", value: done.length, label: "Abgeschlossen" },
        { kpi: "today", cls: "warn", value: dueToday.length, label: "Heute fällig" },
        { kpi: "overdue", cls: "danger", value: overdue.length, label: "Frist überschritten" },
        { kpi: "mine", cls: "", value: my.filter((i) => !isFullyDone(i)).length, label: "Meine Aufgaben" },
      ]
        .map(
          (k) => `<button class="kpi-card ${k.cls}" data-kpi="${k.kpi}" title="${k.label} in der Checkliste öffnen">
            <span class="kpi-value">${k.value}</span>
            <span class="kpi-label">${k.label}</span>
            <span class="kpi-go" aria-hidden="true">›</span>
          </button>`
        )
        .join("")}
    </div>
    <h3 style="font-family:var(--font-display);font-size:16px;margin:0 0 12px;">Fortschritt pro Kategorie</h3>
    <div class="progress-list">
      ${visibleCategories()
        .map((c) => {
          const catItems = items.filter((i) => i.category === c.id);
          const pct = catItems.length ? Math.round((catItems.filter((i) => isFullyDone(i)).length / catItems.length) * 100) : 0;
          return `<div class="progress-row">
            <span>${c.label}</span>
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span class="progress-pct">${pct}%</span>
          </div>`;
        })
        .join("")}
    </div>

    <h3 style="font-family:var(--font-display);font-size:16px;margin:36px 0 12px;">Nächste MD-Kontrolle</h3>
    <div class="pd-list">
      ${(() => {
        // Alleen de eigen Pflegedienst: deze installatie is er één van één.
        const pd = state.pflegedienst;
        const info = pflegedienstInfo(pd);
        const late = info.daysLeft < 0;
        return `<div class="pd-card">
          <div class="pd-head">
            <span class="pd-name">${pd.name}</span>
            <span class="pd-days ${late ? "overdue" : ""}">${late ? "Kontrolle überfällig" : info.daysLeft + " Tage bis Kontrolle"}</span>
          </div>
          <div class="progress-track"><div class="progress-fill ${late ? "danger" : ""}" style="width:${info.pct}%"></div></div>
          <div class="pd-meta">Letzte Prüfung ${fmtDate(pd.createdAt)} · Intervall ${pd.auditIntervalMonths} Monate · Nächste Kontrolle ${fmtDate(info.nextDate)}</div>
        </div>`;
      })()}
    </div>
  `;
  wrap.querySelectorAll("[data-kpi]").forEach((b) =>
    b.addEventListener("click", () => {
      activeFilters = { ...EMPTY_FILTERS, ...KPI_FILTERS[b.dataset.kpi] };
      route = "checklist";
      openItemId = null;
      render();
    })
  );
  return wrap;
}

// De Checkliste toont alles wat deze gebruiker mag zien — ook Personal, QM en
// Hygiene. Eerder was dit alleen patiëntgebonden, waardoor een dashboardblok
// van 149 punten uitkwam op een lijst die er maar honderd kon tonen.
function filteredChecklistItems() {
  let items = visibleItems();
  const today = todayStr();
  const quick = activeFilters.quick || [];
  if (quick.includes("mine")) items = items.filter((i) => i.assignees.includes(state.currentUserId));
  if (quick.includes("open")) items = items.filter((i) => !isFullyDone(i));
  if (quick.includes("today")) items = items.filter((i) => i.status !== "done" && i.deadline === today);
  if (quick.includes("overdue")) items = items.filter((i) => i.status !== "done" && i.deadline < today);
  if (activeFilters.category) items = items.filter((i) => i.category === activeFilters.category);
  if (activeFilters.patient) items = items.filter((i) => i.linkType === "patient" && i.linkId === activeFilters.patient);
  if (activeFilters.assignee) items = items.filter((i) => i.assignees.includes(activeFilters.assignee));
  if (activeFilters.status) items = items.filter((i) => i.status === activeFilters.status);
  return items;
}

function renderChecklist() {
  const wrap = document.createElement("div");
  const shownItems = filteredChecklistItems();
  const header = document.createElement("div");
  header.className = "page-header";
  const patient = activeFilters.patient ? state.patients.find((x) => x.id === activeFilters.patient) : null;
  header.innerHTML = `
    <div>
      ${
        patient
          ? `<div class="patient-eyebrow">Checkliste</div>
             <h1 class="patient-title">${patient.name}</h1>
             <div class="page-sub">${patient.pflegegrad} · ${patient.active ? "aktiv" : "inaktiv"} · ${shownItems.length} von ${visibleItems().length} Punkten sichtbar</div>
             ${sgbVTagsHtml(patient)}`
          : `<h1>Checkliste</h1>
             <div class="page-sub">${shownItems.length} von ${visibleItems().length} Punkten sichtbar</div>`
      }
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
      ${patient ? '<button class="btn" id="clear-patient">Alle Patienten</button>' : ""}
      ${patient && isAdmin() ? '<button class="btn" id="edit-patient-btn">✎ Patient bearbeiten</button>' : ""}
      ${isAdmin() ? '<button class="btn" id="new-item-btn">+ Punkt hinzufügen</button>' : ""}
      ${isAdmin() ? '<button class="btn" id="pdf-export-btn">PDF Vorschau</button>' : ""}
      ${isAdmin() ? '<button class="btn primary" id="export-csv">Export (CSV)</button>' : ""}
    </div>
  `;
  wrap.appendChild(header);
  const clearPatientBtn = header.querySelector("#clear-patient");
  if (clearPatientBtn)
    clearPatientBtn.addEventListener("click", () => {
      activeFilters.patient = "";
      render();
    });
  const editPatientBtn = header.querySelector("#edit-patient-btn");
  if (editPatientBtn)
    editPatientBtn.addEventListener("click", () => {
      modalState = { kind: "patient-edit", id: patient.id };
      openItemId = null;
      render();
    });
  const newItemBtn = header.querySelector("#new-item-btn");
  if (newItemBtn) {
    newItemBtn.addEventListener("click", () => {
      modalState = { kind: "item-new", categoryIds: ["akte", "verwaltung"] };
      openItemId = null;
      render();
    });
  }
  const pdfBtn = header.querySelector("#pdf-export-btn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      modalState = { kind: "pdf-export", scope: "all", scopeValue: "" };
      openItemId = null;
      render();
    });
  }

  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";
  const quickFilters = [
    { id: "mine", label: "Meine Aufgaben" },
    { id: "open", label: "Offen" },
    { id: "today", label: "Heute" },
    { id: "overdue", label: "Überfällig" },
  ];
  filterBar.innerHTML = `
    ${quickFilters.map((f) => `<button class="chip ${activeFilters.quick.includes(f.id) ? "active" : ""}" data-quick="${f.id}">${f.label}</button>`).join("")}
    <select class="select-filter" id="f-category"><option value="">Alle Kategorien</option>${visibleCategories().map((c) => `<option value="${c.id}" ${activeFilters.category === c.id ? "selected" : ""}>${c.label}</option>`).join("")}</select>
    <select class="select-filter" id="f-patient"><option value="">Alle Patienten</option>${state.patients.map((p) => `<option value="${p.id}" ${activeFilters.patient === p.id ? "selected" : ""}>${p.name}</option>`).join("")}</select>
    <select class="select-filter" id="f-assignee"><option value="">Alle Verantwortlichen</option>${state.users.map((u) => `<option value="${u.id}" ${activeFilters.assignee === u.id ? "selected" : ""}>${u.name}</option>`).join("")}</select>
    <select class="select-filter" id="f-status"><option value="">Alle Status</option><option value="open" ${activeFilters.status === "open" ? "selected" : ""}>Offen</option><option value="in_progress" ${activeFilters.status === "in_progress" ? "selected" : ""}>In Bearbeitung</option><option value="done" ${activeFilters.status === "done" ? "selected" : ""}>Abgeschlossen</option></select>
  `;
  wrap.appendChild(filterBar);

  const items = shownItems;

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Punkt</th><th>Kategorie</th><th>Bezug</th><th>Verantwortlich</th><th>Frist</th><th>Status</th></tr></thead>
      <tbody>
        ${items
          .map((it) => {
            const dl = deadlineInfo(it.deadline, it.status);
            return `<tr data-item="${it.id}">
              <td>${it.label}</td>
              <td>${categoryLabel(it.category)}</td>
              <td>${itemLinkLabel(it)}</td>
              <td>${it.assignees.map((a) => `<span class="avatar">${userLabel(a).slice(0, 2).toUpperCase()}</span>`).join("")}</td>
              <td><span class="deadline-badge ${dl.cls}">${dl.label}</span></td>
              <td>${statusPillHtml(it)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-muted);padding:24px;">Keine Punkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `;
  wrap.appendChild(tableWrap);

  wrap.querySelectorAll("[data-quick]").forEach((b) =>
    b.addEventListener("click", () => {
      const q = activeFilters.quick;
      const at = q.indexOf(b.dataset.quick);
      if (at === -1) q.push(b.dataset.quick);
      else q.splice(at, 1);
      render();
    })
  );
  const bind = (id, key) =>
    wrap.querySelector(id).addEventListener("change", (e) => {
      activeFilters[key] = e.target.value;
      render();
    });
  bind("#f-category", "category");
  bind("#f-patient", "patient");
  bind("#f-assignee", "assignee");
  bind("#f-status", "status");

  wrap.querySelectorAll("[data-item]").forEach((row) =>
    row.addEventListener("click", () => {
      openItemId = row.dataset.item;
      modalState = null;
      render();
    })
  );

  if (isAdmin()) {
    wrap.querySelector("#export-csv").addEventListener("click", exportCsv);
  }

  return wrap;
}

function statusLabel(s) {
  return { open: "Offen", in_progress: "In Bearbeitung", done: "Abgeschlossen" }[s] || s;
}
function statusPillHtml(it) {
  if (isSimpleDocCategory(it.category)) {
    return it.status === "done" ? `<span class="status-pill status-done">Vorhanden</span>` : `<span class="status-pill status-open">Nicht vorhanden</span>`;
  }
  return `<span class="status-pill status-${it.status}">${statusLabel(it.status)}</span>`;
}
function renderHistoryBlock(item) {
  if (!item.history || item.history.length === 0) return "";
  const entries = [...item.history].sort((a, b) => (a.at < b.at ? 1 : -1));
  return `<div class="field-row">
    <span class="field-label">Verlauf</span>
    <div class="comment-list">
      ${entries
        .map(
          (h) => `<div class="comment" style="font-family:var(--font-mono);font-size:11.5px;">
            ${fmtDate(h.at)} · ${userLabel(h.actor)} · ${HISTORY_ACTION_LABEL[h.action] || h.action}: ${h.detail}
          </div>`
        )
        .join("")}
    </div>
  </div>`;
}

function cellDisplay(item) {
  const today = todayStr();
  if (item.status === "done") return { symbol: "✓", cls: "mx-done" };
  if (item.status === "in_progress") return { symbol: "◐", cls: "mx-progress" };
  if (item.deadline < today) return { symbol: "!", cls: "mx-overdue" };
  return { symbol: "·", cls: "mx-open" };
}

// SGB V onder de naam in de patiëntenlijst. Afkortingen omdat de kolom smal is;
// de volledige naam staat in de tooltip. "Keine" wordt uitgeschreven in plaats
// van weggelaten, zodat leeg ook echt leeg betekent en niet "nog niet ingevuld".
function sgbVTagsHtml(p) {
  const ids = p.sgbV || [];
  if (!ids.length) return `<span class="sgbv-tags"><span class="sgbv-tag none">SGB V: keine</span></span>`;
  return `<span class="sgbv-tags" title="SGB V: ${ids.map(sgbVLabel).join(", ")}">${ids
    .map((id) => `<span class="sgbv-tag">${sgbVShort(id)}</span>`)
    .join("")}</span>`;
}

function renderPatients() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="page-header">
      <div><h1>Patienten</h1><div class="page-sub">${state.patients.length} Patienten · Matrixansicht van de Patientenakte, klik een cel voor details</div></div>
      ${isAdmin() ? '<button class="btn primary" id="new-patient-btn">+ Neuer Patient</button>' : ""}
    </div>`;

  const akteLabels = itemLabelsForCategory("akte");
  const verwLabels = itemLabelsForCategory("verwaltung");

  const matrixWrap = document.createElement("div");
  matrixWrap.className = "matrix-scroll";

  const groupRow = `
    <tr class="group-row">
      <th class="corner"></th>
      <th class="col-akte" colspan="${akteLabels.length}">Patientenakte</th>
      <th class="col-verwaltung" colspan="${verwLabels.length}">Verwaltung / Abrechnung</th>
      <th class="status-col" rowspan="2">Aktenstatus</th>
    </tr>`;
  const labelRow = `
    <tr class="label-row">
      <th class="corner" style="position:sticky;left:0;top:34px;z-index:3;"></th>
      ${[...akteLabels, ...verwLabels]
        .map((l, i) => `<th class="${i < akteLabels.length ? "col-akte" : "col-verwaltung"}" title="${l}"><span class="rot">${l}</span></th>`)
        .join("")}
    </tr>`;

  const bodyRows = state.patients
    .map((p) => {
      const cells = [...akteLabels, ...verwLabels]
        .map((label, i) => {
          const cat = i < akteLabels.length ? "akte" : "verwaltung";
          const item = state.items.find((it) => it.linkType === "patient" && it.linkId === p.id && it.category === cat && it.label === label);
          if (!item) return `<td class="cell ${cat === "akte" ? "col-akte" : "col-verwaltung"}">–</td>`;
          const d = cellDisplay(item);
          const titleTxt = `${item.label} · ${statusLabel(item.status)} · Frist ${fmtDate(item.deadline)} · ${item.assignees.map(userLabel).join(", ")}`;
          return `<td class="cell ${cat === "akte" ? "col-akte" : "col-verwaltung"}"><button class="mx-btn ${d.cls}" data-item="${item.id}" title="${titleTxt}">${d.symbol}</button></td>`;
        })
        .join("");
      const agg = computeAggregateStatus("patient", p.id);
      return `<tr>
        <td class="name-cell" data-patient="${p.id}">
          <span class="pname">${p.name}</span>
          <span class="psub">${p.pflegegrad} · ${p.active ? "aktiv" : "inaktiv"}</span>
          ${sgbVTagsHtml(p)}
          ${isAdmin() ? `<button class="edit-btn" data-edit-patient="${p.id}" title="Patient bearbeiten">✎</button>` : ""}
        </td>
        ${cells}
        <td class="status-col"><span class="akte-pill akte-${agg}">${AGGREGATE_LABEL[agg]}</span></td>
      </tr>`;
    })
    .join("");

  matrixWrap.innerHTML = `<table class="matrix"><thead>${groupRow}${labelRow}</thead><tbody>${bodyRows}</tbody></table>`;
  wrap.appendChild(matrixWrap);

  const legend = document.createElement("div");
  legend.className = "matrix-legend";
  legend.innerHTML = `
    <span><span class="mx-done">✓</span> Abgeschlossen</span>
    <span><span class="mx-progress">◐</span> In Bearbeitung</span>
    <span><span class="mx-overdue">!</span> Offen, Frist überschritten</span>
    <span><span class="mx-open">·</span> Offen</span>
  `;
  wrap.appendChild(legend);

  matrixWrap.querySelectorAll("[data-patient]").forEach((cell) =>
    cell.addEventListener("click", () => {
      activeFilters = { ...EMPTY_FILTERS, patient: cell.dataset.patient };
      route = "checklist";
      render();
    })
  );
  matrixWrap.querySelectorAll("[data-item]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openItemId = btn.dataset.item;
      modalState = null;
      render();
    })
  );
  matrixWrap.querySelectorAll("[data-edit-patient]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      modalState = { kind: "patient-edit", id: btn.dataset.editPatient };
      openItemId = null;
      render();
    })
  );
  const newPatientBtn = wrap.querySelector("#new-patient-btn");
  if (newPatientBtn) {
    newPatientBtn.addEventListener("click", () => {
      modalState = { kind: "patient-new" };
      openItemId = null;
      render();
    });
  }

  return wrap;
}

function renderPersonal() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="page-header">
      <div><h1>Personal</h1><div class="page-sub">Personeelsdossiers per kwalificatiecategorie</div></div>
      <button class="btn primary" id="new-staff-btn">+ Neues Personal</button>
    </div>`;

  const tabBar = document.createElement("div");
  tabBar.className = "filter-bar";
  tabBar.innerHTML = STAFF_CATEGORIES.map((c) => `<button class="chip ${staffTab === c.id ? "active" : ""}" data-stafftab="${c.id}">${c.label}</button>`).join("");
  wrap.appendChild(tabBar);

  const labels = ITEM_DEFS.personal;
  const staffInCat = state.staff.filter((s) => s.category === staffTab);

  const matrixWrap = document.createElement("div");
  matrixWrap.className = "matrix-scroll";
  const groupRow = `<tr class="group-row"><th class="corner"></th><th class="col-akte" colspan="${labels.length}">${staffCategoryLabel(staffTab)}</th><th class="status-col" rowspan="2">Status</th></tr>`;
  const labelRow = `<tr class="label-row"><th class="corner" style="position:sticky;left:0;top:34px;z-index:3;"></th>${labels.map((l) => `<th class="col-akte" title="${l}"><span class="rot">${l}</span></th>`).join("")}</tr>`;
  const bodyRows = staffInCat
    .map((s) => {
      const cells = labels
        .map((label) => {
          const item = state.items.find((it) => it.linkType === "staff" && it.linkId === s.id && it.category === "personal" && it.label === label);
          if (!item) return `<td class="cell col-akte">–</td>`;
          const d = cellDisplay(item);
          const titleTxt = `${item.label} · ${statusLabel(item.status)} · Frist ${fmtDate(item.deadline)} · ${item.assignees.map(userLabel).join(", ")}`;
          return `<td class="cell col-akte"><button class="mx-btn ${d.cls}" data-item="${item.id}" title="${titleTxt}">${d.symbol}</button></td>`;
        })
        .join("");
      const agg = computeAggregateStatus("staff", s.id);
      return `<tr>
        <td class="name-cell">
          <span class="pname">${s.name}</span>
          <span class="psub">${s.active ? "aktiv" : "inaktiv"}</span>
          <button class="edit-btn" data-edit-staff="${s.id}" title="Personal bearbeiten">✎</button>
        </td>
        ${cells}
        <td class="status-col"><span class="akte-pill akte-${agg}">${AGGREGATE_LABEL[agg]}</span></td>
      </tr>`;
    })
    .join("");
  matrixWrap.innerHTML = `<table class="matrix"><thead>${groupRow}${labelRow}</thead><tbody>${bodyRows || `<tr><td colspan="${labels.length + 2}" style="padding:20px;text-align:center;color:var(--ink-muted);">Nog geen personeel in deze categorie.</td></tr>`}</tbody></table>`;
  wrap.appendChild(matrixWrap);

  tabBar.querySelectorAll("[data-stafftab]").forEach((b) =>
    b.addEventListener("click", () => {
      staffTab = b.dataset.stafftab;
      render();
    })
  );
  matrixWrap.querySelectorAll("[data-item]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openItemId = btn.dataset.item;
      modalState = null;
      render();
    })
  );
  matrixWrap.querySelectorAll("[data-edit-staff]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      modalState = { kind: "staff-edit", id: btn.dataset.editStaff };
      openItemId = null;
      render();
    })
  );
  wrap.querySelector("#new-staff-btn").addEventListener("click", () => {
    modalState = { kind: "staff-new", category: staffTab };
    openItemId = null;
    render();
  });

  return wrap;
}

function renderSimpleDocPage(categoryId) {
  const wrap = document.createElement("div");
  const cat = state.categories.find((c) => c.id === categoryId);
  const items = state.items.filter((it) => it.category === categoryId && it.linkType === "org");
  const doneCount = items.filter((it) => it.status === "done").length;
  // Het Hygienehandbuch heeft hoofdstukken met subpunten (uit het bronwerkboek);
  // QM is een platte lijst. Alleen bij nesting hoofdstukken vet + subpunten inspringen,
  // anders zou een platte lijst onnodig helemaal vet worden.
  const nested = items.some((it) => it.level === 2);
  wrap.innerHTML = `
    <div class="page-header">
      <div><h1>${cat.label}</h1><div class="page-sub"><span id="doc-count">${doneCount} / ${items.length}</span> vorhanden — einfache Ja/Nein-Checkliste</div></div>
      ${isAdmin() ? '<button class="btn primary" id="new-doc-item-btn">+ Punkt hinzufügen</button>' : ""}
    </div>`;

  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";
  filterBar.innerHTML = `
    <input type="search" class="select-filter doc-search" id="doc-search" placeholder="Suchen — z. B. MRSA, Norovirus, §43" />
    <select class="select-filter" id="doc-status">
      <option value="">Alle Status</option>
      <option value="done">Vorhanden</option>
      <option value="open">Nicht vorhanden</option>
    </select>
    <button class="chip" id="doc-clear">Zurücksetzen</button>
  `;
  wrap.appendChild(filterBar);

  const list = document.createElement("div");
  list.className = "table-wrap";
  list.innerHTML = `
    <table>
      <thead><tr><th>Dokument</th><th>Status</th></tr></thead>
      <tbody>
        ${items.map((it) => `<tr data-item="${it.id}" data-label="${it.label.toLowerCase()}" data-status="${it.status === "done" ? "done" : "open"}" class="${nested ? (it.level === 2 ? "doc-sub" : "doc-chapter") : ""}"><td>${it.label}</td><td>${statusPillHtml(it)}</td></tr>`).join("") || `<tr><td colspan="2" style="text-align:center;color:var(--ink-muted);padding:20px;">Noch keine Einträge.</td></tr>`}
        <tr id="doc-empty" style="display:none;"><td colspan="2" style="text-align:center;color:var(--ink-muted);padding:24px;">Keine Treffer.</td></tr>
      </tbody>
    </table>
  `;
  wrap.appendChild(list);

  // Filteren zonder render(): een volledige hertekening zou bij elke toetsaanslag
  // de focus uit het zoekveld halen. Rijen worden hier alleen verborgen.
  const rows = Array.from(list.querySelectorAll("tr[data-item]"));
  const emptyRow = list.querySelector("#doc-empty");
  const countEl = wrap.querySelector("#doc-count");
  function applyDocFilter() {
    const q = (wrap.querySelector("#doc-search").value || "").trim().toLowerCase();
    const st = wrap.querySelector("#doc-status").value;
    let shown = 0;
    let shownDone = 0;
    const keep = new Set();
    rows.forEach((row) => {
      const hit = (!q || row.dataset.label.includes(q)) && (!st || row.dataset.status === st);
      if (hit) keep.add(row);
    });
    // Een subpunt zonder zijn hoofdstuk erboven is niet te plaatsen — "MRSA" kan
    // onder Umgang mit Infektionen of onder Empfehlung RKI staan. Dus bij een
    // treffer in een subpunt blijft de hoofdstukregel zichtbaar, als context.
    if (nested) {
      let chapter = null;
      rows.forEach((row) => {
        if (row.classList.contains("doc-chapter")) chapter = row;
        // ... maar een hoofdstuk dat zelf niet aan het statusfilter voldoet blijft
        // weg. Anders staat er bij "Nicht vorhanden" een regel die wél vorhanden is.
        else if (keep.has(row) && chapter && (!st || chapter.dataset.status === st)) keep.add(chapter);
      });
    }
    rows.forEach((row) => {
      const visible = keep.has(row);
      row.style.display = visible ? "" : "none";
      if (visible) {
        shown++;
        if (row.dataset.status === "done") shownDone++;
      }
    });
    emptyRow.style.display = shown ? "none" : "";
    countEl.textContent = shown === rows.length ? `${doneCount} / ${rows.length}` : `${shownDone} / ${shown} gefiltert`;
  }
  wrap.querySelector("#doc-search").addEventListener("input", applyDocFilter);
  wrap.querySelector("#doc-status").addEventListener("change", applyDocFilter);
  wrap.querySelector("#doc-clear").addEventListener("click", () => {
    wrap.querySelector("#doc-search").value = "";
    wrap.querySelector("#doc-status").value = "";
    applyDocFilter();
  });

  rows.forEach((row) =>
    row.addEventListener("click", () => {
      openItemId = row.dataset.item;
      modalState = null;
      render();
    })
  );
  const newBtn = wrap.querySelector("#new-doc-item-btn");
  if (newBtn)
    newBtn.addEventListener("click", () => {
      modalState = { kind: "item-new", categoryIds: [categoryId] };
      openItemId = null;
      render();
    });
  return wrap;
}

function renderAdmin() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="page-header"><div><h1>Beheer</h1><div class="page-sub">Gebruikers van deze Pflegedienst (demo)</div></div></div>`;
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Naam</th><th>Rol</th><th>Toegewezen taken (open)</th></tr></thead>
      <tbody>
        ${state.users
          .map((u) => {
            const openCount = state.items.filter((i) => i.assignees.includes(u.id) && i.status !== "done").length;
            return `<tr>
              <td>${u.name}</td>
              <td><span class="role-badge ${u.role === "admin" ? "admin" : ""}">${u.roleLabel}</span></td>
              <td>${openCount}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
  wrap.appendChild(tableWrap);
  const note = document.createElement("p");
  note.style.cssText = "color:var(--ink-muted);font-size:13px;margin-top:16px;max-width:60ch;";
  note.textContent = "In dit prototype is gebruikersbeheer read-only (vaste demo-accounts). Personeelsdossiers beheer je via de pagina 'Personal'.";
  wrap.appendChild(note);
  return wrap;
}

/* ---------------- Item detail panel ---------------- */

/* ---------------- Leespaneel rechts (Outlook-stijl) ---------------- */

const PANEL_PREFS_KEY = "mdready-panel-v1";
const PANEL_MIN = 320;
const PANEL_MAX = 720;
let panelCollapsed = false;
let panelWidth = 420;

function loadPanelPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || "{}");
    if (typeof raw.collapsed === "boolean") panelCollapsed = raw.collapsed;
    if (typeof raw.width === "number") panelWidth = clampPanelWidth(raw.width);
  } catch (e) {
    /* voorkeuren zijn niet belangrijk genoeg om het opstarten te laten mislukken */
  }
  applyPanelWidth();
}
function savePanelPrefs() {
  try {
    localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ collapsed: panelCollapsed, width: panelWidth }));
  } catch (e) {
    /* privémodus: dan onthoudt hij het deze keer niet */
  }
}
// Alleen op een breed scherm staat het paneel náást de lijst; daaronder schuift
// het er nog overheen en heeft inklappen geen betekenis — je zou een leeg
// paneel overhouden. Zelfde grens als in de stylesheet.
function isPanelDocked() {
  return window.matchMedia("(min-width: 861px)").matches;
}
function clampPanelWidth(w) {
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(w)));
}
function applyPanelWidth() {
  document.documentElement.style.setProperty("--panel-width", panelWidth + "px");
}

// Slepen aan de linkerrand. Tijdens het slepen wordt alleen de CSS-variabele
// bijgewerkt — render() aanroepen per muisbeweging zou het paneel opnieuw
// opbouwen en het slepen afbreken.
function startPanelResize(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = panelWidth;
  document.body.classList.add("resizing-panel");
  const onMove = (ev) => {
    panelWidth = clampPanelWidth(startWidth + (startX - ev.clientX));
    applyPanelWidth();
  };
  const onUp = () => {
    document.body.classList.remove("resizing-panel");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    savePanelPrefs();
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function renderOverlayAndPanel() {
  // Een fragment, geen <div>: overlay en paneel worden zo directe kinderen van
  // #app en kan het paneel als kolom naast de inhoud staan in plaats van erover.
  const frag = document.createDocumentFragment();
  const item = state.items.find((i) => i.id === openItemId);

  const overlay = document.createElement("div");
  // De grijze laag hoort bij de smalle schermen, waar het paneel nog wel
  // over de lijst schuift; op een breed scherm staat het ernaast.
  overlay.className = "overlay" + (item ? " open" : "");
  overlay.addEventListener("click", () => {
    openItemId = null;
    render();
  });
  frag.appendChild(overlay);

  const panel = document.createElement("div");
  const collapsed = !!item && panelCollapsed && isPanelDocked();
  panel.className = "panel" + (item ? " open" : "") + (collapsed ? " collapsed" : "");
  if (collapsed) {
    // Ingeschoven: een smalle rand die laat zien dat er iets openstaat.
    panel.innerHTML = `
      <button class="panel-rail" id="panel-expand" title="Detailbereich ausklappen">
        <span class="rail-chevron">‹</span>
        <span class="rail-text">${item.label}</span>
      </button>`;
    panel.querySelector("#panel-expand").addEventListener("click", () => {
      panelCollapsed = false;
      savePanelPrefs();
      render();
    });
    frag.appendChild(panel);
    return frag;
  }
  if (item) {
    const dl = deadlineInfo(item.deadline, item.status);
    const simple = isSimpleDocCategory(item.category);
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>${item.label}</h2>
          <div class="page-sub">${categoryLabel(item.category)} · ${itemLinkLabel(item)}</div>
        </div>
        <div class="panel-actions">
          <button class="panel-close" id="panel-collapse" title="Detailbereich einklappen">›</button>
          <button class="panel-close" id="panel-close" title="Schließen">✕</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">Status</span>
          <div class="status-buttons">
            ${
              simple
                ? `<button data-status="open" class="${item.status === "open" ? "active" : ""}">Nicht vorhanden</button>
                   <button data-status="done" class="${item.status === "done" ? "active" : ""}">Vorhanden</button>`
                : `<button data-status="open" class="${item.status === "open" ? "active" : ""}">Offen</button>
                   <button data-status="in_progress" class="${item.status === "in_progress" ? "active" : ""}">In Bearbeitung</button>
                   <button data-status="done" class="${item.status === "done" ? "active" : ""}">Abgeschlossen</button>`
            }
          </div>
        </div>
        ${
          simple
            ? ""
            : `<div class="field-row">
          <span class="field-label">Frist</span>
          ${
            isAdmin()
              ? `<div style="display:flex;align-items:center;gap:8px;">
                  <input type="date" id="deadline-input" value="${item.deadline}" style="padding:6px 8px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:13px;" />
                  <span class="deadline-badge ${dl.cls}">${dl.label}</span>
                </div>`
              : `<span class="deadline-badge ${dl.cls}">${dl.label}</span>`
          }
        </div>
        <div class="field-row">
          <span class="field-label">Verantwortlich — klicken zum Zuweisen</span>
          <div class="filter-bar" style="margin:0;">
            ${state.users.map((u) => `<button class="chip ${item.assignees.includes(u.id) ? "active" : ""}" data-assignee="${u.id}">${u.name}</button>`).join("")}
          </div>
        </div>`
        }
        ${item.completedAt ? `<div class="field-row"><span class="field-label">Abgeschlossen</span><span>${fmtDate(item.completedAt)} von ${userLabel(item.completedBy)}</span></div>` : ""}
        ${renderHistoryBlock(item)}
        <div class="field-row">
          <span class="field-label">Kommentare</span>
          <div class="comment-list">
            ${item.comments
              .map(
                (c) => `<div class="comment">
                  <div class="comment-meta">${userLabel(c.author)} · ${fmtDate(c.createdAt)}</div>
                  ${c.text}
                </div>`
              )
              .join("") || '<div style="color:var(--ink-muted);font-size:13px;">Noch keine Kommentare.</div>'}
          </div>
          <div class="comment-form">
            <input type="text" id="comment-input" placeholder="Kommentar hinzufügen…" />
            <button class="btn primary" id="comment-submit">Senden</button>
          </div>
        </div>
      </div>
    `;

    panel.querySelector("#panel-collapse").addEventListener("click", () => {
      panelCollapsed = true;
      savePanelPrefs();
      render();
    });
    panel.querySelector("#panel-close").addEventListener("click", () => {
      openItemId = null;
      render();
    });
    panel.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => {
        item.status = b.dataset.status;
        item.updatedAt = todayStr();
        if (item.status === "done") {
          item.completedAt = todayStr();
          item.completedBy = state.currentUserId;
        } else {
          item.completedAt = null;
          item.completedBy = null;
        }
        saveState();
        render();
      })
    );
    panel.querySelectorAll("[data-assignee]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const uid = chip.dataset.assignee;
        const before = item.assignees.map(userLabel).join(", ") || "niemand";
        if (item.assignees.includes(uid)) {
          if (item.assignees.length === 1) return; // minstens één verantwoordelijke nodig
          item.assignees = item.assignees.filter((a) => a !== uid);
        } else {
          item.assignees = [...item.assignees, uid];
        }
        const after = item.assignees.map(userLabel).join(", ") || "niemand";
        logHistory(item, "assignee_changed", `${before} → ${after}`);
        item.updatedAt = todayStr();
        saveState();
        render();
      })
    );
    const deadlineInput = panel.querySelector("#deadline-input");
    if (deadlineInput && isAdmin()) {
      deadlineInput.addEventListener("change", (e) => {
        const newDeadline = e.target.value;
        if (!newDeadline || newDeadline === item.deadline) return;
        logHistory(item, "deadline_changed", `${fmtDate(item.deadline)} → ${fmtDate(newDeadline)}`);
        item.deadline = newDeadline;
        item.updatedAt = todayStr();
        saveState();
        render();
      });
    }
    panel.querySelector("#comment-submit").addEventListener("click", () => addComment(item));
    panel.querySelector("#comment-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addComment(item);
    });

    // Na het vullen van innerHTML, anders wordt de greep er meteen weer uit gegooid.
    const resizer = document.createElement("div");
    resizer.className = "panel-resizer";
    resizer.title = "Breite ziehen";
    resizer.addEventListener("mousedown", startPanelResize);
    panel.appendChild(resizer);
  }
  frag.appendChild(panel);
  return frag;
}

function logHistory(item, action, detail) {
  item.history.push({ id: "h" + Date.now() + Math.random().toString(16).slice(2), actor: state.currentUserId, action, detail, at: todayStr() });
}
const HISTORY_ACTION_LABEL = { deadline_changed: "Frist geändert", assignee_changed: "Verantwortlich geändert" };

function addComment(item) {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text) return;
  item.comments.push({ id: "c" + Date.now(), author: state.currentUserId, text, createdAt: todayStr() });
  saveState();
  render();
}

/* ---------------- Toevoegen/wijzigen (Admin) ---------------- */

const INPUT_STYLE = "width:100%;padding:8px 10px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:13.5px;";
let adhocCounter = 1;
function nextAdhocId() {
  return "x" + Date.now().toString(36) + adhocCounter++;
}

function addChecklistItemDefinition(categoryId, label) {
  const cat = state.categories.find((c) => c.id === categoryId);
  const targets = cat.scope === "patient" ? state.patients.map((p) => p.id) : cat.scope === "staff" ? state.staff.map((s) => s.id) : [null];
  const linkType = cat.scope === "patient" ? "patient" : cat.scope === "staff" ? "staff" : "org";
  targets.forEach((linkId) => {
    state.items.push(blankChecklistItem(nextAdhocId(), categoryId, label, linkType, linkId, state.currentUserId));
  });
  saveState();
}

function renderModalPanel() {
  const frag = document.createElement("div");
  if (!modalState || !isAdmin()) return frag;

  const overlay = document.createElement("div");
  overlay.className = "overlay open";
  overlay.addEventListener("click", () => {
    modalState = null;
    render();
  });
  frag.appendChild(overlay);

  const panel = document.createElement("div");
  panel.className = "panel open";
  if (modalState.kind === "item-new") panel.innerHTML = newItemFormHtml();
  else if (modalState.kind === "patient-new" || modalState.kind === "patient-edit") panel.innerHTML = patientFormHtml(modalState.kind === "patient-edit" ? state.patients.find((p) => p.id === modalState.id) : null);
  else if (modalState.kind === "staff-new" || modalState.kind === "staff-edit") panel.innerHTML = staffFormHtml(modalState.kind === "staff-edit" ? state.staff.find((s) => s.id === modalState.id) : null);
  else if (modalState.kind === "pdf-export") panel.innerHTML = pdfExportFormHtml();
  frag.appendChild(panel);

  const closeBtn = panel.querySelector("#modal-close");
  if (closeBtn)
    closeBtn.addEventListener("click", () => {
      modalState = null;
      render();
    });

  const pfSubmit = panel.querySelector("#pf-submit");
  if (pfSubmit) {
    pfSubmit.addEventListener("click", () => {
      const name = panel.querySelector("#pf-name").value.trim();
      if (!name) return;
      const pflegegrad = panel.querySelector("#pf-pflegegrad").value;
      const active = panel.querySelector("#pf-active").value === "true";
      const checked = Array.from(panel.querySelectorAll(".pf-sgbv:checked")).map((c) => c.value);
      const sgbV = SGB_V_LEISTUNGEN.filter((l) => checked.includes(l.id)).map((l) => l.id);
      if (modalState.kind === "patient-edit") {
        const p = state.patients.find((x) => x.id === modalState.id);
        p.name = name;
        p.pflegegrad = pflegegrad;
        p.active = active;
        p.sgbV = sgbV;
      } else {
        const id = "p" + Date.now().toString(36);
        state.patients.push({ id, name, pflegegrad, active, sgbV });
        state.items.push(...createPatientChecklistItems(id, state.currentUserId));
      }
      saveState();
      modalState = null;
      render();
    });
  }

  const sfSubmit = panel.querySelector("#sf-submit");
  if (sfSubmit) {
    sfSubmit.addEventListener("click", () => {
      const name = panel.querySelector("#sf-name").value.trim();
      if (!name) return;
      const category = panel.querySelector("#sf-category").value;
      const active = panel.querySelector("#sf-active").value === "true";
      if (modalState.kind === "staff-edit") {
        const s = state.staff.find((x) => x.id === modalState.id);
        s.name = name;
        s.category = category;
        s.active = active;
      } else {
        const id = "s" + Date.now().toString(36);
        state.staff.push({ id, name, category, active });
        state.items.push(...createStaffChecklistItems(id, state.currentUserId));
        staffTab = category;
      }
      saveState();
      modalState = null;
      render();
    });
  }

  const ifSubmit = panel.querySelector("#if-submit");
  if (ifSubmit) {
    ifSubmit.addEventListener("click", () => {
      const categoryId = panel.querySelector("#if-category").value;
      const label = panel.querySelector("#if-label").value.trim();
      if (!label) return;
      addChecklistItemDefinition(categoryId, label);
      modalState = null;
      render();
    });
  }

  const pdfScope = panel.querySelector("#pdf-scope");
  if (pdfScope) {
    pdfScope.addEventListener("change", (e) => {
      modalState.scope = e.target.value;
      modalState.scopeValue = modalState.scope === "patient" ? (state.patients[0] ? state.patients[0].id : "") : modalState.scope === "category" ? "akte" : "";
      render();
    });
  }
  const pdfScopeValue = panel.querySelector("#pdf-scopevalue");
  if (pdfScopeValue) {
    pdfScopeValue.addEventListener("change", (e) => {
      modalState.scopeValue = e.target.value;
      render();
    });
  }
  const pdfPrint = panel.querySelector("#pdf-print");
  if (pdfPrint) {
    pdfPrint.addEventListener("click", () => {
      document.getElementById("print-area").innerHTML = printReportHtml(modalState.scope || "all", modalState.scopeValue || "");
      window.print();
    });
  }

  return frag;
}

function patientFormHtml(existing) {
  const isEdit = !!existing;
  const pgOptions = ["PG 1", "PG 2", "PG 3", "PG 4", "PG 5", "kein PG"];
  return `
    <div class="panel-header">
      <div><h2>${isEdit ? "Patient bearbeiten" : "Neuer Patient"}</h2><div class="page-sub">${isEdit ? existing.name : "Legt automatisch de standaard Patientenakte- en Verwaltungspunten aan"}</div></div>
      <button class="panel-close" id="modal-close">✕</button>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <span class="field-label">Name</span>
        <input type="text" id="pf-name" value="${isEdit ? existing.name : ""}" style="${INPUT_STYLE}" placeholder="Vor- und Nachname" />
      </div>
      <div class="field-row">
        <span class="field-label">Pflegegrad</span>
        <select id="pf-pflegegrad" style="${INPUT_STYLE}">
          ${pgOptions.map((pg) => `<option value="${pg}" ${isEdit && existing.pflegegrad === pg ? "selected" : ""}>${pg}</option>`).join("")}
        </select>
      </div>
      <div class="field-row">
        <span class="field-label">Status</span>
        <select id="pf-active" style="${INPUT_STYLE}">
          <option value="true" ${!isEdit || existing.active ? "selected" : ""}>Aktiv</option>
          <option value="false" ${isEdit && !existing.active ? "selected" : ""}>Inaktiv</option>
        </select>
      </div>
      <div class="field-row col">
        <span class="field-label">SGB V — Behandlungspflege</span>
        <div class="sgbv-picker">
          ${SGB_V_LEISTUNGEN.map(
            (l) => `<label class="sgbv-option">
              <input type="checkbox" class="pf-sgbv" value="${l.id}" ${isEdit && (existing.sgbV || []).includes(l.id) ? "checked" : ""} />
              <span>${l.label}</span>
            </label>`
          ).join("")}
        </div>
      </div>
      <button class="btn primary" id="pf-submit">${isEdit ? "Speichern" : "Patient anlegen"}</button>
    </div>
  `;
}

function staffFormHtml(existing) {
  const isEdit = !!existing;
  const defaultCategory = isEdit ? existing.category : modalState.category || STAFF_CATEGORIES[0].id;
  return `
    <div class="panel-header">
      <div><h2>${isEdit ? "Personal bearbeiten" : "Neues Personal"}</h2><div class="page-sub">${isEdit ? existing.name : "Legt automatisch die Standard-Personalpunkte an"}</div></div>
      <button class="panel-close" id="modal-close">✕</button>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <span class="field-label">Name</span>
        <input type="text" id="sf-name" value="${isEdit ? existing.name : ""}" style="${INPUT_STYLE}" placeholder="Vor- und Nachname" />
      </div>
      <div class="field-row">
        <span class="field-label">Kategorie</span>
        <select id="sf-category" style="${INPUT_STYLE}">
          ${STAFF_CATEGORIES.map((c) => `<option value="${c.id}" ${defaultCategory === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
        </select>
      </div>
      <div class="field-row">
        <span class="field-label">Status</span>
        <select id="sf-active" style="${INPUT_STYLE}">
          <option value="true" ${!isEdit || existing.active ? "selected" : ""}>Aktiv</option>
          <option value="false" ${isEdit && !existing.active ? "selected" : ""}>Inaktiv</option>
        </select>
      </div>
      <button class="btn primary" id="sf-submit">${isEdit ? "Speichern" : "Personal anlegen"}</button>
    </div>
  `;
}

function newItemFormHtml() {
  const categoryIds = modalState.categoryIds || ["akte", "verwaltung"];
  const options = state.categories.filter((c) => categoryIds.includes(c.id));
  const showSelect = options.length > 1;
  return `
    <div class="panel-header">
      <div><h2>Neuer Checklistpunkt</h2><div class="page-sub">Wordt toegevoegd voor alle bestaande patiënten/personeel in deze categorie</div></div>
      <button class="panel-close" id="modal-close">✕</button>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <span class="field-label">Kategorie</span>
        ${
          showSelect
            ? `<select id="if-category" style="${INPUT_STYLE}">${options.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}</select>`
            : `<input type="hidden" id="if-category" value="${options[0].id}" /><div style="${INPUT_STYLE}background:var(--surface-2);">${options[0].label}</div>`
        }
      </div>
      <div class="field-row">
        <span class="field-label">Bezeichnung</span>
        <input type="text" id="if-label" placeholder="z. B. Sturzrisiko-Assessment" style="${INPUT_STYLE}" />
      </div>
      <button class="btn primary" id="if-submit">Punkt hinzufügen</button>
    </div>
  `;
}


/* ---------------- PDF-export / afdrukken ---------------- */

function buildPrintSelection(scope, scopeValue) {
  let items;
  let title = "MD-READY – Gesamtübersicht Patientenakten";
  if (scope === "patient") {
    const p = state.patients.find((x) => x.id === scopeValue);
    items = state.items.filter((it) => it.linkType === "patient" && it.linkId === scopeValue);
    title = `MD-READY – Patientenakte: ${p ? p.name : ""}`;
  } else if (scope === "category") {
    items = state.items.filter((it) => it.category === scopeValue);
    title = `MD-READY – Übersicht: ${categoryLabel(scopeValue)}`;
  } else {
    items = patientScopedItems();
  }
  return { title, items };
}
function printReportHtml(scope, scopeValue) {
  const { title, items } = buildPrintSelection(scope, scopeValue);
  const rows = items
    .map(
      (it) => `<tr>
        <td>${it.label}</td><td>${categoryLabel(it.category)}</td><td>${itemLinkLabel(it)}</td>
        <td>${it.assignees.map(userLabel).join(", ") || "–"}</td><td>${fmtDate(it.deadline)}</td><td>${statusLabel(it.status)}</td>
      </tr>`
    )
    .join("");
  return `
    <h1>${title}</h1>
    <p>Erstellt am ${fmtDate(todayStr())} · ${items.length} Punkte</p>
    <table>
      <thead><tr><th>Punkt</th><th>Kategorie</th><th>Bezug</th><th>Verantwortlich</th><th>Frist</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">Keine Punkte.</td></tr>'}</tbody>
    </table>
  `;
}
function pdfExportFormHtml() {
  const scope = modalState.scope || "all";
  const scopeValue = modalState.scopeValue || "";
  return `
    <div class="panel-header">
      <div><h2>PDF-Export</h2><div class="page-sub">Voorbeeld — druk af of bewaar als PDF via het printvenster</div></div>
      <button class="panel-close" id="modal-close">✕</button>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <span class="field-label">Bereik</span>
        <select id="pdf-scope" style="${INPUT_STYLE}">
          <option value="all" ${scope === "all" ? "selected" : ""}>Alle patiënten</option>
          <option value="patient" ${scope === "patient" ? "selected" : ""}>Eén patiënt</option>
          <option value="category" ${scope === "category" ? "selected" : ""}>Categorie</option>
        </select>
      </div>
      ${
        scope === "patient"
          ? `<div class="field-row"><span class="field-label">Patiënt</span><select id="pdf-scopevalue" style="${INPUT_STYLE}">${state.patients.map((p) => `<option value="${p.id}" ${scopeValue === p.id ? "selected" : ""}>${p.name}</option>`).join("")}</select></div>`
          : ""
      }
      ${
        scope === "category"
          ? `<div class="field-row"><span class="field-label">Categorie</span><select id="pdf-scopevalue" style="${INPUT_STYLE}">${state.categories.map((c) => `<option value="${c.id}" ${scopeValue === c.id ? "selected" : ""}>${c.label}</option>`).join("")}</select></div>`
          : ""
      }
      <div class="field-row">
        <span class="field-label">Voorbeeld</span>
        <div class="pdf-preview">${printReportHtml(scope, scopeValue)}</div>
      </div>
      <button class="btn primary" id="pdf-print">Drucken / Als PDF exportieren</button>
    </div>
  `;
}

/* ---------------- CSV export ---------------- */

function exportCsv() {
  const rows = [["Punkt", "Kategorie", "Bezug", "Verantwortlich", "Frist", "Status"]];
  filteredChecklistItems().forEach((it) => {
    rows.push([it.label, categoryLabel(it.category), itemLinkLabel(it), it.assignees.map(userLabel).join("/"), it.deadline, statusLabel(it.status)]);
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mdready-checkliste.csv";
  a.click();
  URL.revokeObjectURL(url);
}

boot();
