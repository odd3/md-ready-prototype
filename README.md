# MD-READY — Prototyp

Klikbaar front-end prototype van de checklist- en auditvoorbereidingsapplicatie voor Pflegedienste, gebaseerd op de functionele specificatie.

**Belangrijk:** dit is een demo zonder echt backend. Alle data is fictief. Er is geen echte authenticatie — je kiest bij het opstarten alleen wie je bent, zodat je handelingen op naam komen te staan; dat is naamsvermelding, geen toegangsbeveiliging. Voer hier geen echte patiënt- of medewerkersgegevens in, zeker niet als deze repository (ook tijdelijk) publiek op GitHub staat.

## Waar de gegevens staan

Bij het opstarten kies je één keer waar de gegevens terechtkomen:

**Een map op het netwerk** — de applicatie schrijft `mdready-daten.json` in een map die jij aanwijst, plus elke dag één kopie `mdready-daten.backup-JJJJ-MM-DD.json`. De code komt van internet, de gegevens blijven in het pand.

Twee dingen om te weten:

- Dit werkt alleen in **Chrome of Edge**, en alleen als de pagina via **https of localhost** wordt geladen. Open je `index.html` rechtstreeks vanaf de schijf (`file://`), dan geldt dat niet als veilige context en biedt de browser het schrijven naar een map niet aan. Gebruik dan de tweede optie, of zet de bestanden op een webadres.
- **Eén persoon tegelijk.** Naast de gegevens staat `mdready.lock` met wie het bestand openheeft. Wie als tweede opent krijgt dat te zien, met hoe lang geleden er voor het laatst iets gebeurde, en kan alleen-lezen verder of de sessie overnemen. De grendel wordt elke 30 seconden ververst en vervalt na twee minuten stilte.

### Een vergeten sessie overnemen

Staat er een pc open terwijl de collega ziek of weg is, dan blijft de hartslag gewoon doorlopen en vervalt de grendel niet. Daarom kan een overname altijd worden afgedwongen, ook bij een actieve grendel. Er gaat niets verloren:

1. Vóór de overname wordt `mdready-daten.vor-uebernahme-<datum-tijd>.json` weggeschreven — het punt om op terug te vallen.
2. Het gegevensbestand wordt opnieuw ingelezen, zodat het laatste werk van de ander meekomt.
3. De overgenomen sessie merkt het — bij de eerstvolgende schrijfpoging, en anders binnen 30 seconden — en gaat naar alleen-lezen met een melding in beeld.
4. Had die sessie nog iets klaarstaan dat niet was weggeschreven, dan gaat dat naar `mdready-uebergabe-<naam>-<datum-tijd>.json`. Niet naar het hoofdbestand, want daar werkt inmiddels een ander in.

Dat laatste is de reden dat de overgenomen sessie moet stoppen met schrijven: zonder die controle zou een vergeten browser blijven opslaan over het werk van degene die het heeft overgenomen.

**Afmelden** onderin de zijbalk schrijft eerst weg en geeft dan de grendel vrij, zodat een collega er meteen in kan zonder iets te hoeven overnemen.

**Alleen op deze computer** — de oude demo-modus: alles blijft in `localStorage` van deze browser en niemand anders ziet het. Prima om te proberen, niet om mee te werken.

In beide gevallen blijft de naam waaronder je werkt op de werkplek staan en gaat hij niet mee het gedeelde bestand in — anders erft de volgende die het opent de naam van de vorige.

## Demo-accounts

- **Nasrat** — Pflegedienst Admin (ziet alles: Checkliste incl. Personal, Patiënten, Beheer, CSV-export)
- **Michael** — Mitarbeiter (ziet Dashboard en Checkliste zonder de Personal-categorie, geen Beheer/export)

## Lokaal bekijken

Geen build-stap nodig, maar start wel een lokale server — rechtstreeks `index.html` openen werkt wel, maar schakelt het opslaan in een netwerkmap uit (zie hierboven):

```bash
python3 -m http.server 8080
```

Ga daarna naar `http://localhost:8080`.

## Hosten op GitHub Pages

1. Push deze map naar een GitHub-repository.
2. Ga naar **Settings → Pages**.
3. Kies bij **Source**: de branch (bijv. `main`) en map `/app` (of `/root` als je deze map als repo-root gebruikt).
4. GitHub genereert een tijdelijke URL zoals `https://<gebruiker>.github.io/<repo>/`.

## Status

Dit is een klikbaar prototype ter validatie van de schermen en werking uit de functionele specificatie — nog geen productieklare applicatie. Backend, echte authenticatie, multi-tenant datamodel en beveiliging volgen in de architectuurfase.
