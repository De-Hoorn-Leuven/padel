# De Hoorn Padel Hub – boekingstool

Statische webapp (HTML/CSS/JS, geen build-stap) voor GitHub Pages, met Firebase Authentication en Firestore.

## Wat het doet

- **Vast members-veld**: elke week op een vaste dag (start: dinsdag 12:00–13:30), opgedeeld in 2 slots van 45 minuten met elk 4 plaatsen. Wordt automatisch 8 weken vooruit getoond.
- **Bijgeboekte velden**: leden die zelf (op eigen kosten) een veld in de padelhal reserveren (60 of 90 min) zetten het hier. Bij 90 min kunnen ze het opdelen in 2 × 45 min en kiezen welk deel ze delen. Een niet-gedeeld slot is privé: niemand kan het invullen, ook de maker niet. De maker kan zelf veld en deurcode van zijn veld invullen.
- **Inschrijven**: leden zetten zichzelf in een slot, of een ander lid, of iemand zonder account (gast). Max. 4 per slot, bewaakt met een transactie zodat er nooit een 5e bij komt.
- **Profiel**: voornaam, naam, bedrijf en niveau (Beginner, P25 t.e.m. P1000).
- **NL/EN**: taalkeuze rechtsboven, wordt onthouden per browser.
- **Admin**: het vaste members-veld instellen, elk veld of elke sessie bewerken of annuleren, spelers verwijderen, leden corrigeren of hun toegang intrekken, en oude velden opkuisen.

Wie mag wat:

| Actie | Wie |
|---|---|
| Zichzelf of anderen inschrijven in het members-veld | alle leden |
| Inschrijven in een bijgeboekt slot | alle leden, enkel in het gedeelde deel (ook de maker) |
| Iemand uitschrijven | de speler zelf, wie hem toevoegde, de eigenaar van het veld, admins |
| Veld verwijderen | eigenaar, admins |
| Veld bewerken (datum, uur, opdeling, open slots) | eigenaar, admins |
| Eén members-veldsessie bewerken, annuleren of herstellen | admins |
| Vaste velden toevoegen, bewerken, (de)activeren | admins |
| Uitnodigingscode wijzigen | admins |
| Leden bewerken, rol kiezen (lid, manager padelhal, admin), toegang intrekken | admins |
| Lid verwijderen (na intrekken van de toegang) | admins |
| Veld (cijfer/letter) en deurcode per sessie instellen | manager padelhal, admins; bij een eigen veld ook de maker |
| Veld van een sessie zien | iedereen |
| Deurcode van een sessie zien | spelers van die sessie, wie er een gast toevoegde, manager, admins |
| Oude velden in één keer verwijderen | admins |

## Logo

De logobestanden staan in `img/`: de witte zeshoek voor de blauwe balk, het volledige logo voor het inlogscherm (een donkere en een lichte versie) en het favicon. De paden staan in `js/config.js`.

## Opzetten

### 1. Firebase

1. Maak een project op <https://console.firebase.google.com> en voeg een **web-app** toe.
2. Kopieer de config in `js/config.js`. Deze waarden zijn publiek; de beveiliging zit in de Firestore rules.
3. **Authentication → Sign-in method**
   - Zet **Google** aan.
   - Zet **E-mail/wachtwoord** aan. De optie *E-maillink* is niet nodig.
4. **Authentication → Settings → Authorized domains**: voeg `de-hoorn-leuven.github.io` toe (of het domein waarop je publiceert).
5. **Firestore Database** aanmaken (bv. regio `europe-west1`), daarna bij **Rules** de inhoud van `firestore.rules` plakken en publiceren.
6. Maak in Firestore het document `config/invite` met één veld: `code` (string), bv. `padel2026`. Dat is de code die nieuwe leden nodig hebben om zich te registreren. Wijzig hem gerust; bestaande leden blijven lid.
7. Registreer jezelf in de app, ga in Firestore naar `members/<jouw uid>` en voeg het veld `role` = `admin` toe. Daarna verschijnt het tabblad **Instellingen**.

`config/settings` hoef je niet aan te maken: zonder dat document gebruikt de app dinsdag 12:00, 90 min, opgedeeld in 2 × 45 min. Het wordt aangemaakt zodra een admin de instellingen bewaart.

### 2. GitHub Pages

1. Maak een repo in de organisatie, bv. `De-Hoorn-Leuven/padel`, en push deze map naar `main`.
2. **Settings → Pages → Build and deployment**: *Deploy from a branch*, branch `main`, map `/ (root)`.
3. De site staat na een minuutje op `https://de-hoorn-leuven.github.io/padel/`.

Let op: op het gratis GitHub-plan werkt Pages alleen voor **publieke** repo’s. Dat is geen probleem voor deze app: er staan geen geheimen in de code.

## Datamodel

```
config/settings   { name, weekday (0=zo … 2=di), start "12:00", duration 60|90, split bool, location, active, startDate, endDate, onePerMember }  ← het oorspronkelijke vaste veld
config/invite     { code }                                   ← enkel admins
recurring/{id}    { name, weekday, start, duration, split, location, active, startDate, endDate, onePerMember, court? }  ← extra vaste velden
members/{uid}     { firstName, lastName, company, level, inviteCode, role? (admin|manager), blocked? }
doorCodes/{sessie-id} { code, date, updatedBy }               ← enkel leesbaar voor spelers van die sessie
bookings/{id}     { type: "community"|"member", date "YYYY-MM-DD", start, duration, split, title?, recurringId?, accessUids, court?,
                    note|location, cancelled, createdBy,
                    slots: [ { start, end, open, players: [ { uid|null, name, addedBy } ] } ] }
```

Members-veldsessies krijgen het id `community_YYYY-MM-DD` en worden pas als document aangemaakt bij de eerste inschrijving. Daardoor gelden gewijzigde instellingen automatisch voor alle sessies waar nog niemand in staat, terwijl sessies met inschrijvingen hun uren behouden.

## Bekende beperkingen

- Een lid verwijderen wist het profiel, niet het login-account. Dat kan enkel in de Firebase-console (Authentication → Users). Zonder dat kan de persoon zich met de uitnodigingscode opnieuw registreren.

- Deurcodes staan afgeschermd in `doorCodes`: de Firestore rules geven enkel leestoegang aan wie in de lijst `accessUids` van die sessie staat. De app houdt die lijst gelijk met de spelers. Een lid met technische kennis zou die lijst rechtstreeks kunnen aanpassen; voor een groep die elkaar kent is dat aanvaardbaar, maar kies geen code die ook elders toegang geeft.

- De regel "één lopende inschrijving per lid" wordt door de app afgedwongen, niet door de Firestore rules (die kunnen geen inschrijvingen tellen). Voor een groep die elkaar kent volstaat dat.

- Leden vertrouwen elkaar: de rules beperken gewone leden tot het wijzigen van spelerslijsten (max. 4 per slot), maar controleren niet per speler wie wie mag verwijderen. De app zelf doet dat wel.
- De app boekt niets bij de padelhal zelf; het reserveren daar gebeurt zoals nu, de tool is de gedeelde agenda erbovenop.
