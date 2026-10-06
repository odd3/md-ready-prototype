-- MD-READY — datamodel
--
-- Zie DATABASE.md voor de overwegingen. Twee dingen staan hier bewust zo:
--
-- 1. De scheiding tussen Pflegediensten is een regel in de database, geen
--    filter in de applicatie. Een checklistpunt kan alleen verwijzen naar een
--    patiënt van dezelfde organisatie, afgedwongen met een composietsleutel.
--    Vergeet de applicatie ergens een org_id, dan weigert de database.
--
-- 2. Een Frist is een kalenderdag (date), geen moment (timestamptz). Reken die
--    altijd in de tijdzone van de Pflegedienst uit, nooit in UTC — dat was de
--    fout die hier eerder élke datum een dag te vroeg zette.

create table if not exists organization (
  id                    bigserial primary key,
  name                  text        not null,
  color                 text        not null default 'teal',
  active                boolean     not null default true,
  last_audit            date        not null,
  audit_interval_months smallint    not null default 9,
  created_at            timestamptz not null default now()
);

create table if not exists app_user (
  id            bigserial primary key,
  name          text        not null unique,
  initials      text        not null,
  role          text        not null default 'admin' check (role in ('admin', 'mitarbeiter')),
  -- null = nog geen wachtwoord ingesteld; die gebruiker kan niet inloggen.
  password_hash text,
  active        boolean     not null default true,
  created_at    timestamptz not null default now()
);

-- Accounts worden nooit verwijderd, alleen op inactief gezet: het audittrail
-- moet namen kunnen blijven oplossen.

create table if not exists category (
  id       text     primary key,
  label    text     not null,
  scope    text     not null check (scope in ('patient', 'staff', 'org')),
  sort_key smallint not null default 0
);

create table if not exists patient (
  id         bigserial   primary key,
  org_id     bigint      not null references organization (id),
  name       text        not null,
  pflegegrad text,
  sgb_v      text[]      not null default '{}',
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  -- Maakt de composietsleutel vanuit checklist_item mogelijk.
  unique (id, org_id)
);

create table if not exists staff (
  id         bigserial   primary key,
  org_id     bigint      not null references organization (id),
  name       text        not null,
  category   text        not null,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table if not exists checklist_item (
  id           bigserial   primary key,
  org_id       bigint      not null references organization (id),
  category_id  text        not null references category (id),
  label        text        not null,
  level        smallint    not null default 1,
  status       text        not null default 'open' check (status in ('open', 'in_progress', 'done')),
  priority     text        not null default 'normal' check (priority in ('normal', 'high')),
  deadline     date,
  link_type    text        not null check (link_type in ('patient', 'staff', 'org')),
  patient_id   bigint,
  staff_id     bigint,
  completed_at date,
  completed_by bigint      references app_user (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Gelijktijdig bewerken: de client stuurt de versie die hij las terug.
  version      integer     not null default 1,

  -- Een punt hangt aan een patiënt, aan een medewerker, of aan de organisatie
  -- zelf — nooit aan twee dingen tegelijk.
  constraint link_consistent check (
    (link_type = 'patient' and patient_id is not null and staff_id is null) or
    (link_type = 'staff'   and staff_id   is not null and patient_id is null) or
    (link_type = 'org'     and patient_id is null     and staff_id is null)
  ),

  -- De regel die kruisbesmetting tussen Pflegediensten onmogelijk maakt.
  foreign key (patient_id, org_id) references patient (id, org_id),
  foreign key (staff_id, org_id)   references staff (id, org_id)
);

create table if not exists item_assignee (
  item_id bigint not null references checklist_item (id) on delete cascade,
  user_id bigint not null references app_user (id),
  primary key (item_id, user_id)
);

create table if not exists item_comment (
  id         bigserial   primary key,
  item_id    bigint      not null references checklist_item (id) on delete cascade,
  author_id  bigint      not null references app_user (id),
  body       text        not null,
  created_at timestamptz not null default now()
);

-- Audittrail. Alleen toevoegen: wijzigen en verwijderen zijn geblokkeerd met
-- een trigger. Zonder dit is "wie deed wat wanneer" een bewering in plaats van
-- een vastlegging, en daar heb je bij een MD-controle niets aan.
create table if not exists item_event (
  id        bigserial   primary key,
  item_id   bigint      not null references checklist_item (id),
  org_id    bigint      not null references organization (id),
  user_id   bigint      references app_user (id),
  at        timestamptz not null default now(),
  field     text        not null,
  old_value text,
  new_value text
);

create or replace function refuse_change() returns trigger language plpgsql as $$
begin
  raise exception 'item_event is append-only';
end;
$$;

drop trigger if exists item_event_immutable on item_event;
create trigger item_event_immutable
  before update or delete on item_event
  for each row execute function refuse_change();

create table if not exists session (
  token      text        primary key,
  user_id    bigint      not null references app_user (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen  timestamptz not null default now()
);

-- Rem op herhaald proberen. Per gebruikersnaam, zodat één account niet
-- eindeloos geraden kan worden.
create table if not exists login_attempt (
  name        text        primary key,
  fails       integer     not null default 0,
  locked_till timestamptz
);

create index if not exists item_by_org_cat   on checklist_item (org_id, category_id);
create index if not exists item_by_patient   on checklist_item (org_id, link_type, patient_id);
create index if not exists item_by_staff     on checklist_item (org_id, link_type, staff_id);
create index if not exists item_open_by_date on checklist_item (org_id, deadline) where status <> 'done';
create index if not exists event_by_item     on item_event (item_id, at);
create index if not exists session_by_user   on session (user_id);
