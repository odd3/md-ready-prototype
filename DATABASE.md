# Van prototype naar gedeelde database

Uitwerking van de stap die de applicatie van een demo naar iets bruikbaars
brengt: meerdere mensen die tegelijk in dezelfde gegevens werken.

Dit document beschrijft wat er gebouwd moet worden en waarom het zo is
opgezet. Er is nog niets van geïmplementeerd.

## Waarom dit nodig is

De applicatie bewaart nu alles als één blok JSON in de browser. Op Vercel
betekent dat: iedereen die de site opent krijgt zijn eigen administratie. Wat
Michael afvinkt ziet Nasrat nooit. Vercel serveert de applicatie, maar heeft
geen schijf — het is geen opslagplaats.

De netwerkmap-variant die er nog in zit lost dat half op, maar alleen voor
mensen op hetzelfde netwerk en met één persoon tegelijk. Voor het doel —
meerdere mensen, online, tegelijk — is een database nodig.

## Doelarchitectuur

```
browser  ──►  Vercel: statische bestanden (index.html, app.js, …)
         ──►  Vercel: functies onder /api   ──►  Postgres (Frankfurt)
```

De schermen blijven zoals ze zijn. Wat verandert is waar de gegevens vandaan
komen en dat een wijziging naar de server gaat in plaats van naar een bestand.

## Waar het draait — twee opties

| | **Vercel + Neon** | **Hetzner (of IONOS)** |
|---|---|---|
| Opzet | repo importeren, database koppelen | server huren, Docker, zelf inrichten |
| Beheer | vrijwel niets | updates en back-ups zelf |
| Kosten | Vercel Pro ± $20/mnd (commercieel gebruik mag niet op Hobby) + database | ± €5–15/mnd, alles inbegrepen |
| Verwerkersovereenkomst | twee: Vercel én Neon, beide Amerikaans moederbedrijf | één, Duits bedrijf |
| Regio | functies en database vast te zetten op Frankfurt | Duitsland |

**Advies:** voor jou als bouwer is Vercel + Neon het prettigst werken. Voor
deze klant is een Duitse server het makkelijkst te verdedigen — *"der Server
steht in Deutschland"* beëindigt bij een Pflegedienst meestal het gesprek over
gezondheidsgegevens. De keuze verandert niets aan onderstaand datamodel of de
API; alleen waar het draait.

## Datamodel

Acht tabellen. Alles wat bij een organisatie hoort draagt `org_id`.

```sql
create table organization (
  id                     bigserial primary key,
  name                   text not null,
  color                  text not null default 'teal',
  active                 boolean not null default true,
  last_audit             date not null,
  audit_interval_months  smallint not null default 9,
  created_at             timestamptz not null default now()
);

create table app_user (
  id            bigserial primary key,
  name          text not null,
  initials      text not null,
  role          text not null default 'admin' check (role in ('admin','mitarbeiter')),
  password_hash text,                   -- null = nog geen wachtwoord ingesteld
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table category (                 -- vaste referentiedata
  id    text primary key,               -- akte, verwaltung, personal, qm, hygiene
  label text not null,
  scope text not null check (scope in ('patient','staff','org'))
);

create table patient (
  id         bigserial primary key,
  org_id     bigint not null references organization(id),
  name       text not null,
  pflegegrad text,
  sgb_v      text[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)                   -- maakt de composietsleutel hieronder mogelijk
);

create table staff (
  id         bigserial primary key,
  org_id     bigint not null references organization(id),
  name       text not null,
  category   text not null,             -- examinierte, lg1, …
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table checklist_item (
  id           bigserial primary key,
  org_id       bigint not null references organization(id),
  category_id  text not null references category(id),
  label        text not null,
  level        smallint not null default 1,
  status       text not null default 'open' check (status in ('open','in_progress','done')),
  priority     text not null default 'normal' check (priority in ('normal','high')),
  deadline     date,
  link_type    text not null check (link_type in ('patient','staff','org')),
  patient_id   bigint,
  staff_id     bigint,
  completed_at date,
  completed_by bigint references app_user(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,

  -- Een punt hangt aan een patiënt, aan een medewerker, of aan de organisatie
  -- zelf — nooit aan twee dingen tegelijk.
  constraint link_consistent check (
    (link_type = 'patient' and patient_id is not null and staff_id is null) or
    (link_type = 'staff'   and staff_id   is not null and patient_id is null) or
    (link_type = 'org'     and patient_id is null     and staff_id is null)
  ),

  -- Dít is de belangrijke regel: een punt kan alleen verwijzen naar een
  -- patiënt van dezelfde organisatie. De scheiding tussen Pflegediensten is
  -- daarmee geen afspraak in de code meer maar een regel in de database.
  foreign key (patient_id, org_id) references patient (id, org_id),
  foreign key (staff_id,   org_id) references staff   (id, org_id)
);

create table item_assignee (
  item_id bigint not null references checklist_item(id) on delete cascade,
  user_id bigint not null references app_user(id),
  primary key (item_id, user_id)
);

create table item_comment (
  id         bigserial primary key,
  item_id    bigint not null references checklist_item(id) on delete cascade,
  author_id  bigint not null references app_user(id),
  text       text not null,
  created_at timestamptz not null default now()
);

-- Audittrail. Append-only: geen update, geen delete. Dit is wat het logboek
-- bij een MD-controle waarde geeft — zonder dit is "wie deed wat wanneer"
-- een bewering in plaats van een vastlegging.
create table item_event (
  id        bigserial primary key,
  item_id   bigint not null references checklist_item(id),
  org_id    bigint not null references organization(id),
  user_id   bigint references app_user(id),
  at        timestamptz not null default now(),
  field     text not null,
  old_value text,
  new_value text
);

create table session (
  token      text primary key,
  user_id    bigint not null references app_user(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index on checklist_item (org_id, category_id);
create index on checklist_item (org_id, link_type, patient_id);
create index on checklist_item (org_id, deadline) where status <> 'done';
create index on item_event (item_id, at);
```

### Drie dingen die hier bewust zo staan

**`foreign key (patient_id, org_id)`** — de composietsleutel. In het prototype
is de scheiding tussen organisaties een filter in JavaScript; vergeet je hem
ergens, dan lekt de ene Pflegedienst in de andere. Met deze constraint weigert
de database zo'n rij. Dat is de ene regel die ik niet zou weglaten.

**`date` voor zakelijke datums, `timestamptz` voor momenten.** Een Frist is een
kalenderdag, geen tijdstip. Reken die altijd in Europe/Berlin uit en nooit in
UTC — precies de fout die in september in dit prototype zat, waar élke datum
een dag te vroeg stond. Zet `TZ=Europe/Berlin` op de functies en gebruik in SQL
`current_date at time zone 'Europe/Berlin'`, nooit een kale `now()::date`.

**`version` op `checklist_item`.** Zie gelijktijdigheid hieronder.

## API

Sessiecookie, `httpOnly`, `secure`, `sameSite=lax`.

```
POST   /api/login                  {name, password}        → cookie
POST   /api/logout
GET    /api/me                     → gebruiker + organisaties die hij mag zien

GET    /api/orgs                   → lijst voor de keuzelijst
POST   /api/orgs                   → nieuwe organisatie (+ QM en Hygiene erbij)
PATCH  /api/orgs/:id               → naam, kleur, interval, actief

GET    /api/orgs/:id/state         → patiënten, personeel, punten van één organisatie
POST   /api/orgs/:id/patients      PATCH /api/patients/:id
POST   /api/orgs/:id/staff         PATCH /api/staff/:id
POST   /api/orgs/:id/items         → los punt toevoegen
PATCH  /api/items/:id              {status?, deadline?, priority?, assignees?, version}
POST   /api/items/:id/comments
GET    /api/items/:id/events       → audittrail van dat punt
```

`org_id` komt altijd uit het pad, nooit uit de body, en elke query krijgt hem
mee. Eén hulpfunctie die dat afdwingt is beter dan het op elke plek onthouden.

## Gelijktijdigheid

Het grendelbestand verdwijnt — meerdere mensen tegelijk is nu juist het doel.
Daarvoor in de plaats:

- **Per punt een versiecheck.** De client stuurt de `version` die hij las;
  komt die niet overeen, dan antwoordt de server `409` en haalt de client dat
  punt opnieuw op met de melding *"Dieser Punkt wurde inzwischen von Sabine
  geändert."* Twee mensen die verschillende punten afvinken merken niets van
  elkaar; twee mensen op hetzelfde punt verliezen geen van beiden hun werk
  zonder het te weten.
- **Geen hele-document-schrijfacties meer.** Nu gaat bij elke wijziging de hele
  administratie naar de opslag. Dat moet per wijziging worden.

## Inloggen

Nu kiest iedereen een naam en is iedereen administrator. Dat mag zo blijven
zolang er verzonnen gegevens in staan.

Zodra er echte patiëntgegevens in gaan is het niet houdbaar: een publiek
bereikbare URL zonder wachtwoord is geen beveiliging, en bij
gezondheidsgegevens is toegangsbeheer geen nette bijkomstigheid maar een
verplichting. Daarom staat `password_hash` al in het model en zijn de rolvelden
blijven staan.

Minimaal nodig vóór productie: wachtwoord per gebruiker (scrypt of argon2),
sessies met een vervaltijd, en een rem op herhaald proberen.

## Wat er in de frontend verandert

Minder dan het lijkt, maar één ding wezenlijk.

Wat blijft: alle schermen, de matrix, het leespaneel, de Hygiene-lijst, de
organisatiebalk, de filters, de exports.

Wat verandert: `loadState()` en `saveState()` verdwijnen. Nu schrijft
`saveState()` de héle administratie weg bij elke handeling. Tegen een API wordt
dat per wijziging een gericht verzoek — een vinkje wordt `PATCH /api/items/42`.
Dat raakt elke plek waar nu `saveState()` staat, zo'n twintig plekken, en elk
daarvan moet ook iets kunnen met een foutmelding of een `409`.

Dat is het echte werk aan de voorkant. De rest is aansluiten.

## Volgorde van bouwen

1. Keuze maken: Vercel + Neon, of Hetzner. Alles hierna is daarvan onafhankelijk.
2. Schema aanleggen, met een migratiebestand zodat het herhaalbaar is.
3. Omzetscript: de huidige `mdready-daten.json` inlezen en in de tabellen zetten.
   Daarmee gaat de demo-inhoud niet verloren en is het model meteen getoetst.
4. API bouwen: eerst lezen (`/api/me`, `/api/orgs`, `/api/orgs/:id/state`).
5. Frontend laten lezen uit de API; opslaan blijft nog lokaal. Hier zie je of
   het datamodel klopt.
6. Schrijfroutes erbij, `saveState()` eruit, versiecheck erin.
7. Inloggen met wachtwoord.
8. Back-up inregelen en terugzetten één keer geoefend — een back-up die nooit
   is teruggezet is een aanname.

Stap 5 is het ijkpunt: werkt de applicatie dan nog volledig, dan is de rest
afmaken.

## Wat dit niet oplost

- **Offline werken.** Geen verbinding is geen applicatie. Voor een kantoor
  prima, voor een tablet onderweg niet.
- **Rechten per rol.** Iedereen blijft administrator tot dat expliciet wordt
  ingericht.
- **Verwerkersovereenkomsten, verwijderbeleid, bewaartermijnen.** Papierwerk dat
  bij gezondheidsgegevens hoort en niet door code wordt opgelost.
- **Het Excel-werkboek.** QM-overzicht, Fehlerliste, Telefon-Absagen,
  MD-Team Woche, MD-Probeprüfung en Jahresplan zitten nog niet in de applicatie.
