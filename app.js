/* MD-READY Prototyp — Frontend-only Demo (kein Backend, localStorage) */

const STORAGE_KEY = "mdready-demo-state-v1";
let state = loadState();
let route = "dashboard";
let activeFilters = { quick: null, patient: "", category: "", assignee: "", status: "" };
let openItemId = null;
let staffTab = "examinierte";
// { kind: "patient-new"|"patient-edit"|"staff-new"|"staff-edit"|"item-new"|"pflegedienst-new"|"pdf-export", id?, category?, categoryIds?, scope?, scopeValue? }
let modalState = null;

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
  app.appendChild(renderSidebar());

  const main = document.createElement("div");
  main.className = "main";
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

    <div class="page-header" style="margin-top:36px;">
      <h3 style="font-family:var(--font-display);font-size:16px;margin:0;">Pflegedienste — MD-Kontrollen</h3>
      ${isAdmin() ? '<button class="btn primary" id="new-pd-btn">+ Neuer Dienst</button>' : ""}
    </div>
    <div class="pd-list">
      ${state.pflegedienste
        .map((pd) => {
          const info = pflegedienstInfo(pd);
          const overdueDienst = info.daysLeft < 0;
          return `<div class="pd-card">
            <div class="pd-head">
              <span class="pd-name">${pd.name}</span>
              <span class="pd-days ${overdueDienst ? "overdue" : ""}">${overdueDienst ? "Kontrolle überfällig" : info.daysLeft + " Tage bis Kontrolle"}</span>
            </div>
            <div class="progress-track"><div class="progress-fill ${overdueDienst ? "danger" : ""}" style="width:${info.pct}%"></div></div>
            <div class="pd-meta">Erstellt am ${fmtDate(pd.createdAt)} · Intervall ${pd.auditIntervalMonths} Monate · Nächste Kontrolle ${fmtDate(info.nextDate)}</div>
          </div>`;
        })
        .join("") || '<p style="color:var(--ink-muted);font-size:13px;">Noch keine Pflegedienste angelegt.</p>'}
    </div>
  `;
  const newPdBtn = wrap.querySelector("#new-pd-btn");
  if (newPdBtn) newPdBtn.addEventListener("click", () => { modalState = { kind: "pflegedienst-new" }; render(); });
  return wrap;
}

function renderChecklist() {
  const wrap = document.createElement("div");
  const header = document.createElement("div");
  header.className = "page-header";
  header.innerHTML = `
    <div>
      <h1>Checkliste</h1>
      <div class="page-sub">Patientenakte — ${patientScopedItems().length} Punkte sichtbar</div>
    </div>
    <div style="display:flex;gap:8px;">
      ${isAdmin() ? '<button class="btn" id="new-item-btn">+ Punkt hinzufügen</button>' : ""}
      ${isAdmin() ? '<button class="btn" id="pdf-export-btn">PDF Vorschau</button>' : ""}
      ${isAdmin() ? '<button class="btn primary" id="export-csv">Export (CSV)</button>' : ""}
    </div>
  `;
  wrap.appendChild(header);
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
  ];
  filterBar.innerHTML = `
    ${quickFilters.map((f) => `<button class="chip ${activeFilters.quick === f.id ? "active" : ""}" data-quick="${f.id}">${f.label}</button>`).join("")}
    <select class="select-filter" id="f-category"><option value="">Alle Kategorien</option>${patientCategories().map((c) => `<option value="${c.id}" ${activeFilters.category === c.id ? "selected" : ""}>${c.label}</option>`).join("")}</select>
    <select class="select-filter" id="f-patient"><option value="">Alle Patienten</option>${state.patients.map((p) => `<option value="${p.id}" ${activeFilters.patient === p.id ? "selected" : ""}>${p.name}</option>`).join("")}</select>
    <select class="select-filter" id="f-assignee"><option value="">Alle Verantwortlichen</option>${state.users.map((u) => `<option value="${u.id}" ${activeFilters.assignee === u.id ? "selected" : ""}>${u.name}</option>`).join("")}</select>
    <select class="select-filter" id="f-status"><option value="">Alle Status</option><option value="open" ${activeFilters.status === "open" ? "selected" : ""}>Offen</option><option value="in_progress" ${activeFilters.status === "in_progress" ? "selected" : ""}>In Bearbeitung</option><option value="done" ${activeFilters.status === "done" ? "selected" : ""}>Abgeschlossen</option></select>
  `;
  wrap.appendChild(filterBar);

  let items = patientScopedItems();
  const today = todayStr();
  if (activeFilters.quick === "mine") items = items.filter((i) => i.assignees.includes(state.currentUserId));
  if (activeFilters.quick === "open") items = items.filter((i) => !isFullyDone(i));
  if (activeFilters.quick === "today") items = items.filter((i) => i.status !== "done" && i.deadline === today);
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
      activeFilters = { quick: null, patient: cell.dataset.patient, category: "", assignee: "", status: "" };
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
  wrap.innerHTML = `
    <div class="page-header">
      <div><h1>${cat.label}</h1><div class="page-sub">${doneCount} / ${items.length} vorhanden — einfache Ja/Nein-Checkliste</div></div>
      ${isAdmin() ? '<button class="btn primary" id="new-doc-item-btn">+ Punkt hinzufügen</button>' : ""}
    </div>`;
  const list = document.createElement("div");
  list.className = "table-wrap";
  list.innerHTML = `
    <table>
      <thead><tr><th>Dokument</th><th>Status</th></tr></thead>
      <tbody>
        ${items.map((it) => `<tr data-item="${it.id}"><td>${it.label}</td><td>${statusPillHtml(it)}</td></tr>`).join("") || `<tr><td colspan="2" style="text-align:center;color:var(--ink-muted);padding:20px;">Noch keine Einträge.</td></tr>`}
      </tbody>
    </table>
  `;
  wrap.appendChild(list);
  list.querySelectorAll("[data-item]").forEach((row) =>
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
    const simple = isSimpleDocCategory(item.category);
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
  else if (modalState.kind === "pflegedienst-new") panel.innerHTML = pflegedienstFormHtml();
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
      if (modalState.kind === "patient-edit") {
        const p = state.patients.find((x) => x.id === modalState.id);
        p.name = name;
        p.pflegegrad = pflegegrad;
        p.active = active;
      } else {
        const id = "p" + Date.now().toString(36);
        state.patients.push({ id, name, pflegegrad, active });
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

  const pdSubmit = panel.querySelector("#pd-submit");
  if (pdSubmit) {
    pdSubmit.addEventListener("click", () => {
      const name = panel.querySelector("#pd-name").value.trim();
      if (!name) return;
      const createdAt = panel.querySelector("#pd-created").value || todayStr();
      const auditIntervalMonths = parseInt(panel.querySelector("#pd-interval").value, 10) || 9;
      state.pflegedienste.push({ id: "pd" + Date.now().toString(36), name, createdAt, auditIntervalMonths });
      saveState();
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

function pflegedienstFormHtml() {
  return `
    <div class="panel-header">
      <div><h2>Neuer Pflegedienst</h2><div class="page-sub">Startdatum + Intervall bepalen de countdown naar de eerstvolgende MD-controle</div></div>
      <button class="panel-close" id="modal-close">✕</button>
    </div>
    <div class="panel-body">
      <div class="field-row">
        <span class="field-label">Name</span>
        <input type="text" id="pd-name" placeholder="z. B. Pflegedienst Musterstadt" style="${INPUT_STYLE}" />
      </div>
      <div class="field-row">
        <span class="field-label">Erstellt am / Startdatum</span>
        <input type="date" id="pd-created" value="${todayStr()}" style="${INPUT_STYLE}" />
      </div>
      <div class="field-row">
        <span class="field-label">Intervall bis zur Kontrolle (Monate)</span>
        <input type="number" id="pd-interval" value="9" min="1" max="36" style="${INPUT_STYLE}" />
      </div>
      <button class="btn primary" id="pd-submit">Dienst anlegen</button>
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
  patientScopedItems().forEach((it) => {
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

render();
