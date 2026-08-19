/* MD-READY Prototyp — Frontend-only Demo (kein Backend, localStorage) */

const STORAGE_KEY = "mdready-demo-state-v1";
let state = loadState();
let route = "dashboard";
let activeFilters = { quick: null, patient: "", category: "", assignee: "", status: "" };
let openItemId = null;

function loadState() {
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
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function resetDemo() {
  if (!confirm("Demo-Daten zurücksetzen? Alle Änderungen gehen verloren.")) return;
  state = seedState();
  saveState();
  render();
}

function currentUser() {
  return state.users.find((u) => u.id === state.currentUserId);
}
function isAdmin() {
  return currentUser().role === "admin";
}
function todayStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
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
function categoryLabel(id) {
  const c = state.categories.find((x) => x.id === id);
  return c ? c.label : id;
}
function visibleCategories() {
  if (isAdmin()) return state.categories;
  return state.categories.filter((c) => c.id !== "personal");
}
function visibleItems() {
  const catIds = visibleCategories().map((c) => c.id);
  return state.items.filter((it) => catIds.includes(it.category));
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
  if (item.linkType === "employee") return userLabel(item.linkId);
  return "Organisation";
}
function isFullyDone(item) {
  return item.status === "done" && (!item.nachkontrolleRequired || item.nachkontrolleDone);
}
function computeAggregateStatus(patientId) {
  const items = state.items.filter((it) => it.linkType === "patient" && it.linkId === patientId);
  if (items.length === 0) return "korrektur";
  if (items.every((it) => isFullyDone(it))) return "vollstaendig";
  const today = todayStr();
  // "Dringend" geldt alleen voor punten die echt nog niet gedaan zijn
  // (open/in behandeling) — een afgerond item dat op Nachkontrolle wacht
  // is geen verwaarloosd punt, dus telt hier niet mee.
  const hasCritical = items.some((it) => it.status !== "done" && (it.deadline < today || (it.priority === "high" && it.deadline <= today)));
  if (hasCritical) return "dringend";
  return "korrektur";
}
const AGGREGATE_LABEL = { vollstaendig: "Vollständig", korrektur: "Korrektur erforderlich", dringend: "Dringend" };

/* ---------------- Rendering ---------------- */

function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(renderSidebar());

  const main = document.createElement("div");
  main.className = "main";
  if (route === "dashboard") main.appendChild(renderDashboard());
  else if (route === "checklist") main.appendChild(renderChecklist());
  else if (route === "patients") main.appendChild(renderPatients());
  else if (route === "calls") main.appendChild(renderCalls());
  else if (route === "admin" && isAdmin()) main.appendChild(renderAdmin());
  else { route = "dashboard"; main.appendChild(renderDashboard()); }
  app.appendChild(main);

  app.appendChild(renderOverlayAndPanel());
}

function renderSidebar() {
  const el = document.createElement("div");
  el.className = "sidebar";

  const nav = [
    { id: "dashboard", label: "Dashboard", ic: "◆" },
    { id: "checklist", label: "Checkliste", ic: "☑" },
    { id: "patients", label: "Patienten", ic: "◎" },
    { id: "calls", label: "Anrufe", ic: "☎" },
  ];
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
        <select id="user-select">
          ${state.users.map((u) => `<option value="${u.id}" ${u.id === state.currentUserId ? "selected" : ""}>${u.name} — ${u.roleLabel}</option>`).join("")}
        </select>
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
  el.querySelector("#user-select").addEventListener("change", (e) => {
    state.currentUserId = e.target.value;
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
  const pendingNachkontrolle = items.filter((it) => it.status === "done" && it.nachkontrolleRequired && !it.nachkontrolleDone);

  wrap.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="page-sub">Willkommen, ${currentUser().name} — was ist heute zu tun?</div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${open.length}</div><div class="kpi-label">Offene Punkte</div></div>
      <div class="kpi-card accent"><div class="kpi-value">${done.length}</div><div class="kpi-label">Abgeschlossen</div></div>
      <div class="kpi-card warn"><div class="kpi-value">${pendingNachkontrolle.length}</div><div class="kpi-label">Nachkontrolle ausstehend</div></div>
      <div class="kpi-card warn"><div class="kpi-value">${dueToday.length}</div><div class="kpi-label">Heute fällig</div></div>
      <div class="kpi-card danger"><div class="kpi-value">${overdue.length}</div><div class="kpi-label">Frist überschritten</div></div>
      <div class="kpi-card"><div class="kpi-value">${my.filter((i) => !isFullyDone(i)).length}</div><div class="kpi-label">Meine Aufgaben</div></div>
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
  `;
  return wrap;
}

function renderChecklist() {
  const wrap = document.createElement("div");
  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <div>
      <h1>Checkliste</h1>
      <div class="page-sub">${visibleItems().length} Punkte sichtbar</div>
    </div>
    ${isAdmin() ? '<button class="btn primary" id="export-csv">Export (CSV)</button>' : ""}
  `;
  wrap.appendChild(header);

  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";
  const quickFilters = [
    { id: "mine", label: "Meine Aufgaben" },
    { id: "open", label: "Offen" },
    { id: "today", label: "Heute" },
    { id: "overdue", label: "Frist überschritten" },
  ];
  filterBar.innerHTML = `
    ${quickFilters.map((f) => `<button class="chip ${activeFilters.quick === f.id ? "active" : ""}" data-quick="${f.id}">${f.label}</button>`).join("")}
    <select class="select-filter" id="f-category"><option value="">Alle Kategorien</option>${visibleCategories().map((c) => `<option value="${c.id}" ${activeFilters.category === c.id ? "selected" : ""}>${c.label}</option>`).join("")}</select>
    <select class="select-filter" id="f-patient"><option value="">Alle Patienten</option>${state.patients.map((p) => `<option value="${p.id}" ${activeFilters.patient === p.id ? "selected" : ""}>${p.name}</option>`).join("")}</select>
    <select class="select-filter" id="f-assignee"><option value="">Alle Verantwortlichen</option>${state.users.map((u) => `<option value="${u.id}" ${activeFilters.assignee === u.id ? "selected" : ""}>${u.name}</option>`).join("")}</select>
    <select class="select-filter" id="f-status"><option value="">Alle Status</option><option value="open" ${activeFilters.status === "open" ? "selected" : ""}>Offen</option><option value="in_progress" ${activeFilters.status === "in_progress" ? "selected" : ""}>In Bearbeitung</option><option value="done" ${activeFilters.status === "done" ? "selected" : ""}>Abgeschlossen</option></select>
  `;
  wrap.appendChild(filterBar);

  let items = visibleItems();
  const today = todayStr();
  if (activeFilters.quick === "mine") items = items.filter((i) => i.assignees.includes(state.currentUserId));
  if (activeFilters.quick === "open") items = items.filter((i) => !isFullyDone(i));
  if (activeFilters.quick === "today") items = items.filter((i) => i.status !== "done" && i.deadline === today);
  if (activeFilters.quick === "overdue") items = items.filter((i) => i.status !== "done" && i.deadline < today);
  if (activeFilters.category) items = items.filter((i) => i.category === activeFilters.category);
  if (activeFilters.patient) items = items.filter((i) => i.linkType === "patient" && i.linkId === activeFilters.patient);
  if (activeFilters.assignee) items = items.filter((i) => i.assignees.includes(activeFilters.assignee));
  if (activeFilters.status) items = items.filter((i) => i.status === activeFilters.status);

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
      activeFilters.quick = activeFilters.quick === b.dataset.quick ? null : b.dataset.quick;
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
  if (it.status === "done" && it.nachkontrolleRequired && !it.nachkontrolleDone) {
    return `<span class="status-pill status-in_progress">Nachkontrolle ausstehend</span>`;
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
function renderNachkontrolleBlock(item) {
  if (item.nachkontrolleDone) {
    return `<div class="field-row">
      <span class="field-label">Nachkontrolle</span>
      <span>Bestätigt am ${fmtDate(item.nachkontrolleAt)} von ${userLabel(item.nachkontrolleBy)}</span>
    </div>`;
  }
  const sameUser = state.currentUserId === item.completedBy;
  return `<div class="field-row">
    <span class="field-label">Nachkontrolle</span>
    <div style="background:var(--amber-soft);color:var(--amber);border-radius:7px;padding:9px 11px;font-size:12.5px;">
      Noch nicht bestätigt. Vier-Augen-Prinzip: eine andere Person als ${userLabel(item.completedBy)} muss dies bestätigen.
    </div>
    <button class="btn primary" id="confirm-nachkontrolle" ${sameUser ? "disabled title=\"Nicht durch dieselbe Person möglich\"" : ""} style="margin-top:6px;">
      Nachkontrolle bestätigen (als ${currentUser().name})
    </button>
  </div>`;
}

function cellDisplay(item) {
  const today = todayStr();
  if (isFullyDone(item)) return { symbol: "✓", cls: "mx-done" };
  if (item.status === "done") return { symbol: "✓", cls: "mx-pending" };
  if (item.status === "in_progress") return { symbol: "◐", cls: "mx-progress" };
  if (item.deadline < today) return { symbol: "!", cls: "mx-overdue" };
  return { symbol: "·", cls: "mx-open" };
}

function renderPatients() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="page-header"><div><h1>Patienten</h1><div class="page-sub">${state.patients.length} Patienten · Matrixansicht van de Patientenakte, klik een cel voor details</div></div></div>`;

  const akteLabels = itemLabelsForCategory("akte");
  const verwLabels = itemLabelsForCategory("verwaltung");

  const matrixWrap = document.createElement("div");
  matrixWrap.className = "matrix-scroll";

  const groupRow = `
    <tr class="group-row">
      <th class="corner"></th>
      <th colspan="${akteLabels.length}">Patientenakte</th>
      <th colspan="${verwLabels.length}">Verwaltung / Abrechnung</th>
      <th class="status-col" rowspan="2">Aktenstatus</th>
    </tr>`;
  const labelRow = `
    <tr class="label-row">
      <th class="corner" style="position:sticky;left:0;top:28px;z-index:3;"></th>
      ${[...akteLabels, ...verwLabels].map((l) => `<th title="${l}"><span class="rot">${l}</span></th>`).join("")}
    </tr>`;

  const bodyRows = state.patients
    .map((p) => {
      const cells = [...akteLabels, ...verwLabels]
        .map((label, i) => {
          const cat = i < akteLabels.length ? "akte" : "verwaltung";
          const item = state.items.find((it) => it.linkType === "patient" && it.linkId === p.id && it.category === cat && it.label === label);
          if (!item) return `<td class="cell">–</td>`;
          const d = cellDisplay(item);
          const dl = deadlineInfo(item.deadline, item.status);
          const titleTxt = `${item.label} · ${statusLabel(item.status)} · Frist ${fmtDate(item.deadline)} · ${item.assignees.map(userLabel).join(", ")}${item.status === "done" && !item.nachkontrolleDone ? " · Nachkontrolle ausstehend" : ""}`;
          return `<td class="cell"><button class="mx-btn ${d.cls}" data-item="${item.id}" title="${titleTxt}">${d.symbol}</button></td>`;
        })
        .join("");
      const agg = computeAggregateStatus(p.id);
      return `<tr>
        <td class="name-cell" data-patient="${p.id}">
          <span class="pname">${p.name}</span>
          <span class="psub">${p.pflegegrad} · ${p.active ? "aktiv" : "inaktiv"}</span>
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
    <span><span class="mx-pending">✓</span> Nachkontrolle ausstehend</span>
    <span><span class="mx-progress">◐</span> In Bearbeitung</span>
    <span><span class="mx-overdue">!</span> Offen, Frist überschritten</span>
    <span><span class="mx-open">·</span> Offen</span>
  `;
  wrap.appendChild(legend);

  matrixWrap.querySelectorAll("[data-patient]").forEach((cell) =>
    cell.addEventListener("click", () => {
      activeFilters = { quick: null, patient: cell.dataset.patient, category: "", assignee: "", status: "" };
      route = "checklist";
      render();
    })
  );
  matrixWrap.querySelectorAll("[data-item]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openItemId = btn.dataset.item;
      render();
    })
  );

  return wrap;
}

function renderCalls() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="page-header"><div><h1>Telefon-Absagen / Anrufe</h1><div class="page-sub">Log van telefonische patiëntcontacten (Beispieldaten)</div></div></div>`;

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";
  const rows = [...state.calls].sort((a, b) => (a.date < b.date ? 1 : -1));
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Datum</th><th>Patient</th><th>Grund</th><th>Gesprächspartner</th><th>Ergebnis</th><th>Weitere Aktion</th></tr></thead>
      <tbody>
        ${rows
          .map((c) => {
            const p = state.patients.find((x) => x.id === c.patientId);
            return `<tr>
              <td>${fmtDate(c.date)}</td>
              <td>${p ? p.name : "–"}</td>
              <td>${c.reason}</td>
              <td>${c.contact}</td>
              <td>${c.result}</td>
              <td>${c.followUp}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-muted);padding:24px;">Nog geen gesprekken geregistreerd.</td></tr>`}
      </tbody>
    </table>
  `;
  wrap.appendChild(tableWrap);

  const formWrap = document.createElement("div");
  formWrap.style.cssText = "margin-top:20px;max-width:520px;display:flex;flex-direction:column;gap:8px;";
  formWrap.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:15px;margin:0;">Neuer Eintrag</h3>
    <select class="select-filter" id="call-patient">${state.patients.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
    <input class="select-filter" id="call-reason" placeholder="Grund des Anrufs" />
    <input class="select-filter" id="call-contact" placeholder="Gesprächspartner" />
    <input class="select-filter" id="call-result" placeholder="Ergebnis" />
    <input class="select-filter" id="call-followup" placeholder="Weitere Aktion" />
    <button class="btn primary" id="call-submit" style="align-self:flex-start;">Eintrag speichern</button>
  `;
  wrap.appendChild(formWrap);

  wrap.querySelector("#call-submit").addEventListener("click", () => {
    const reason = wrap.querySelector("#call-reason").value.trim();
    if (!reason) return;
    state.calls.push({
      id: "call" + Date.now(),
      patientId: wrap.querySelector("#call-patient").value,
      date: todayStr(),
      reason,
      contact: wrap.querySelector("#call-contact").value.trim() || "–",
      result: wrap.querySelector("#call-result").value.trim() || "–",
      followUp: wrap.querySelector("#call-followup").value.trim() || "–",
    });
    saveState();
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
  note.textContent = "In dit prototype is gebruikersbeheer read-only (twee vaste demo-accounts). Aanmaken/bewerken van gebruikers volgt zodra het backend/datamodel is uitgewerkt.";
  wrap.appendChild(note);
  return wrap;
}

/* ---------------- Item detail panel ---------------- */

function renderOverlayAndPanel() {
  const frag = document.createElement("div");
  const item = state.items.find((i) => i.id === openItemId);

  const overlay = document.createElement("div");
  overlay.className = "overlay" + (item ? " open" : "");
  overlay.addEventListener("click", () => {
    openItemId = null;
    render();
  });
  frag.appendChild(overlay);

  const panel = document.createElement("div");
  panel.className = "panel" + (item ? " open" : "");
  if (item) {
    const dl = deadlineInfo(item.deadline, item.status);
    panel.innerHTML = `
      <div class="panel-header">
        <div>
          <h2>${item.label}</h2>
          <div class="page-sub">${categoryLabel(item.category)} · ${itemLinkLabel(item)}</div>
        </div>
        <button class="panel-close" id="panel-close">✕</button>
      </div>
      <div class="panel-body">
        <div class="field-row">
          <span class="field-label">Status</span>
          <div class="status-buttons">
            <button data-status="open" class="${item.status === "open" ? "active" : ""}">Offen</button>
            <button data-status="in_progress" class="${item.status === "in_progress" ? "active" : ""}">In Bearbeitung</button>
            <button data-status="done" class="${item.status === "done" ? "active" : ""}">Abgeschlossen</button>
          </div>
        </div>
        <div class="field-row">
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
          <span class="field-label">Verantwortlich</span>
          <span>${item.assignees.map((a) => userLabel(a)).join(", ")}</span>
        </div>
        ${item.completedAt ? `<div class="field-row"><span class="field-label">Abgeschlossen</span><span>${fmtDate(item.completedAt)} von ${userLabel(item.completedBy)}</span></div>` : ""}
        ${item.status === "done" && item.nachkontrolleRequired ? renderNachkontrolleBlock(item) : ""}
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
          item.nachkontrolleDone = false;
          item.nachkontrolleBy = null;
          item.nachkontrolleAt = null;
        } else {
          item.completedAt = null;
          item.completedBy = null;
          item.nachkontrolleDone = false;
          item.nachkontrolleBy = null;
          item.nachkontrolleAt = null;
        }
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
    const confirmBtn = panel.querySelector("#confirm-nachkontrolle");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (state.currentUserId === item.completedBy) return;
        item.nachkontrolleDone = true;
        item.nachkontrolleBy = state.currentUserId;
        item.nachkontrolleAt = todayStr();
        saveState();
        render();
      });
    }
    panel.querySelector("#comment-submit").addEventListener("click", () => addComment(item));
    panel.querySelector("#comment-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addComment(item);
    });
  }
  frag.appendChild(panel);
  return frag;
}

function logHistory(item, action, detail) {
  item.history.push({ id: "h" + Date.now() + Math.random().toString(16).slice(2), actor: state.currentUserId, action, detail, at: todayStr() });
}
const HISTORY_ACTION_LABEL = { deadline_changed: "Frist geändert" };

function addComment(item) {
  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text) return;
  item.comments.push({ id: "c" + Date.now(), author: state.currentUserId, text, createdAt: todayStr() });
  saveState();
  render();
}

/* ---------------- CSV export ---------------- */

function exportCsv() {
  const rows = [["Punkt", "Kategorie", "Bezug", "Verantwortlich", "Frist", "Status", "Nachkontrolle"]];
  visibleItems().forEach((it) => {
    const nk = !it.nachkontrolleRequired ? "n/a" : it.nachkontrolleDone ? `bestätigt (${userLabel(it.nachkontrolleBy)})` : "ausstehend";
    rows.push([it.label, categoryLabel(it.category), itemLinkLabel(it), it.assignees.map(userLabel).join("/"), it.deadline, statusLabel(it.status), nk]);
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

render();
