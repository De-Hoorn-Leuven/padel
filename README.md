# Community Padel – boekingstool

Statische webapp (HTML/CSS/JS, geen build-stap) voor GitHub Pages, met Firebase Authentication en Firestore.

## Wat het doet

- **Vast communityveld**: elke week op een vaste dag (start: dinsdag 12:00–13:30), opgedeeld in 2 slots van 45 minuten met elk 4 plaatsen. Wordt automatisch 8 weken vooruit getoond.
- **Bijgeboekte velden**: leden die zelf een veld in de padelhal reserveren (60 of 90 min) zetten het hier. Bij 90 min kunnen ze het opdelen in 2 × 45 min en per slot kiezen of het open staat voor andere leden.
- **Inschrijven**: leden zetten zichzelf in een slot, of een ander lid, of iemand zonder account (gast). Max. 4 per slot, bewaakt met een transactie zodat er nooit een 5e bij komt.
- **Profiel**: voornaam, naam, bedrijf en niveau (Beginner, P25 t.e.m. P1000).
- **NL/EN**: taalkeuze rechtsboven, wordt onthouden per browser.
- **Admin**: dag, uur, duur en locatie van het communityveld aanpassen, en een sessie annuleren of herstellen.

Wie mag wat:

| Actie | Wie |
|---|---|
| Zichzelf of anderen inschrijven in het communityveld | alle leden |
| Inschrijven in een bijgeboekt slot | alle leden als het slot open staat; de eigenaar altijd |
| Iemand uitschrijven | de speler zelf, wie hem toevoegde, de eigenaar van het veld, admins |
| Veld verwijderen | eigenaar, admins |
| Instellingen communityveld, sessie annuleren | admins |

## Opzetten

### 1. Firebase

1. Maak een project op <https://console.firebase.google.com> en voeg een **web-app** toe.
2. Kopieer de config in `js/config.js`. Deze waarden zijn publiek; de beveiliging zit in de Firestore rules.
3. **Authentication → Sign-in method**
   - Zet **Google** aan.
   - Zet **E-mail/wachtwoord** aan én de optie **E-maillink (aanmelden zonder wachtwoord)**.
4. **Authentication → Settings → Authorized domains**: voeg `de-hoorn.github.io` toe (of het domein waarop je publiceert).
5. **Firestore Database** aanmaken (bv. regio `europe-west1`), daarna bij **Rules** de inhoud van `firestore.rules` plakken en publiceren.
6. Maak in Firestore het document `config/invite` met één veld: `code` (string), bv. `padel2026`. Dat is de code die nieuwe leden nodig hebben om zich te registreren. Wijzig hem gerust; bestaande leden blijven lid.
7. Registreer jezelf in de app, ga in Firestore naar `members/<jouw uid>` en voeg het veld `role` = `admin` toe. Daarna verschijnt het tabblad **Instellingen**.

`config/settings` hoef je niet aan te maken: zonder dat document gebruikt de app dinsdag 12:00, 90 min, opgedeeld in 2 × 45 min. Het wordt aangemaakt zodra een admin de instellingen bewaart.

### 2. GitHub Pages

1. Maak een repo in de organisatie, bv. `De-Hoorn/padel`, en push deze map naar `main`.
2. **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, map `/ (root)`.
3. De site staat na een minuutje op `https://de-hoorn.github.io/padel/`.

Let op: op het gratis GitHub-plan werkt Pages alleen voor **publieke** repo’s. Dat is geen probleem voor deze app: er staan geen geheimen in de code.

## Datamodel

```
config/settings   { weekday (0=zo … 2=di), start "12:00", duration 60|90, split bool, location }
config/invite     { code }                                   ← enkel via console
members/{uid}     { firstName, lastName, company, level, inviteCode, role? }
bookings/{id}     { type: "community"|"member", date "YYYY-MM-DD", start, duration, split,
                    note|location, cancelled, createdBy,
                    slots: [ { start, end, open, players: [ { uid|null, name, addedBy } ] } ] }
```

Communitysessies krijgen het id `community_YYYY-MM-DD` en worden pas als document aangemaakt bij de eerste inschrijving. Daardoor gelden gewijzigde instellingen automatisch voor alle sessies waar nog niemand in staat, terwijl sessies met inschrijvingen hun uren behouden.

## Bekende beperkingen

- Leden vertrouwen elkaar: de rules beperken gewone leden tot het wijzigen van spelerslijsten (max. 4 per slot), maar controleren niet per speler wie wie mag verwijderen. De app zelf doet dat wel.
- De app boekt niets bij de padelhal zelf; het reserveren daar gebeurt zoals nu, de tool is de gedeelde agenda erbovenop.
