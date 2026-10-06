/* MD-READY Prototyp — Beispieldaten (rein fiktiv, keine echten Patienten/Mitarbeiter) */

// Ophogen bij elke wijziging aan de seed-data: bij een mismatch met de
// opgeslagen localStorage-versie wordt automatisch opnieuw geseed, zodat
// bezoekers na een update niet handmatig "Demo zurücksetzen" hoeven te klikken.
const SEED_VERSION = 11;

// Een datum is hier altijd de kalenderdatum van de gebruiker, niet die van
// UTC. toISOString() rekent om naar UTC en levert ten oosten van Greenwich
// steevast de dag ervoor op: middernacht in Duitsland is 22:00 UTC van de
// vorige dag. Elke Frist en elke afvinkdatum stond daardoor een dag te vroeg.
function isoDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function addMonths(dateStr, months) {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// ORGANISATIES — de Pflegediensten die met deze installatie worden begeleid.
// Elke patiënt, elk personeelsdossier en elk checklistpunt hoort bij precies
// één organisatie; wisselen van organisatie wisselt dus de hele administratie.
// ---------------------------------------------------------------------------

// Elke organisatie krijgt een eigen kleur in de balk bovenaan. Kleur is nooit
// het enige signaal — de naam staat er groot naast — maar bij het snelle
// wisselen tussen diensten zie je aan de kleur meteen dat je ergens anders zit.
// Alle kleuren zijn donker genoeg voor witte tekst, in licht én donker thema.
const ORG_COLORS = [
  { id: "teal", label: "Türkis", bg: "#0f766e" },
  { id: "blue", label: "Blau", bg: "#1d4ed8" },
  { id: "purple", label: "Violett", bg: "#6d28d9" },
  { id: "amber", label: "Bernstein", bg: "#b45309" },
  { id: "rose", label: "Rosé", bg: "#be123c" },
  { id: "green", label: "Grün", bg: "#15803d" },
  { id: "slate", label: "Schiefer", bg: "#334155" },
  { id: "cyan", label: "Petrol", bg: "#155e75" },
];
function orgColor(id) {
  return ORG_COLORS.find((c) => c.id === id) || ORG_COLORS[0];
}

// SGB V — behandelingspflege per patiënt. Wat hier aanstaat, staat in de
// namenlijst direct onder de naam, zodat bij de MD-controle in één oogopslag
// zichtbaar is welke verrichtingen bij deze patiënt horen.
const SGB_V_LEISTUNGEN = [
  { id: "medigabe", label: "Medigabe", short: "Medi" },
  { id: "augentropfen", label: "Augentropfengabe", short: "Augen" },
  { id: "kompressionsstruempfe", label: "Kompressionsstrümpfe", short: "K-Strümpfe" },
  { id: "kompressionsverbaende", label: "Kompressionsverbände", short: "K-Verbände" },
  { id: "bz_messung", label: "BZ Messung", short: "BZ" },
  { id: "insulingabe", label: "Insulingabe", short: "Insulin" },
  { id: "wunde_akut", label: "Wundversorgung akut", short: "Wunde akut" },
  { id: "wunde_chronisch", label: "Wundversorgung chronisch", short: "Wunde chron." },
];
function sgbVLabel(id) {
  const l = SGB_V_LEISTUNGEN.find((x) => x.id === id);
  return l ? l.label : id;
}
function sgbVShort(id) {
  const l = SGB_V_LEISTUNGEN.find((x) => x.id === id);
  return l ? l.short : id;
}

// Hygienehandbuch — letterlijke inhoudsopgave uit MD_READY_Kontrollsystem.xlsx,
// tabblad "Hygienehandbuch". Nummering, volgorde en nesting komen uit dat
// bestand; elk punt heeft daar een eigen vinkje, ook de hoofdstukkoppen, dus
// ze zijn hier allemaal afvinkbaar. Subpunten staan onder hun hoofdstuk.
const HYGIENE_HANDBUCH = [
  { no: "1", label: "Hygienekonzept" },
  { no: "2", label: "Persönliche Hygiene" },
  { no: "3", label: "Desinfektionsplan" },
  { no: "4", label: "Umgang mit Infektionen" },
  { no: "4.1", label: "MRGN" },
  { no: "4.2", label: "MRSA" },
  { no: "4.3", label: "VRE" },
  { no: "4.4", label: "Coronavirus" },
  { no: "4.5", label: "Norovirus" },
  { no: "4.6", label: "Clostridium difficile" },
  { no: "5", label: "Erregersteckbriefe" },
  { no: "5.1", label: "Adenoviren" },
  { no: "5.2", label: "C. difficile" },
  { no: "5.3", label: "Campylobacter" },
  { no: "5.4", label: "EHEC" },
  { no: "5.5", label: "FSME" },
  { no: "5.6", label: "Hantaviren" },
  { no: "5.7", label: "Influenza" },
  { no: "5.8", label: "Keuchhusten" },
  { no: "5.9", label: "Krätze / Skabies" },
  { no: "5.10", label: "Legionellen" },
  { no: "5.11", label: "Masern" },
  { no: "5.12", label: "Meningokokken" },
  { no: "5.13", label: "MERS-CoV" },
  { no: "5.14", label: "MRGN" },
  { no: "5.15", label: "Mumps" },
  { no: "5.16", label: "Noroviren" },
  { no: "6", label: "Belehrung §43" },
  { no: "7", label: "Vorgehen Erkrankung" },
  { no: "8", label: "Empfehlung RKI" },
  { no: "8.1", label: "Händehygiene" },
  { no: "8.2", label: "Infektionen Gefäßkatheter" },
  { no: "8.3", label: "Harnwegsinfektionen" },
  { no: "8.4", label: "MRSA" },
  { no: "8.5", label: "Nosokomiale Pneumonie" },
  { no: "8.6", label: "Krankenhaushygiene" },
  { no: "9", label: "Aufbereitung Wandspender" },
  { no: "10", label: "Umgang Nadelverletzung" },
  { no: "11", label: "MRSA und Abläufe" },
  { no: "12", label: "Sicherheitsblätter" },
];

// Een checklistpunt is een string, of { label, level } als de nesting uit het
// bronbestand zichtbaar moet blijven (level 2 = subpunt onder het hoofdstuk erboven).
function itemDefEntry(def) {
  return typeof def === "string" ? { label: def, level: 1 } : { label: def.label, level: def.level || 1 };
}

// Op moduleniveau (i.p.v. binnen seedState) zodat ook nieuw aangemaakte
// patiënten/personeelsleden/checklistpunten dezelfde standaardstructuur krijgen.
const ITEM_DEFS = {
  akte: ["SIS", "Maßnahmenplan", "Risikoeinschätzung", "Pflegebericht", "Pflegevisite", "Medikamentenplan"],
  verwaltung: ["Verordnung", "Genehmigung", "Vertrag", "Kostenvoranschlag", "Leistungsnachweis", "Rechnung"],
  personal: ["Vertrag", "Zertifikat", "Führungszeugnis", "Einarbeitung dokumentiert", "Datenschutzerklärung"],
  qm: ["Pflegeleitbild", "Organigramm", "Fortbildungskonzept", "Notfallkonzept", "Hygienekonzept-Verweis", "Datenschutzkonzept"],
  // Uit het Kontrollsystem-werkboek; het nummer staat in het label zodat het
  // ook in de CSV- en PDF-export terugkomt, waar geen inspringing bestaat.
  hygiene: HYGIENE_HANDBUCH.map((e) => {
    const sub = e.no.includes(".");
    return { label: e.no + (sub ? " " : ". ") + e.label, level: sub ? 2 : 1 };
  }),
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

function blankChecklistItem(id, category, label, linkType, linkId, assigneeId, orgId) {
  return {
    id,
    orgId,
    category,
    label,
    level: 1, // handmatig toegevoegde punten staan op hoofdstukniveau
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

function freshId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Standaard Patientenakte- + Verwaltungspunten voor een nieuw aangemaakte patiënt.
function createPatientChecklistItems(patientId, assigneeId, orgId) {
  const items = [];
  ["akte", "verwaltung"].forEach((cat) => {
    ITEM_DEFS[cat].forEach((def) => {
      const { label } = itemDefEntry(def);
      items.push(blankChecklistItem(freshId("np"), cat, label, "patient", patientId, assigneeId, orgId));
    });
  });
  return items;
}
// Standaard Personal-checklistpunten voor een nieuw personeelslid.
function createStaffChecklistItems(staffId, assigneeId, orgId) {
  return ITEM_DEFS.personal.map((def) => blankChecklistItem(freshId("ns"), "personal", itemDefEntry(def).label, "staff", staffId, assigneeId, orgId));
}
// Een nieuwe organisatie begint met het volledige QM-handboek en Hygienehandbuch.
// Patiënten en personeel voegt men zelf toe, maar deze twee lijsten zijn voor
// iedere Pflegedienst gelijk en moeten er vanaf dag één staan.
function createOrgChecklistItems(orgId) {
  const items = [];
  ["qm", "hygiene"].forEach((cat) => {
    ITEM_DEFS[cat].forEach((def) => {
      const { label, level } = itemDefEntry(def);
      const item = blankChecklistItem(freshId("no"), cat, label, "org", null, null, orgId);
      item.level = level;
      items.push(item);
    });
  });
  return items;
}

function seedState() {
  // Iedereen is admin en mag alles wijzigen; er is geen wachtwoord. Wie je bent
  // bepaalt dus niet wát je mag, alleen onder welke naam het wordt vastgelegd.
  const users = [
    { id: "nasrat", name: "Nasrat", role: "admin", roleLabel: "Administrator", initials: "NA" },
    { id: "michael", name: "Michael", role: "admin", roleLabel: "Administrator", initials: "MI" },
    { id: "sabine", name: "Sabine", role: "admin", roleLabel: "Administrator", initials: "SA" },
    { id: "jonas", name: "Jonas", role: "admin", roleLabel: "Administrator", initials: "JO" },
    { id: "fatima", name: "Fatima", role: "admin", roleLabel: "Administrator", initials: "FA" },
    { id: "klara", name: "Klara", role: "admin", roleLabel: "Administrator", initials: "KL" },
    { id: "deniz", name: "Deniz", role: "admin", roleLabel: "Administrator", initials: "DE" },
  ];

  const organizations = [
    { id: "org1", name: "MD-READY Demo Pflegedienst", color: "teal", active: true, createdAt: daysFromNow(-210), auditIntervalMonths: 9 },
    { id: "org2", name: "Pflegedienst Sonnenschein", color: "amber", active: true, createdAt: daysFromNow(-40), auditIntervalMonths: 9 },
    { id: "org3", name: "Pflegedienst Lindenhof", color: "purple", active: true, createdAt: daysFromNow(-260), auditIntervalMonths: 6 },
  ];

  const patients = [
    { orgId: "org1", id: "p1", name: "Anna Berger", active: true, pflegegrad: "PG 3", sgbV: ["medigabe", "bz_messung", "insulingabe"] },
    { orgId: "org1", id: "p2", name: "Thomas Vogel", active: true, pflegegrad: "PG 2", sgbV: ["medigabe"] },
    { orgId: "org1", id: "p3", name: "Ingrid Schuster", active: true, pflegegrad: "PG 4", sgbV: ["kompressionsstruempfe", "wunde_chronisch"] },
    { orgId: "org1", id: "p4", name: "Klaus Weidner", active: true, pflegegrad: "PG 1", sgbV: [] },
    { orgId: "org1", id: "p5", name: "Helga Brandt", active: true, pflegegrad: "PG 2", sgbV: ["augentropfen", "medigabe"] },
    { orgId: "org1", id: "p6", name: "Werner Fuchs", active: true, pflegegrad: "PG 3", sgbV: ["bz_messung", "insulingabe", "wunde_akut"] },
    { orgId: "org1", id: "p7", name: "Renate König", active: true, pflegegrad: "PG 5", sgbV: ["medigabe", "kompressionsverbaende", "wunde_chronisch"] },
    { orgId: "org1", id: "p8", name: "Dieter Lang", active: true, pflegegrad: "PG 1", sgbV: [] },
    { orgId: "org1", id: "p9", name: "Ursula Hartmann", active: true, pflegegrad: "PG 4", sgbV: ["kompressionsstruempfe"] },
    { orgId: "org1", id: "p10", name: "Peter Wolff", active: true, pflegegrad: "PG 2", sgbV: ["medigabe", "augentropfen"] },
    { orgId: "org1", id: "p11", name: "Brigitte Krause", active: true, pflegegrad: "PG 3", sgbV: ["bz_messung"] },
    { orgId: "org1", id: "p12", name: "Manfred Zimmermann", active: false, pflegegrad: "PG 4", sgbV: ["wunde_chronisch"] },
    { orgId: "org1", id: "p13", name: "Elke Neumann", active: true, pflegegrad: "PG 1", sgbV: [] },
    { orgId: "org1", id: "p14", name: "Rolf Baumann", active: true, pflegegrad: "PG 3", sgbV: ["medigabe", "kompressionsstruempfe", "bz_messung"] },

    { orgId: "org2", id: "p21", name: "Gerda Hoffmann", active: true, pflegegrad: "PG 2", sgbV: ["medigabe", "augentropfen"] },
    { orgId: "org2", id: "p22", name: "Josef Winkler", active: true, pflegegrad: "PG 4", sgbV: ["bz_messung", "insulingabe"] },
    { orgId: "org2", id: "p23", name: "Marianne Seidel", active: true, pflegegrad: "PG 3", sgbV: ["kompressionsstruempfe"] },
    { orgId: "org2", id: "p24", name: "Alfred Stein", active: true, pflegegrad: "PG 1", sgbV: [] },

    { orgId: "org3", id: "p31", name: "Hildegard Pohl", active: true, pflegegrad: "PG 5", sgbV: ["wunde_chronisch", "medigabe"] },
    { orgId: "org3", id: "p32", name: "Bernd Kaiser", active: true, pflegegrad: "PG 2", sgbV: ["kompressionsverbaende"] },
  ];

  // Personal: aparte entiteit los van de inlog-gebruikers (users) — dit zijn
  // de daadwerkelijke personeelsleden waarvoor een personeelsdossier
  // (Vertrag/Zertifikat/etc.) wordt bijgehouden, per kwalificatiecategorie.
  const staffNames = {
    org1: {
      examinierte: ["Petra Lindner", "Otto Krämer"],
      lg1: ["Nadine Schröder", "Bilal Yildiz"],
      lg2: ["Carmen Sailer", "Heinz Bergmann"],
      hauswirtschaft: ["Rosa Delgado", "Ingo Thiel"],
      verwaltung: ["Meike Vogt", "Kai Ostermann"],
      azubi: ["Lina Sommer", "Noah Peters"],
    },
    org2: {
      examinierte: ["Silke Brandner"],
      lg1: ["Tomasz Nowak"],
      lg2: [],
      hauswirtschaft: ["Aylin Demir"],
      verwaltung: [],
      azubi: [],
    },
    org3: {
      examinierte: ["Markus Reiter"],
      lg1: [],
      lg2: ["Dorothea Falk"],
      hauswirtschaft: [],
      verwaltung: [],
      azubi: [],
    },
  };
  const staff = [];
  let staffIdCounter = 1;
  organizations.forEach((org) => {
    STAFF_CATEGORIES.forEach((cat) => {
      (staffNames[org.id][cat.id] || []).forEach((name) => {
        staff.push({ orgId: org.id, id: "s" + staffIdCounter++, name, category: cat.id, active: true });
      });
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

  function pushItems(orgId, categoryId, linkType, linkId, profile, assigneeOffset) {
    itemDefs[categoryId].forEach((def, idx) => {
      const { label, level } = itemDefEntry(def);
      const status = profile ? profile.statuses[idx % profile.statuses.length] : (idx % 3 === 0 ? "open" : idx % 3 === 1 ? "in_progress" : "done");
      const offset = profile ? profile.offsets[idx % profile.offsets.length] : [0, 5, 10, -2, 8, -6][idx % 6];
      const deadline = daysFromNow(offset);
      const assignedTo = assignPool[(idx + assigneeOffset) % assignPool.length];
      items.push({
        id: "i" + itemId++,
        orgId,
        category: categoryId,
        label,
        level,
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
    pushItems(p.orgId, "akte", "patient", p.id, profile, i);
    pushItems(p.orgId, "verwaltung", "patient", p.id, profile, i + 1);
  });

  staff.forEach((s, i) => {
    pushItems(s.orgId, "personal", "staff", s.id, null, i);
  });

  // QM en Hygiene zijn per organisatie: elke Pflegedienst werkt zijn eigen
  // handboek af en wordt daar ook apart op gecontroleerd.
  organizations.forEach((org, i) => {
    pushItems(org.id, "qm", "org", null, null, i);
    pushItems(org.id, "hygiene", "org", null, null, i + 1);
  });

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

  return {
    version: SEED_VERSION,
    currentUserId: null,
    currentOrgId: null,
    organizations,
    users,
    patients,
    staff,
    categories,
    items,
  };
}
