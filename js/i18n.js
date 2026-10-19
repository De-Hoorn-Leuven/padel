export const LEVELS = ["beginner", "P25", "P50", "P100", "P200", "P300", "P500", "P700", "P1000"];

const dict = {
  nl: {
    loading: "Even laden…",
    signInIntro: "Log in om een plek op het veld te nemen, iemand mee te brengen of zelf een veld toe te voegen.",
    google: "Inloggen met Google",
    or: "of",
    emailLabel: "E-mailadres",
    sendLink: "Stuur me een inloglink",
    linkSent: "Check je mailbox: de inloglink staat klaar in {email}.",
    confirmEmail: "Bevestig je e-mailadres om in te loggen",
    heroSpot: "Jij?",
    signOut: "Afmelden",
    language: "Taal",

    navAgenda: "Agenda",
    navMembers: "Leden",
    navProfile: "Profiel",
    navAdmin: "Instellingen",

    registerTitle: "Maak je profiel aan",
    registerIntro: "Je naam, bedrijf en niveau zijn zichtbaar voor de andere leden, zodat je weet met wie je speelt.",
    firstName: "Voornaam",
    lastName: "Naam",
    company: "Bedrijf",
    level: "Niveau",
    levelHelp: "P25 is het instapniveau, P1000 het hoogste. Net begonnen? Kies Beginner.",
    inviteCode: "Uitnodigingscode",
    inviteHelp: "Je krijgt de code van de beheerder van de groep.",
    createProfile: "Profiel aanmaken",
    saveProfile: "Profiel bewaren",
    profileSaved: "Profiel bewaard",
    wrongInvite: "Die uitnodigingscode klopt niet. Controleer de code en probeer opnieuw.",
    beginner: "Beginner",
    signedInAs: "Ingelogd als {email}",

    agendaIntro: "Elke {day} van {start} tot {end} staat het communityveld klaar, in slots van 45 minuten. Veld vol of liever een ander moment? Boek zelf een veld in de padelhal en zet het hier.",
    agendaIntroCustom: "Elke {day} van {start} tot {end} staat het communityveld klaar. Veld vol of liever een ander moment? Boek zelf een veld in de padelhal en zet het hier.",
    today: "vandaag",
    emptyAgenda: "Er staat nog niets gepland. Voeg een veld toe dat je in de padelhal geboekt hebt.",
    community: "Communityveld",
    tagCommunity: "Vast veld",
    tagMember: "Bijgeboekt",
    memberBooking: "Veld van {name}",
    yourBooking: "Jouw veld",
    full: "Volzet",
    private: "Niet open voor leden",
    needMore: "Nog {n} nodig",
    playersCount: "{n} van 4 spelers",
    join: "Speel mee",
    guest: "Gast",
    addedBy: "toegevoegd door {name}",

    newBooking: "Veld toevoegen",
    newBookingIntro: "Reserveer eerst je veld bij de padelhal. Zet het daarna hier, zodat andere leden kunnen aansluiten.",
    date: "Datum",
    startTime: "Starttijd",
    duration: "Duur",
    splitLabel: "Opdelen in 2 × 45 minuten",
    splitHelp: "Alleen mogelijk bij 90 minuten.",
    openForMembers: "Open voor andere leden",
    openHelp: "Andere leden kunnen zich enkel inschrijven in de slots die je openzet. Jij kan in elk slot spelers toevoegen.",
    iPlay: "Speel je zelf mee?",
    iPlayYes: "Ja, ik speel mee",
    iPlayBoth: "Ja, in beide slots",
    iPlaySlot: "Alleen {time}",
    iPlayNone: "Nee, ik speel niet mee",
    note: "Opmerking, bv. veldnummer of hal",
    addBooking: "Veld toevoegen",
    bookingAdded: "Veld toegevoegd",
    cancel: "Annuleren",
    close: "Sluiten",

    addPlayer: "Speler toevoegen",
    addMe: "Mezelf toevoegen",
    addMember: "Een lid toevoegen",
    chooseMember: "Kies een lid",
    addGuest: "Iemand zonder account toevoegen",
    guestName: "Naam",
    add: "Toevoegen",
    playerAdded: "Speler toegevoegd",
    remove: "Verwijder",
    removeConfirm: "{name} uit dit slot verwijderen?",
    playerRemoved: "Speler verwijderd",

    deleteBooking: "Veld verwijderen",
    deleteConfirm: "Dit veld en alle inschrijvingen verwijderen?",
    bookingDeleted: "Veld verwijderd",
    cancelSession: "Sessie annuleren",
    restoreSession: "Sessie herstellen",
    cancelConfirm: "Het communityveld op {date} annuleren? Ingeschreven spelers zien dat de sessie niet doorgaat.",
    cancelledSession: "Deze sessie gaat niet door.",

    membersTitle: "Leden",
    searchMembers: "Zoek op naam, bedrijf of niveau",
    noMembers: "Geen leden gevonden.",

    adminTitle: "Vast communityveld",
    adminIntro: "Deze instellingen bepalen het wekelijkse communityveld. Sessies waarin al iemand ingeschreven staat, houden hun oorspronkelijke uren.",
    weekday: "Dag",
    location: "Locatie",
    saveSettings: "Instellingen bewaren",
    settingsSaved: "Instellingen bewaard",

    errFull: "Dit slot is intussen volzet.",
    errAlready: "Deze persoon staat al in dit slot.",
    errClosed: "Dit slot is niet open voor andere leden.",
    errCancelled: "Deze sessie is geannuleerd.",
    errGone: "Dit veld bestaat niet meer.",
    errPermission: "Je hebt geen rechten voor deze actie.",
    errGeneric: "Er ging iets mis: {msg}"
  },

  en: {
    loading: "Loading…",
    signInIntro: "Sign in to grab a spot on the court, bring someone along or add a court yourself.",
    google: "Sign in with Google",
    or: "or",
    emailLabel: "Email address",
    sendLink: "Email me a sign-in link",
    linkSent: "Check your inbox: we sent a sign-in link to {email}.",
    confirmEmail: "Confirm your email address to sign in",
    heroSpot: "You?",
    signOut: "Sign out",
    language: "Language",

    navAgenda: "Schedule",
    navMembers: "Members",
    navProfile: "Profile",
    navAdmin: "Settings",

    registerTitle: "Create your profile",
    registerIntro: "Your name, company and level are visible to other members, so everyone knows who they’re playing with.",
    firstName: "First name",
    lastName: "Last name",
    company: "Company",
    level: "Level",
    levelHelp: "P25 is the entry level, P1000 the highest. Just starting out? Pick Beginner.",
    inviteCode: "Invite code",
    inviteHelp: "Ask the group admin for the code.",
    createProfile: "Create profile",
    saveProfile: "Save profile",
    profileSaved: "Profile saved",
    wrongInvite: "That invite code is incorrect. Check the code and try again.",
    beginner: "Beginner",
    signedInAs: "Signed in as {email}",

    agendaIntro: "Every {day} from {start} to {end} the community court is ready, in 45-minute slots. Court full or prefer another time? Book a court at the padel centre and add it here.",
    agendaIntroCustom: "Every {day} from {start} to {end} the community court is ready. Court full or prefer another time? Book a court at the padel centre and add it here.",
    today: "today",
    emptyAgenda: "Nothing scheduled yet. Add a court you booked at the padel centre.",
    community: "Community court",
    tagCommunity: "Weekly court",
    tagMember: "Member booking",
    memberBooking: "{name}’s court",
    yourBooking: "Your court",
    full: "Full",
    private: "Not open to members",
    needMore: "{n} more needed",
    playersCount: "{n} of 4 players",
    join: "Join",
    guest: "Guest",
    addedBy: "added by {name}",

    newBooking: "Add a court",
    newBookingIntro: "Reserve the court at the padel centre first. Then add it here so other members can join.",
    date: "Date",
    startTime: "Start time",
    duration: "Duration",
    splitLabel: "Split into 2 × 45 minutes",
    splitHelp: "Only available for 90 minutes.",
    openForMembers: "Open to other members",
    openHelp: "Other members can only sign up for slots you open. You can add players to any slot.",
    iPlay: "Are you playing yourself?",
    iPlayYes: "Yes, I’m playing",
    iPlayBoth: "Yes, in both slots",
    iPlaySlot: "Only {time}",
    iPlayNone: "No, I’m not playing",
    note: "Note, e.g. court number or venue",
    addBooking: "Add court",
    bookingAdded: "Court added",
    cancel: "Cancel",
    close: "Close",

    addPlayer: "Add a player",
    addMe: "Add myself",
    addMember: "Add a member",
    chooseMember: "Choose a member",
    addGuest: "Add someone without an account",
    guestName: "Name",
    add: "Add",
    playerAdded: "Player added",
    remove: "Remove",
    removeConfirm: "Remove {name} from this slot?",
    playerRemoved: "Player removed",

    deleteBooking: "Delete court",
    deleteConfirm: "Delete this court and all sign-ups?",
    bookingDeleted: "Court deleted",
    cancelSession: "Cancel session",
    restoreSession: "Restore session",
    cancelConfirm: "Cancel the community court on {date}? Signed-up players will see the session is off.",
    cancelledSession: "This session is cancelled.",

    membersTitle: "Members",
    searchMembers: "Search by name, company or level",
    noMembers: "No members found.",

    adminTitle: "Weekly community court",
    adminIntro: "These settings define the weekly community court. Sessions that already have sign-ups keep their original times.",
    weekday: "Day",
    location: "Location",
    saveSettings: "Save settings",
    settingsSaved: "Settings saved",

    errFull: "This slot just filled up.",
    errAlready: "This person is already in this slot.",
    errClosed: "This slot isn’t open to other members.",
    errCancelled: "This session is cancelled.",
    errGone: "This court no longer exists.",
    errPermission: "You don’t have permission for this action.",
    errGeneric: "Something went wrong: {msg}"
  }
};

function stored() {
  try { return localStorage.getItem("padel.lang"); } catch { return null; }
}

let current = stored() || ((navigator.language || "").toLowerCase().startsWith("en") ? "en" : "nl");
if (!dict[current]) current = "nl";

export function getLang() { return current; }

export function setLang(lang) {
  if (!dict[lang]) return;
  current = lang;
  try { localStorage.setItem("padel.lang", lang); } catch { /* storage unavailable */ }
  document.documentElement.lang = lang;
}

export function locale() { return current === "nl" ? "nl-BE" : "en-GB"; }

export function t(key, vars = {}) {
  const s = dict[current][key] ?? dict.nl[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}
