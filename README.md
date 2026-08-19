# MD-READY — Prototyp

Klikbaar front-end prototype van de checklist- en auditvoorbereidingsapplicatie voor Pflegedienste, gebaseerd op de functionele specificatie.

**Belangrijk:** dit is een demo zonder echt backend. Alle data is fictief en wordt alleen lokaal in de browser opgeslagen (`localStorage`). Er is geen echte authenticatie — de gebruikersswitch linksonder is puur om de twee rollen te kunnen tonen. Voer hier geen echte patiënt- of medewerkersgegevens in, zeker niet als deze repository (ook tijdelijk) publiek op GitHub staat.

## Demo-accounts

- **Nasrat** — Pflegedienst Admin (ziet alles: Checkliste incl. Personal, Patiënten, Beheer, CSV-export)
- **Michael** — Mitarbeiter (ziet Dashboard en Checkliste zonder de Personal-categorie, geen Beheer/export)

## Lokaal bekijken

Geen build-stap nodig — open `index.html` direct in de browser, of start een lokale server:

```bash
cd app
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
