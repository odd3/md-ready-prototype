/* MD-READY Prototyp — Beispieldaten (rein fiktiv, keine echten Patienten/Mitarbeiter) */

// Ophogen bij elke wijziging aan de seed-data: bij een mismatch met de
// opgeslagen localStorage-versie wordt automatisch opnieuw geseed, zodat
// bezoekers na een update niet handmatig "Demo zurücksetzen" hoeven te klikken.
const SEED_VERSION = 8;

function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Op moduleniveau (i.p.v. binnen seedState) zodat ook nieuw aangemaakte
// patiënten/personeelsleden/checklistpunten dezelfde standaardstructuur krijgen.
const ITEM_DEFS = {
  akte: ["SIS", "Maßnahmenplan", "Risikoeinschätzung", "Pflegebericht", "Pflegevisite", "Medikamentenplan"],
  verwaltung: ["Verordnung", "Genehmigung", "Vertrag", "Kostenvoranschlag", "Leistungsnachweis", "Rechnung"],
  personal: ["Vertrag", "Zertifikat", "Führungszeugnis", "Einarbeitung dokumentiert", "Datenschutzerklärung"],
  qm: ["Pflegeleitbild", "Organigramm", "Fortbildungskonzept", "Notfallkonzept", "Hygienekonzept-Verweis", "Datenschutzkonzept"],
  hygiene: ["Hygieneplan", "Desinfektionsplan", "Schutzausrüstung geprüft", "MRSA-Verfahrensanweisung", "Hautschutzplan", "Entsorgungskonzept"],
};

// Kwalificatiecategorieën voor Personal — elk krijgt een eigen tabblad.
const STAFF_CATEGORIES = [
  { id: "examinierte", label: "Examinierte" },
  { id: "lg1", label: "Pflegehelfer LG1" },
  { id: "lg2", label: "Pflegehelfer LG2" },
  { id: "hauswirtschaft", label: "Hauswirtschaft" },
  { id: "verwaltung", label: "Verwaltung" },
  { id: "azubi", label: "Auszubildende" },
];

function blankChecklistItem(id, category, label, linkType, linkId, assigneeId) {
  return {
    id,
    category,
    label,
    status: "open",
    priority: "normal",
    deadline: daysFromNow(14),
    assignees: assigneeId ? [assigneeId] : [],
    linkType, // 'patient' | 'staff' | 'org'
    linkId,
    createdAt: daysFromNow(0),
    updatedAt: daysFromNow(0),
    completedAt: null,
    completedBy: null,
    // Nachkontrolle (vier-ogen-controle) is op verzoek van de klant uitgeschakeld.
    // De velden blijven in het datamodel staan (mocht dit later terugkomen),
    // maar nachkontrolleRequired staat overal op false.
    nachkontrolleRequired: false,
    nachkontrolleDone: false,
    nachkontrolleBy: null,
    nachkontrolleAt: null,
    comments: [],
    history: [],
  };
}

// Standaard Patientenakte- + Verwaltungspunten voor een nieuw aangemaakte patiënt.
function createPatientChecklistItems(patientId, assigneeId) {
  const items = [];
  ["akte", "verwaltung"].forEach((cat) => {
    ITEM_DEFS[cat].forEach((label) => {
      items.push(blankChecklistItem("np" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cat, label, "patient", patientId, assigneeId));
    });
  });
  return items;
}
// Standaard Personal-checklistpunten voor een nieuw personeelslid.
function createStaffChecklistItems(staffId, assigneeId) {
  return ITEM_DEFS.personal.map((label) => blankChecklistItem("ns" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), "personal", label, "staff", staffId, assigneeId));
}

function seedState() {
  const users = [
    { id: "nasrat", name: "Nasrat", role: "admin", roleLabel: "Pflegedienst Admin", initials: "NA" },
    { id: "michael", name: "Michael", role: "mitarbeiter", roleLabel: "Mitarbeiter", initials: "MI" },
    { id: "sabine", name: "Sabine", role: "mitarbeiter", roleLabel: "Mitarbeiter", initials: "SA" },
    { id: "jonas", name: "Jonas", role: "mitarbeiter", roleLabel: "Mitarbeiter", initials: "JO" },
    { id: "fatima", name: "Fatima", role: "mitarbeiter", roleLabel: "Mitarbeiter", initials: "FA" },
    { id: "klara", name: "Klara", role: "mitarbeiter", roleLabel: "Mitarbeiter", initials: "KL" },
    { id: "deniz", name: "Deniz", role: "mitarbeiter", roleLabel: "Mitarbeiter", initials: "DE" },
  ];

  const patients = [
    { id: "p1", name: "Anna Berger", active: true, pflegegrad: "PG 3" },
    { id: "p2", name: "Thomas Vogel", active: true, pflegegrad: "PG 2" },
    { id: "p3", name: "Ingrid Schuster", active: true, pflegegrad: "PG 4" },
    { id: "p4", name: "Klaus Weidner", active: true, pflegegrad: "PG 1" },
    { id: "p5", name: "Helga Brandt", active: true, pflegegrad: "PG 2" },
    { id: "p6", name: "Werner Fuchs", active: true, pflegegrad: "PG 3" },
    { id: "p7", name: "Renate König", active: true, pflegegrad: "PG 5" },
    { id: "p8", name: "Dieter Lang", active: true, pflegegrad: "PG 1" },
    { id: "p9", name: "Ursula Hartmann", active: true, pflegegrad: "PG 4" },
    { id: "p10", name: "Peter Wolff", active: true, pflegegrad: "PG 2" },
    { id: "p11", name: "Brigitte Krause", active: true, pflegegrad: "PG 3" },
    { id: "p12", name: "Manfred Zimmermann", active: false, pflegegrad: "PG 4" },
    { id: "p13", name: "Elke Neumann", active: true, pflegegrad: "PG 1" },
    { id: "p14", name: "Rolf Baumann", active: true, pflegegrad: "PG 3" },
  ];

  // Personal: aparte entiteit los van de inlog-gebruikers (users) — dit zijn
  // de daadwerkelijke personeelsleden waarvoor een personeelsdossier
  // (Vertrag/Zertifikat/etc.) wordt bijgehouden, per kwalificatiecategorie.
  const staffNames = {
    examinierte: ["Petra Lindner", "Otto Krämer"],
    lg1: ["Nadine Schröder", "Bilal Yildiz"],
    lg2: ["Carmen Sailer", "Heinz Bergmann"],
    hauswirtschaft: ["Rosa Delgado", "Ingo Thiel"],
    verwaltung: ["Meike Vogt", "Kai Ostermann"],
    azubi: ["Lina Sommer", "Noah Peters"],
  };
  const staff = [];
  let staffIdCounter = 1;
  STAFF_CATEGORIES.forEach((cat) => {
    staffNames[cat.id].forEach((name) => {
      staff.push({ id: "s" + staffIdCounter++, name, category: cat.id, active: true });
    });
  });

  const categories = [
    { id: "akte", label: "Patientenakte", scope: "patient", team: "pflege" },
    { id: "verwaltung", label: "Verwaltung / Abrechnung", scope: "patient", team: "verwaltung" },
    { id: "personal", label: "Personal", scope: "staff", team: "verwaltung" },
    { id: "qm", label: "QM-Handbuch", scope: "org", team: null },
    { id: "hygiene", label: "Hygiene", scope: "org", team: null },
  ];

  const itemDefs = ITEM_DEFS;

  let itemId = 1;
  const items = [];
  const assignPool = users.map((u) => u.id);

  // Per-patient profile: controls the mix of status/deadline so the demo
  // shows all three aggregate outcomes (Vollständig / Korrektur / Dringend).
  const patientProfiles = {
    p1: { statuses: ["done", "done", "done", "done", "done", "done"], offsets: [-10, -8, -6, -5, -4, -3] }, // Vollständig
    p2: { statuses: ["done", "in_progress", "open", "done", "in_progress", "done"], offsets: [-5, 3, 10, -2, 5, 14] }, // Korrektur erforderlich
    p3: { statuses: ["done", "open", "in_progress", "done", "open", "done"], offsets: [-5, -2, 2, -8, 7, -1] }, // Dringend (open + overdue)
    p4: { statuses: ["done", "in_progress", "open", "done", "done", "in_progress"], offsets: [-5, 4, 9, -2, 1, 6] }, // Korrektur erforderlich
    p5: { statuses: ["done", "done", "done", "done", "done", "done"], offsets: [-12, -9, -7, -6, -5, -4] }, // Vollständig
    p6: { statuses: ["done", "in_progress", "in_progress", "done", "open", "done"], offsets: [-4, 6, 8, -3, 12, 3] }, // Korrektur erforderlich
    p7: { statuses: ["open", "done", "in_progress", "open", "done", "done"], offsets: [-6, -4, 5, -1, 9, -2] }, // Dringend
    p8: { statuses: ["done", "done", "in_progress", "open", "in_progress", "done"], offsets: [-5, -3, 4, 8, 6, -1] }, // Korrektur erforderlich
    p9: { statuses: ["in_progress", "open", "done", "done", "open", "in_progress"], offsets: [2, -3, -6, -4, 5, 9] }, // Dringend
    p10: { statuses: ["done", "done", "done", "done", "done", "done"], offsets: [-11, -8, -7, -6, -4, -3] }, // Vollständig
    p11: { statuses: ["done", "in_progress", "done", "open", "in_progress", "done"], offsets: [-5, 4, -2, 10, 7, -1] }, // Korrektur erforderlich
    p12: { statuses: ["open", "open", "done", "in_progress", "done", "open"], offsets: [-3, -5, -8, 6, -2, 8] }, // Dringend
    p13: { statuses: ["done", "in_progress", "open", "done", "done", "in_progress"], offsets: [-4, 5, 11, -3, 2, 7] }, // Korrektur erforderlich
    p14: { statuses: ["open", "done", "open", "in_progress", "done", "done"], offsets: [-2, -5, -7, 4, -3, 9] }, // Dringend
  };

  function pushItems(categoryId, linkType, linkId, profile, assigneeOffset) {
    itemDefs[categoryId].forEach((label, idx) => {
      const status = profile ? profile.statuses[idx % profile.statuses.length] : (idx % 3 === 0 ? "open" : idx % 3 === 1 ? "in_progress" : "done");
      const offset = profile ? profile.offsets[idx % profile.offsets.length] : [0, 5, 10, -2, 8, -6][idx % 6];
      const deadline = daysFromNow(offset);
      const assignedTo = assignPool[(idx + assigneeOffset) % assignPool.length];
      items.push({
        id: "i" + itemId++,
        category: categoryId,
        label,
        status,
        priority: idx === 0 ? "high" : "normal",
        deadline,
        assignees: linkType === "org" ? [] : [assignedTo],
        linkType, // 'patient' | 'staff' | 'org'
        linkId,
        createdAt: daysFromNow(-30),
        updatedAt: daysFromNow(-2),
        completedAt: status === "done" ? daysFromNow(Math.min(offset, -1)) : null,
        completedBy: status === "done" ? assignedTo : null,
        // Nachkontrolle staat uit (klantwens) — velden blijven aanwezig voor evt. later gebruik.
        nachkontrolleRequired: false,
        nachkontrolleDone: false,
        nachkontrolleBy: null,
        nachkontrolleAt: null,
        comments: [],
        // Audit trail: los van de (bewerkbare) reacties, append-only.
        history: [],
      });
    });
  }

  patients.forEach((p, i) => {
    const profile = patientProfiles[p.id];
    pushItems("akte", "patient", p.id, profile, i);
    pushItems("verwaltung", "patient", p.id, profile, i + 1);
  });

  staff.forEach((s, i) => {
    pushItems("personal", "staff", s.id, null, i);
  });

  pushItems("qm", "org", null, null, 0);
  pushItems("hygiene", "org", null, null, 1);

  // A few illustrative comments
  const sisItem = items.find((it) => it.category === "akte" && it.label === "SIS" && it.linkId === "p1");
  if (sisItem) {
    sisItem.comments.push(
      { id: "c1", author: "michael", text: "Dokument fehlt noch. Wurde beim Arzt angefordert.", createdAt: daysFromNow(-4) },
      { id: "c2", author: "nasrat", text: "Bitte bis Freitag nachfassen.", createdAt: daysFromNow(-2) }
    );
  }
  const koenigItem = items.find((it) => it.category === "akte" && it.label === "SIS" && it.linkId === "p7");
  if (koenigItem) {
    koenigItem.comments.push({ id: "c3", author: "nasrat", text: "Frist bereits überschritten, bitte heute noch erledigen.", createdAt: daysFromNow(-1) });
  }

  // Pflegedienste: door de Admin beheerde lijst van klant-organisaties, elk
  // met een aanmaakdatum en een interval (standaard 9 maanden) tot de
  // eerstvolgende MD-controle. Lichte tracking in dit prototype — nog geen
  // volledige technische multi-tenant scheiding (dat is architectuurwerk).
  const pflegedienste = [
    { id: "pd1", name: "MD-READY Demo Pflegedienst", createdAt: daysFromNow(-210), auditIntervalMonths: 9 },
    { id: "pd2", name: "Pflegedienst Sonnenschein", createdAt: daysFromNow(-40), auditIntervalMonths: 9 },
    { id: "pd3", name: "Pflegedienst Lindenhof", createdAt: daysFromNow(-260), auditIntervalMonths: 6 },
  ];

  return {
    version: SEED_VERSION,
    tenant: { name: "MD-READY Demo Pflegedienst" },
    currentUserId: "nasrat",
    users,
    patients,
    staff,
    categories,
    items,
    pflegedienste,
  };
}
