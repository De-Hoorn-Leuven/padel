import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  query, where, orderBy, onSnapshot, runTransaction, serverTimestamp,
  getDocs, writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, appConfig } from "./config.js";
import { t, getLang, setLang, locale, LEVELS } from "./i18n.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const CAPACITY = 4;
const DEFAULT_SETTINGS = { weekday: 2, start: "12:00", duration: 90, split: true, location: "" };

const state = {
  user: null,
  member: null,
  loading: true,
  members: {},
  settings: { ...DEFAULT_SETTINGS },
  recurring: [], // extra vaste velden uit de collectie "recurring"
  bookings: [],
  view: "agenda",
  memberSearch: "",
  modalCtx: null,
  authMode: "signin", // "signin" of "signup"
  blocked: false,
  codes: {} // deurcodes per sessie-id, alleen die je mag zien
};
const codeListeners = new Map();
let managerCodesUnsub = null;
let listeners = [];

const $top = document.getElementById("topbar");
const $main = document.getElementById("main");
const $banner = document.getElementById("banner");
const $modal = document.getElementById("modal");
const $modalBody = document.getElementById("modal-body");
const $toast = document.getElementById("toast");

/* ---------- helpers ---------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const uid = () => state.user?.uid;
const isAdmin = () => state.member?.role === "admin";
const isManager = () => ["manager", "admin"].includes(state.member?.role);
// Veld en deurcode: de manager voor elke sessie, de maker voor zijn eigen veld.
const canEditCourtCode = (b) => isManager() || (b.type === "member" && b.createdBy === uid());

// Wie de deurcode van een sessie mag zien: de spelers zelf, en wie een gast toevoegde.
const accessUidsOf = (slots) =>
  [...new Set(slots.flatMap((s) => (s.players || []).map((p) => p.uid || p.addedBy)).filter(Boolean))];
const activeMembers = () => Object.values(state.members).filter((m) => !m.blocked);
const fullName = (m) => `${m?.firstName ?? ""} ${m?.lastName ?? ""}`.trim();
const levelLabel = (l) => (l === "beginner" ? t("beginner") : l || "");
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const byName = (a, b) => (a.lastName || "").localeCompare(b.lastName || "", locale()) || (a.firstName || "").localeCompare(b.firstName || "", locale());

function dateLabel(s) {
  return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(parseYmd(s));
}
function weekdayName(n) {
  // 4 januari 2026 is een zondag (getDay() === 0)
  return new Intl.DateTimeFormat(locale(), { weekday: "long" }).format(new Date(2026, 0, 4 + Number(n)));
}

function buildSlots(start, duration, split, openFlags = [true, true]) {
  const s = toMin(start);
  if (split && duration === 90) {
    return [0, 1].map((i) => ({ start: fromMin(s + 45 * i), end: fromMin(s + 45 * (i + 1)), open: !!openFlags[i], players: [] }));
  }
  return [{ start, end: fromMin(s + duration), open: !!openFlags[0], players: [] }];
}

let toastTimer;
function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.className = ""; }, 4000);
}

function errMsg(e) {
  if (e?.i18n) return t(e.i18n, e.vars || {});
  const map = { closingHasPlayers: "errClosingHasPlayers", full: "errFull", already: "errAlready", closed: "errClosed", cancelled: "errCancelled", gone: "errGone", slotHasPlayers: "errSlotHasPlayers" };
  if (map[e?.message]) return t(map[e.message]);
  if (e?.code === "permission-denied") return t("errPermission");
  const authMap = {
    "auth/invalid-credential": "errLogin",
    "auth/wrong-password": "errLogin",
    "auth/user-not-found": "errLogin",
    "auth/invalid-email": "errEmail",
    "auth/email-already-in-use": "errEmailInUse",
    "auth/weak-password": "errWeakPassword",
    "auth/too-many-requests": "errTooMany",
    "auth/network-request-failed": "errNetwork"
  };
  if (authMap[e?.code]) return t(authMap[e.code]);
  console.error(e);
  return t("errGeneric", { msg: e?.message || String(e) });
}

function openModal(html, ctx = null) {
  state.modalCtx = ctx;
  $modalBody.innerHTML = html + `<button class="modal-x" type="button" data-action="close-modal" aria-label="${esc(t("close"))}">×</button>`;
  if (!$modal.open) $modal.showModal();
}
function closeModal() {
  if ($modal.open) $modal.close();
  state.modalCtx = null;
}
$modal.addEventListener("click", (e) => { if (e.target === $modal) closeModal(); });
$modal.addEventListener("close", () => { state.modalCtx = null; });

/* ---------- data ---------- */

function stopListeners() {
  listeners.forEach((u) => u());
  listeners = [];
  codeListeners.forEach((u) => u());
  codeListeners.clear();
  if (managerCodesUnsub) { managerCodesUnsub(); managerCodesUnsub = null; }
  state.codes = {};
}

// Managers en admins volgen alle deurcodes; leden enkel die van sessies waarin ze staan.
// De Firestore rules dwingen dat ook af, dit volgt gewoon dezelfde lijn.
function syncCodeListeners() {
  if (!state.member) return;
  if (isManager()) {
    codeListeners.forEach((u) => u());
    codeListeners.clear();
    if (!managerCodesUnsub) {
      managerCodesUnsub = onSnapshot(collection(db, "doorCodes"), (snap) => {
        const c = {};
        snap.forEach((d) => { c[d.id] = d.data(); });
        state.codes = c;
        refresh();
      }, onListenError);
    }
    return;
  }
  if (managerCodesUnsub) { managerCodesUnsub(); managerCodesUnsub = null; state.codes = {}; }
  const want = new Set(state.bookings
    .filter((b) => (b.accessUids || []).includes(uid()) || (b.type === "member" && b.createdBy === uid()))
    .map((b) => b.id));
  for (const [id, unsub] of codeListeners) {
    if (!want.has(id)) { unsub(); codeListeners.delete(id); delete state.codes[id]; }
  }
  for (const id of want) {
    if (codeListeners.has(id)) continue;
    codeListeners.set(id, onSnapshot(doc(db, "doorCodes", id), (snap) => {
      if (snap.exists()) state.codes[id] = snap.data();
      else delete state.codes[id];
      refresh();
    }, () => { /* net uitgeschreven: geen toegang meer, niets te melden */ }));
  }
}

function startListeners() {
  stopListeners();
  listeners.push(onSnapshot(collection(db, "members"), (snap) => {
    const m = {};
    snap.forEach((d) => { m[d.id] = { id: d.id, ...d.data() }; });
    state.members = m;
    if (m[uid()]?.blocked) { lockOut(); return; }
    if (m[uid()]) state.member = m[uid()];
    syncCodeListeners();
    refresh();
  }, onListenError));

  listeners.push(onSnapshot(doc(db, "config", "settings"), (snap) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    refresh();
  }, onListenError));

  listeners.push(onSnapshot(collection(db, "recurring"), (snap) => {
    state.recurring = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    refresh();
  }, onListenError));

  const q = query(collection(db, "bookings"), where("date", ">=", ymd(new Date())), orderBy("date"));
  listeners.push(onSnapshot(q, (snap) => {
    state.bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    syncCodeListeners();
    refresh();
  }, onListenError));
}

function onListenError(e) { toast(errMsg(e), true); }

// Alle vaste velden: het oorspronkelijke (config/settings, id "default") plus de extra uit "recurring".
function recurringList() {
  const def = { ...state.settings, id: "default" };
  return [def, ...state.recurring]
    .map((r) => ({ ...r, duration: Number(r.duration) || 90, weekday: Number(r.weekday) }))
    .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.start.localeCompare(b.start));
}
const activeRecurring = () => recurringList().filter((r) => r.active !== false);
const recurringName = (r) => r?.name || t("community");

// Het oorspronkelijke vaste veld houdt zijn oude id-vorm, zodat bestaande inschrijvingen blijven kloppen.
const sessionId = (recId, date) => (recId === "default" ? `community_${date}` : `community_${recId}_${date}`);

// Data binnen de afgesproken periode. Zonder einddatum tonen we weeksAhead weken vooruit.
function recurringDates(r) {
  const out = [];
  const today = ymd(new Date());
  const from = r.startDate && r.startDate > today ? r.startDate : today;
  const d = parseYmd(from);
  d.setDate(d.getDate() + ((r.weekday - d.getDay() + 7) % 7));
  const limit = r.endDate || null;
  const max = limit ? 60 : (appConfig.weeksAhead || 8);
  for (let i = 0; i < max; i++) {
    const day = ymd(d);
    if (limit && day > limit) break;
    out.push(day);
    d.setDate(d.getDate() + 7);
  }
  return out;
}

const inPeriod = (r, date) => (!r.startDate || date >= r.startDate) && (!r.endDate || date <= r.endDate);
const recurringFor = (b) => recurringList().find((r) => r.id === (b.recurringId || "default"));
const shortDate = (s) => new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long" }).format(parseYmd(s));

function periodText(r) {
  const today = ymd(new Date());
  const from = r.startDate && r.startDate > today ? shortDate(r.startDate) : null;
  const to = r.endDate ? shortDate(r.endDate) : null;
  if (from && to) return t("periodFromTo", { from, to });
  if (to) return t("periodTo", { to });
  if (from) return t("periodFrom", { from });
  return "";
}

// Max. één lopende inschrijving per lid op een vast veld. Een gast telt mee voor wie hem toevoegde.
// Admins mogen altijd corrigeren.
function limitConflict(b, player) {
  if (b.type !== "community" || isAdmin()) return null;
  const rec = recurringFor(b);
  if (!rec || rec.onePerMember === false) return null;
  const who = player.uid || uid();
  const today = ymd(new Date());
  return state.bookings.find((x) =>
    x.type === "community" && x.id !== b.id && !x.cancelled && x.date >= today &&
    (x.recurringId || "default") === rec.id && inPeriod(rec, x.date) &&
    x.slots?.some((s) => s.players?.some((p) => p.uid === who || (!p.uid && p.addedBy === who)))) || null;
}

function limitError(b, player) {
  const other = limitConflict(b, player);
  if (!other) return null;
  const who = player.uid || uid();
  const err = new Error("limit");
  err.i18n = who === uid() ? "errLimitSelf" : "errLimitOther";
  err.vars = { who: fullName(state.members[who]) || player.name, date: dateLabel(other.date), name: recurringName(recurringFor(b)) };
  return err;
}

function virtualCommunity(r, date) {
  return {
    id: sessionId(r.id, date), type: "community", recurringId: r.id, name: r.name || "",
    date, start: r.start, duration: r.duration,
    split: !!r.split && r.duration === 90, location: r.location || "", cancelled: false,
    createdBy: null, virtual: true,
    slots: buildSlots(r.start, r.duration, !!r.split, [true, true])
  };
}

function agendaItems() {
  const today = ymd(new Date());
  const items = new Map();
  for (const r of activeRecurring()) {
    for (const d of recurringDates(r)) items.set(sessionId(r.id, d), virtualCommunity(r, d));
  }
  for (const b of state.bookings) {
    if (b.type === "community") {
      const rec = recurringFor(b);
      if (rec && !inPeriod(rec, b.date)) continue;
    }
    items.set(b.id, b);
  }
  return [...items.values()]
    .filter((b) => b.date >= today)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || (a.type === "community" ? -1 : 1));
}

const findBooking = (id) => agendaItems().find((b) => b.id === id);

function canAdd(b, slot) {
  if (!state.member || b.cancelled) return false;
  // Bij een eigen veld is enkel het gedeelde deel invulbaar, ook voor de maker zelf.
  return b.type === "community" || slot.open !== false;
}
function canRemove(b, p) {
  return p.uid === uid() || p.addedBy === uid() || b.createdBy === uid() || isAdmin();
}

// Wijzigt één slot binnen een transactie, zodat twee mensen niet tegelijk de 5e plek nemen.
// Een communitysessie bestaat pas als document zodra iemand zich inschrijft.
async function mutateBooking(b, fn) {
  const ref = doc(db, "bookings", b.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    let data;
    if (snap.exists()) {
      data = snap.data();
    } else if (b.type === "community") {
      const { virtual, id, ...rest } = b;
      data = { ...rest, createdAt: serverTimestamp() };
    } else {
      throw new Error("gone");
    }
    const slots = data.slots.map((s) => ({ ...s, players: [...(s.players || [])] }));
    const extra = fn(slots, data) || {};
    const accessUids = accessUidsOf(slots);
    if (snap.exists()) tx.update(ref, { slots, accessUids, ...extra, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...data, slots, accessUids, ...extra, updatedAt: serverTimestamp() });
  });
}

async function addPlayer(b, si, player) {
  try {
    const limit = limitError(b, player);
    if (limit) throw limit;
    await mutateBooking(b, (slots, data) => {
      const slot = slots[si];
      if (!slot) throw new Error("gone");
      if (data.cancelled) throw new Error("cancelled");
      if (data.type !== "community" && slot.open === false) throw new Error("closed");
      if (slot.players.length >= CAPACITY) throw new Error("full");
      if (player.uid && slot.players.some((p) => p.uid === player.uid)) throw new Error("already");
      if (!player.uid && slot.players.some((p) => !p.uid && p.name.toLowerCase() === player.name.toLowerCase())) throw new Error("already");
      slot.players.push(player);
    });
    closeModal();
    toast(t("playerAdded"));
  } catch (e) {
    toast(errMsg(e), true);
  }
}

async function removePlayer(b, si, p) {
  try {
    await mutateBooking(b, (slots) => {
      const slot = slots[si];
      const i = slot ? slot.players.findIndex((x) => (x.uid ?? null) === (p.uid ?? null) && x.name === p.name && x.addedBy === p.addedBy) : -1;
      if (i >= 0) slot.players.splice(i, 1);
    });
    toast(t("playerRemoved"));
  } catch (e) {
    toast(errMsg(e), true);
  }
}

/* ---------- auth ---------- */

onAuthStateChanged(auth, async (user) => {
  stopListeners();
  state.user = user;
  state.member = null;
  state.members = {};
  state.bookings = [];
  state.blocked = false;
  if (!user) {
    state.loading = false;
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    const snap = await getDoc(doc(db, "members", user.uid));
    if (snap.exists() && snap.data().blocked) {
      state.blocked = true;
    } else if (snap.exists()) {
      state.member = { id: snap.id, ...snap.data() };
      startListeners();
    }
  } catch (e) {
    toast(errMsg(e), true);
  }
  state.loading = false;
  render();
});

function lockOut() {
  stopListeners();
  closeModal();
  state.member = null;
  state.blocked = true;
  render();
}

/* ---------- rendering ---------- */

function render() {
  document.documentElement.lang = getLang();
  document.title = appConfig.name;
  renderTop();
  renderMain();
}

function refresh() {
  if (!state.member) return;
  renderTop();
  if (state.view === "agenda" || state.view === "codes") renderMain();
  else if (state.view === "members") {
    const el = document.getElementById("member-list");
    if (el) el.innerHTML = memberListHtml();
  } else if (state.view === "admin") {
    const el = document.getElementById("admin-members");
    if (el) el.innerHTML = adminMembersHtml();
    const rec = document.getElementById("admin-recurring");
    if (rec) rec.innerHTML = adminRecurringHtml();
  }
}

// Zeshoek in de balk; lukt het laden niet, dan valt het terug op het balletje.
function logoHtml(cls) {
  const src = appConfig.logo?.mark;
  const ball = `<span class="brand-mark" aria-hidden="true"${src ? " hidden" : ""}></span>`;
  if (!src) return ball;
  return `<img class="${cls}" src="${esc(src)}" alt="" onerror="this.nextElementSibling.hidden=false;this.remove()">${ball}`;
}

function renderTop() {
  const nav = state.member
    ? [["agenda", "navAgenda"], ["members", "navMembers"], ["profile", "navProfile"],
       ...(isManager() ? [["codes", "navCodes"]] : []), ...(isAdmin() ? [["admin", "navAdmin"]] : [])]
    : [];
  $top.innerHTML = `
    <div class="wrap topbar-inner">
      <a class="brand" href="#" data-action="view" data-view="agenda">${logoHtml("brand-logo")}${esc(appConfig.name)}</a>
      <nav class="nav" aria-label="Menu">
        ${nav.map(([v, k]) => `<button type="button" class="nav-link${state.view === v ? " is-active" : ""}" data-action="view" data-view="${v}"${state.view === v ? ' aria-current="page"' : ""}>${esc(t(k))}</button>`).join("")}
      </nav>
      <div class="lang" role="group" aria-label="${esc(t("language"))}">
        ${["nl", "en"].map((l) => `<button type="button" class="lang-btn${getLang() === l ? " is-active" : ""}" data-action="lang" data-lang="${l}" aria-pressed="${getLang() === l}">${l.toUpperCase()}</button>`).join("")}
      </div>
    </div>`;
}

// Grote foto op het inlogscherm, smalle strook boven de agenda, niets op de andere pagina's.
function renderBanner() {
  const b = appConfig.banner;
  const kind = !b || state.loading ? null
    : !state.user ? "hero"
    : state.member && state.view === "agenda" ? "strip"
    : null;
  if ($banner.dataset.kind === (kind || "")) return;
  $banner.dataset.kind = kind || "";
  $banner.className = kind ? `banner banner--${kind}` : "";
  $banner.innerHTML = kind
    ? `<img src="${esc(b.large)}" srcset="${esc(b.small)} 900w, ${esc(b.large)} 2000w" sizes="100vw" alt="" decoding="async"${kind === "hero" ? ' fetchpriority="high"' : ""}>`
    : "";
}

function renderMain() {
  renderBanner();
  if (state.loading) {
    $main.innerHTML = `<p class="loading">${esc(t("loading"))}</p>`;
    return;
  }
  if (!state.user) {
    $main.innerHTML = renderLogin();
    return;
  }
  if (state.blocked) {
    $main.innerHTML = `
      <section class="narrow">
        <h1>${esc(t("blockedTitle"))}</h1>
        <p class="lead">${esc(t("blockedText"))}</p>
        <div><button type="button" class="btn" data-action="signout">${esc(t("signOut"))}</button></div>
      </section>`;
    return;
  }
  if (!state.member) {
    $main.innerHTML = `
      <section class="narrow">
        <h1>${esc(t("registerTitle"))}</h1>
        <p class="lead">${esc(t("registerIntro"))}</p>
        ${profileForm({}, "register")}
        <button type="button" class="btn btn-ghost" data-action="signout">${esc(t("signOut"))}</button>
      </section>`;
    return;
  }
  if (state.view === "admin" && !isAdmin()) state.view = "agenda";
  if (state.view === "codes" && !isManager()) state.view = "agenda";
  const views = { agenda: renderAgenda, members: renderMembers, profile: renderProfile, admin: renderAdmin, codes: renderCodes };
  $main.innerHTML = views[state.view]();
  if (state.view === "admin") loadInviteCode();
}

function heroCourt() {
  const filled = ["AV", "JM", "SD"];
  const spot = (i) => filled[i]
    ? `<div class="spot spot--filled"><span class="avatar">${filled[i]}</span><span class="who"><span class="who-bar"></span><span class="who-bar who-bar--short"></span></span></div>`
    : `<div class="spot spot--empty spot--hero"><span class="plus" aria-hidden="true">+</span>${esc(t("heroSpot"))}</div>`;
  return `
    <div class="court-field court-field--hero" aria-hidden="true">
      <div class="court-half">${spot(0)}${spot(1)}</div>
      <div class="court-net"></div>
      <div class="court-half">${spot(2)}${spot(3)}</div>
    </div>`;
}

function renderLogin() {
  return `
    <section class="login">
      <div class="login-art">${heroCourt()}</div>
      <div class="login-box">
        ${appConfig.logo?.full && !appConfig.banner
          ? `<picture class="login-logo">
               ${appConfig.logo.fullDark ? `<source srcset="${esc(appConfig.logo.fullDark)}" media="(prefers-color-scheme: dark)">` : ""}
               <img src="${esc(appConfig.logo.full)}" alt="De Hoorn">
             </picture>
             <h1 class="display">${esc(appConfig.shortName || appConfig.name)}</h1>`
          : `<h1 class="display">${esc(appConfig.name)}</h1>`}
        <p class="lead">${esc(t("signInIntro"))}</p>
        <button type="button" class="btn btn-primary btn-block" data-action="google">${esc(t("google"))}</button>
        <div class="or"><span>${esc(t("or"))}</span></div>
        <form data-form="email-auth" class="stack">
          <label>${esc(t("emailLabel"))}<input type="email" name="email" required autocomplete="email"></label>
          <label>${esc(t("passwordLabel"))}
            <input type="password" name="password" required minlength="8"
              autocomplete="${state.authMode === "signup" ? "new-password" : "current-password"}">
            ${state.authMode === "signup" ? `<span class="help">${esc(t("passwordHelp"))}</span>` : ""}
          </label>
          <button class="btn btn-block">${esc(state.authMode === "signup" ? t("createAccount") : t("signInEmail"))}</button>
        </form>
        <div class="auth-links">
          ${state.authMode === "signup"
            ? `<button type="button" class="link" data-action="auth-mode" data-mode="signin">${esc(t("haveAccount"))}</button>`
            : `<button type="button" class="link" data-action="auth-mode" data-mode="signup">${esc(t("noAccount"))}</button>
               <button type="button" class="link" data-action="forgot">${esc(t("forgotPassword"))}</button>`}
        </div>
      </div>
    </section>`;
}

// Externe link naar de reservatietool van de club, opent in een nieuw tabblad.
function bookLink(cls) {
  const x = appConfig.externalBooking;
  if (!x?.url) return "";
  return `<a class="${cls}" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || x.url)}<span class="visually-hidden"> (${esc(t("opensNewTab"))})</span></a>`;
}

function renderAgenda() {
  const today = ymd(new Date());
  const lines = activeRecurring().filter((r) => !r.endDate || r.endDate >= today).map((r) => {
    const base = t("recurringLine", { name: recurringName(r), day: weekdayName(r.weekday), start: r.start, end: fromMin(toMin(r.start) + r.duration) });
    const period = periodText(r);
    return period ? `${base}, ${period}` : base;
  });
  const groups = [];
  for (const b of agendaItems()) {
    const last = groups[groups.length - 1];
    if (last && last.date === b.date) last.items.push(b);
    else groups.push({ date: b.date, items: [b] });
  }
  return `
    <div class="page-head">
      <div>
        <h1>${esc(t("navAgenda"))}</h1>
        ${lines.length ? `<ul class="recurring-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
        <p class="lead">${esc(t("agendaIntroLimit"))} ${esc(t("agendaIntroTail"))}</p>
        <p class="lead lead--share">${esc(t("agendaIntroShare"))}</p>
      </div>
      <div class="page-actions">
        ${bookLink("btn btn-book")}
        <button type="button" class="btn btn-primary" data-action="new-booking">${esc(t("newBooking"))}</button>
      </div>
    </div>
    ${groups.length
      ? groups.map((g) => `
        <section class="day">
          <h2 class="day-head">${esc(dateLabel(g.date))}${g.date === today ? ` <span class="today">${esc(t("today"))}</span>` : ""}</h2>
          ${g.items.map(renderBooking).join("")}
        </section>`).join("")
      : `<p class="empty">${esc(t("emptyAgenda"))}</p>`}`;
}

function renderBooking(b) {
  const owner = b.createdBy ? state.members[b.createdBy] : null;
  const mine = b.createdBy && b.createdBy === uid();
  const ownerName = owner ? fullName(owner) : "?";
  const title = b.type === "community"
    ? (() => { const rec = recurringList().find((r) => r.id === (b.recurringId || "default")); return rec ? recurringName(rec) : b.name || t("community"); })()
    : b.title || (mine ? t("yourBooking") : t("memberBooking", { name: ownerName }));
  // Met een eigen naam blijft de maker zichtbaar, zodat je weet wie je iets kan vragen.
  const byline = b.type === "member" && b.title
    ? t(mine ? "byYou" : "byName", { name: ownerName, company: owner?.company ? ` (${owner.company})` : "" })
    : "";
  const end = fromMin(toMin(b.start) + Number(b.duration));
  const where = b.type === "community" ? b.location : b.note;
  const actions = [];
  if (!b.cancelled && (mine || isAdmin())) {
    actions.push(`<button type="button" class="btn btn-ghost btn-small" data-action="edit-booking" data-booking="${esc(b.id)}">${esc(t("editBooking"))}</button>`);
  }
  if (b.type === "member" && (mine || isAdmin())) {
    actions.push(`<button type="button" class="btn btn-ghost btn-small" data-action="delete-booking" data-booking="${esc(b.id)}">${esc(t("deleteBooking"))}</button>`);
  }
  if (b.type === "community" && isAdmin()) {
    actions.push(`<button type="button" class="btn btn-ghost btn-small" data-action="toggle-cancel" data-booking="${esc(b.id)}">${esc(b.cancelled ? t("restoreSession") : t("cancelSession"))}</button>`);
  }
  return `
    <article class="booking booking--${b.type}${b.cancelled ? " is-cancelled" : ""}">
      <header class="booking-head">
        ${b.cancelled ? "" : courtBadge(courtOf(b))}
        <div class="booking-head-text">
          <p class="tag">${esc(b.type === "community" ? t("tagCommunity") : t("tagMember"))}</p>
          <h3>${esc(title)}</h3>
          ${byline ? `<p class="byline">${esc(byline)}</p>` : ""}
          <p class="booking-sub">${b.start}–${end}${where ? `, ${esc(where)}` : ""}</p>
        </div>
        ${actions.length ? `<div class="booking-actions">${actions.join("")}</div>` : ""}
      </header>
      ${b.cancelled ? "" : doorRow(b)}
      ${b.cancelled
        ? `<p class="cancel-note">${esc(t("cancelledSession"))}</p>`
        : `<div class="slots slots--${b.slots.length}">${b.slots.map((s, i) => renderCourt(b, s, i)).join("")}</div>`}
    </article>`;
}

function sessionTitle(b) {
  if (b.type === "community") { const rec = recurringFor(b); return rec ? recurringName(rec) : b.name || t("community"); }
  const owner = state.members[b.createdBy];
  return b.title || t("memberBooking", { name: owner ? fullName(owner) : "?" });
}

// Veldnummer of -letter: ingesteld per sessie, anders de standaard van het vaste veld.
function courtOf(b) {
  if (b.court) return b.court;
  if (b.type === "community") return recurringFor(b)?.court || "";
  return "";
}
const cleanCourt = (v) => (v || "").trim().slice(0, 1).toUpperCase();

function courtBadge(court, size = "") {
  if (!court) return "";
  return `<span class="court-sign${size ? ` court-sign--${size}` : ""}" role="img" aria-label="${esc(t("courtAria", { court }))}"><span class="court-sign-cap" aria-hidden="true">${esc(t("courtCap"))}</span><span class="court-sign-letter" aria-hidden="true">${esc(court)}</span></span>`;
}

const playerCount = (b) => (b.slots || []).reduce((n, s) => n + (s.players?.length || 0), 0);
const involvedIn = (b) => (b.slots || []).some((s) => s.players?.some((p) => p.uid === uid() || (!p.uid && p.addedBy === uid())));

function doorRow(b) {
  const code = state.codes[b.id]?.code;
  if (canEditCourtCode(b)) {
    return `
      <div class="door${code ? "" : " door--empty"}">
        ${code
          ? `<span class="door-label">${esc(t("doorCode"))}</span><strong class="door-code">${esc(code)}</strong>`
          : `<span class="door-label">${esc(t("doorNone"))}</span>`}
        <button type="button" class="btn btn-ghost btn-small" data-action="edit-code" data-booking="${esc(b.id)}">${esc(t("courtCodeEdit"))}</button>
      </div>`;
  }
  if (!involvedIn(b)) return "";
  return code
    ? `<div class="door"><span class="door-label">${esc(t("doorCode"))}</span><strong class="door-code">${esc(code)}</strong></div>`
    : `<div class="door door--empty"><span class="door-label">${esc(t("doorPending"))}</span></div>`;
}

function renderCodes() {
  const items = agendaItems().filter((b) => !b.cancelled);
  const rows = items.map((b) => {
    const code = state.codes[b.id]?.code;
    const n = playerCount(b);
    return `
      <li class="${!code && n ? "needs-code" : ""}">
        ${courtBadge(courtOf(b), "small") || `<span class="court-sign court-sign--small court-sign--empty" aria-hidden="true"><span class="court-sign-cap">${esc(t("courtCap"))}</span><span class="court-sign-letter">?</span></span>`}
        <span class="who">
          <span class="who-name">${esc(dateLabel(b.date))}, ${b.start}–${fromMin(toMin(b.start) + Number(b.duration))}</span>
          <span class="who-meta">${esc(sessionTitle(b))}, ${esc(t("codesPlayers", { n }))}</span>
        </span>
        ${code ? `<strong class="door-code">${esc(code)}</strong>` : `<span class="badge${n ? " badge--off" : " badge--muted"}">${esc(t("doorNone"))}</span>`}
        <span class="row-actions">
          <button type="button" class="btn btn-ghost btn-small" data-action="edit-code" data-booking="${esc(b.id)}">${esc(t("courtCodeEdit"))}</button>
        </span>
      </li>`;
  }).join("");
  return `
    <section class="narrow narrow--wide">
      <h1>${esc(t("codesTitle"))}</h1>
      <p class="lead">${esc(t("codesIntro"))}</p>
      ${items.length ? `<ul class="member-list member-list--admin codes-list">${rows}</ul>` : `<p class="empty">${esc(t("codesEmpty"))}</p>`}
    </section>`;
}

function openDoorCode(b) {
  const code = state.codes[b.id]?.code || "";
  const fallback = b.type === "community" ? recurringFor(b)?.court || "" : "";
  openModal(`
    <h2>${esc(t("courtCodeTitle"))}</h2>
    <p class="muted">${esc(sessionTitle(b))}, ${esc(dateLabel(b.date))}, ${b.start}–${fromMin(toMin(b.start) + Number(b.duration))}</p>
    <form data-form="door-code" class="stack">
      <div class="court-field-row">
        <label>${esc(t("courtLabel"))}
          <input name="court" class="court-input" maxlength="1" autocomplete="off" pattern="[A-Za-z0-9]" value="${esc(b.court || "")}" placeholder="${esc(fallback || "–")}">
        </label>
        <span class="help">${esc(fallback ? t("courtHelpDefault", { court: fallback }) : t("courtHelp"))}</span>
      </div>
      <label>${esc(t("doorCode"))}<input name="code" maxlength="30" autocomplete="off" value="${esc(code)}"></label>
      <span class="help">${esc(t("doorHelp"))}</span>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-action="close-modal">${esc(t("cancel"))}</button>
        <button class="btn btn-primary">${esc(t("doorSave"))}</button>
      </div>
    </form>`, { bookingId: b.id });
}

function renderCourt(b, slot, si) {
  // Niet gedeeld: voor iedereen een leeg veld zonder inschrijfknoppen
  if (b.type === "member" && slot.open === false) {
    const locked = renderEmpty(b, si, false);
    return `
    <div class="court court--private">
      <div class="court-meta">
        <span class="court-time">${slot.start}–${slot.end}</span>
        <span class="court-status is-closed">${esc(t("private"))}</span>
      </div>
      <div class="court-field" role="group" aria-label="${slot.start}–${slot.end}, ${esc(t("private"))}">
        <div class="court-half">${locked}${locked}</div>
        <div class="court-net" aria-hidden="true"></div>
        <div class="court-half">${locked}${locked}</div>
      </div>
    </div>`;
  }
  const players = slot.players || [];
  const n = players.length;
  const can = canAdd(b, slot) && n < CAPACITY;
  const spots = Array.from({ length: CAPACITY }, (_, i) =>
    players[i] ? renderPlayer(b, si, players[i], i) : renderEmpty(b, si, can));
  const closed = b.type === "member" && !slot.open;
  const status = n >= CAPACITY ? t("full") : closed ? t("private") : t("needMore", { n: CAPACITY - n });
  const statusClass = n >= CAPACITY ? "is-full" : closed ? "is-closed" : "";
  return `
    <div class="court${n >= CAPACITY ? " is-full" : ""}">
      <div class="court-meta">
        <span class="court-time">${slot.start}–${slot.end}</span>
        <span class="court-status ${statusClass}">${esc(status)}</span>
      </div>
      <div class="court-field" role="group" aria-label="${slot.start}–${slot.end}, ${esc(t("playersCount", { n }))}">
        <div class="court-half">${spots[0]}${spots[1]}</div>
        <div class="court-net" aria-hidden="true"></div>
        <div class="court-half">${spots[2]}${spots[3]}</div>
      </div>
    </div>`;
}

function renderPlayer(b, si, p, idx) {
  const m = p.uid ? state.members[p.uid] : null;
  const name = m ? fullName(m) : p.name;
  const adder = p.addedBy && p.addedBy !== p.uid ? state.members[p.addedBy] : null;
  const title = adder ? `${name} (${t("addedBy", { name: fullName(adder) })})` : name;
  const meta = m ? m.company || "" : t("guest");
  return `
    <div class="spot spot--filled${p.uid && p.uid === uid() ? " spot--me" : ""}" title="${esc(title)}">
      <span class="avatar">${esc(initials(name))}</span>
      <span class="who">
        <span class="who-name">${esc(name)}</span>
        <span class="who-meta">${m?.level ? `<span class="lvl">${esc(levelLabel(m.level))}</span>` : ""}${esc(meta)}</span>
      </span>
      ${canRemove(b, p) ? `<button type="button" class="spot-remove" data-action="remove-player" data-booking="${esc(b.id)}" data-slot="${si}" data-idx="${idx}" aria-label="${esc(t("remove"))} ${esc(name)}">×</button>` : ""}
    </div>`;
}

function renderEmpty(b, si, can) {
  if (!can) return `<div class="spot spot--empty is-locked" aria-hidden="true"></div>`;
  return `<button type="button" class="spot spot--empty" data-action="join" data-booking="${esc(b.id)}" data-slot="${si}"><span class="plus" aria-hidden="true">+</span>${esc(t("join"))}</button>`;
}

function profileForm(m, mode) {
  return `
    <form data-form="${mode}" class="stack${mode === "admin-member" ? "" : " panel"}">
      <div class="row">
        <label>${esc(t("firstName"))}<input name="firstName" required maxlength="40" autocomplete="given-name" value="${esc(m.firstName)}"></label>
        <label>${esc(t("lastName"))}<input name="lastName" required maxlength="40" autocomplete="family-name" value="${esc(m.lastName)}"></label>
      </div>
      <label>${esc(t("company"))}<input name="company" maxlength="60" autocomplete="organization" value="${esc(m.company)}"></label>
      <label>${esc(t("level"))}
        <select name="level" required>
          ${LEVELS.map((l) => `<option value="${l}"${m.level === l ? " selected" : ""}>${esc(levelLabel(l))}</option>`).join("")}
        </select>
        <span class="help">${esc(t("levelHelp"))}</span>
      </label>
      ${mode === "register" ? `
        <label>${esc(t("inviteCode"))}<input name="inviteCode" required autocomplete="off">
          <span class="help">${esc(t("inviteHelp"))}</span>
        </label>` : ""}
      <div><button class="btn btn-primary">${esc(mode === "register" ? t("createProfile") : t("saveProfile"))}</button></div>
    </form>`;
}

function renderProfile() {
  return `
    <section class="narrow">
      <h1>${esc(t("navProfile"))}</h1>
      ${state.user?.email ? `<p class="lead">${esc(t("signedInAs", { email: state.user.email }))}</p>` : ""}
      ${profileForm(state.member, "profile")}
      <button type="button" class="btn btn-ghost" data-action="signout">${esc(t("signOut"))}</button>
    </section>`;
}

function renderMembers() {
  return `
    <section class="narrow">
      <h1>${esc(t("membersTitle"))}</h1>
      <input type="search" class="search" id="member-search" placeholder="${esc(t("searchMembers"))}" aria-label="${esc(t("searchMembers"))}" value="${esc(state.memberSearch)}">
      <div id="member-list">${memberListHtml()}</div>
    </section>`;
}

function memberListHtml() {
  const q = state.memberSearch.trim().toLowerCase();
  const list = activeMembers()
    .filter((m) => !q || `${fullName(m)} ${m.company || ""} ${levelLabel(m.level)}`.toLowerCase().includes(q))
    .sort(byName);
  if (!list.length) return `<p class="empty">${esc(t("noMembers"))}</p>`;
  return `<ul class="member-list">${list.map((m) => `
    <li>
      <span class="avatar">${esc(initials(fullName(m)))}</span>
      <span class="who"><span class="who-name">${esc(fullName(m))}</span><span class="who-meta">${esc(m.company || "")}</span></span>
      ${m.level ? `<span class="lvl lvl--large">${esc(levelLabel(m.level))}</span>` : ""}
    </li>`).join("")}</ul>`;
}

function renderAdmin() {
  return `
    <section class="narrow narrow--wide">
      <h1>${esc(t("navAdmin"))}</h1>

      <h2 class="section-title">${esc(t("recurringTitle"))}</h2>
      <p class="lead">${esc(t("recurringIntro"))}</p>
      <div id="admin-recurring">${adminRecurringHtml()}</div>
      <div><button type="button" class="btn" data-action="new-recurring">${esc(t("newRecurring"))}</button></div>

      <h2 class="section-title">${esc(t("inviteTitle"))}</h2>
      <p class="lead">${esc(t("inviteIntro"))}</p>
      <form data-form="invite" class="inline-form panel">
        <label>${esc(t("inviteCode"))}<input name="code" id="invite-code" required minlength="4" maxlength="40" autocomplete="off" placeholder="${esc(t("loading"))}"></label>
        <button class="btn btn-primary">${esc(t("saveInvite"))}</button>
      </form>

      <h2 class="section-title">${esc(t("adminMembersTitle"))}</h2>
      <p class="lead">${esc(t("adminMembersIntro"))}</p>
      <div id="admin-members">${adminMembersHtml()}</div>

      <h2 class="section-title">${esc(t("cleanupTitle"))}</h2>
      <p class="lead">${esc(t("cleanupIntro"))}</p>
      <div id="cleanup" class="panel stack">
        <div><button type="button" class="btn" data-action="cleanup-scan">${esc(t("cleanupScan"))}</button></div>
      </div>
    </section>`;
}

function adminRecurringHtml() {
  return `<ul class="member-list member-list--admin">${recurringList().map((r) => `
    <li class="${r.active === false || (r.endDate && r.endDate < ymd(new Date())) ? "is-blocked" : ""}">
      <span class="who">
        <span class="who-name">${esc(recurringName(r))}${r.active === false ? ` <span class="badge badge--off">${esc(t("inactiveBadge"))}</span>` : ""}${r.endDate && r.endDate < ymd(new Date()) ? ` <span class="badge badge--off">${esc(t("expiredBadge"))}</span>` : ""}</span>
        <span class="who-meta">${esc(t("recurringWhen", { day: weekdayName(r.weekday), start: r.start, end: fromMin(toMin(r.start) + r.duration) }))}${r.split && r.duration === 90 ? ", 2 × 45 min" : ""}${r.location ? `, ${esc(r.location)}` : ""}${r.court ? `, ${esc(t("courtShort", { court: r.court }))}` : ""}${periodText(r) ? `, ${esc(periodText(r))}` : ""}${r.onePerMember !== false ? `, ${esc(t("onePerMemberShort"))}` : ""}</span>
      </span>
      <span class="row-actions">
        <button type="button" class="btn btn-ghost btn-small" data-action="edit-recurring" data-rec="${esc(r.id)}">${esc(t("editBooking"))}</button>
        ${r.id === "default" ? "" : `<button type="button" class="btn btn-ghost btn-small btn-danger" data-action="delete-recurring" data-rec="${esc(r.id)}">${esc(t("delete"))}</button>`}
      </span>
    </li>`).join("")}</ul>`;
}

function openRecurring(r) {
  const days = [1, 2, 3, 4, 5, 6, 0];
  const v = r || { weekday: 4, start: "09:00", duration: 90, split: true, location: "", name: "", active: true, onePerMember: true };
  openModal(`
    <h2>${esc(r ? t("editRecurringTitle") : t("newRecurring"))}</h2>
    <p class="muted">${esc(t("recurringModalIntro"))}</p>
    <form data-form="recurring" class="stack">
      <label>${esc(t("recurringName"))}<input name="name" maxlength="50" value="${esc(v.name || "")}" placeholder="${esc(t("community"))}"></label>
      <div class="row">
        <label>${esc(t("weekday"))}
          <select name="weekday">${days.map((d) => `<option value="${d}"${Number(v.weekday) === d ? " selected" : ""}>${esc(weekdayName(d))}</option>`).join("")}</select>
        </label>
        <label>${esc(t("startTime"))}<input type="time" name="start" step="900" required value="${esc(v.start)}"></label>
      </div>
      ${durationField(Number(v.duration))}
      <label class="check"><input type="checkbox" name="split"${v.split ? " checked" : ""}> ${esc(t("splitLabel"))}</label>
      <div class="row">
        <label>${esc(t("location"))}<input name="location" maxlength="80" value="${esc(v.location || "")}"></label>
        <label>${esc(t("courtDefault"))}<input name="court" class="court-input" maxlength="1" autocomplete="off" value="${esc(v.court || "")}" placeholder="–"></label>
      </div>
      <span class="help">${esc(t("courtDefaultHelp"))}</span>
      <fieldset class="stack-tight">
        <legend>${esc(t("periodLegend"))}</legend>
        <div class="row">
          <label>${esc(t("periodStart"))}<input type="date" name="startDate" value="${esc(v.startDate || "")}"></label>
          <label>${esc(t("periodEnd"))}<input type="date" name="endDate" value="${esc(v.endDate || "")}"></label>
        </div>
        <span class="help">${esc(t("periodHelp"))}</span>
      </fieldset>
      <label class="check"><input type="checkbox" name="onePerMember"${v.onePerMember !== false ? " checked" : ""}> ${esc(t("onePerMember"))}</label>
      <span class="help">${esc(t("onePerMemberHelp"))}</span>
      <label class="check"><input type="checkbox" name="active"${v.active !== false ? " checked" : ""}> ${esc(t("recurringActive"))}</label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-action="close-modal">${esc(t("cancel"))}</button>
        <button class="btn btn-primary">${esc(r ? t("saveChanges") : t("newRecurring"))}</button>
      </div>
    </form>`, { recurringId: r?.id || null });
}

async function loadInviteCode() {
  const input = document.getElementById("invite-code");
  if (!input) return;
  try {
    const snap = await getDoc(doc(db, "config", "invite"));
    input.value = snap.exists() ? snap.data().code || "" : "";
    input.placeholder = "";
  } catch (err) {
    toast(errMsg(err), true);
  }
}

function adminMembersHtml() {
  const list = Object.values(state.members).sort((a, b) => (a.blocked === b.blocked ? byName(a, b) : a.blocked ? 1 : -1));
  if (!list.length) return `<p class="empty">${esc(t("noMembers"))}</p>`;
  return `<ul class="member-list member-list--admin">${list.map((m) => {
    const self = m.id === uid();
    return `
    <li class="${m.blocked ? "is-blocked" : ""}">
      <span class="avatar">${esc(initials(fullName(m)))}</span>
      <span class="who">
        <span class="who-name">${esc(fullName(m))}${m.role === "admin" ? ` <span class="badge">${esc(t("adminBadge"))}</span>` : ""}${m.role === "manager" ? ` <span class="badge badge--ball">${esc(t("managerBadge"))}</span>` : ""}${m.blocked ? ` <span class="badge badge--off">${esc(t("blockedBadge"))}</span>` : ""}</span>
        <span class="who-meta">${m.level ? `<span class="lvl">${esc(levelLabel(m.level))}</span>` : ""}${esc(m.company || "")}</span>
      </span>
      <span class="row-actions">
        <button type="button" class="btn btn-ghost btn-small" data-action="edit-member" data-member="${esc(m.id)}">${esc(t("editBooking"))}</button>
        ${self ? "" : `
        <select class="role-select" data-member="${esc(m.id)}" aria-label="${esc(t("roleLabel"))}">
          ${["member", "manager", "admin"].map((r) => `<option value="${r}"${(m.role || "member") === r ? " selected" : ""}>${esc(t("role_" + r))}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-ghost btn-small${m.blocked ? "" : " btn-danger"}" data-action="toggle-block" data-member="${esc(m.id)}">${esc(m.blocked ? t("unblock") : t("block"))}</button>
        ${m.blocked ? `<button type="button" class="btn btn-ghost btn-small btn-danger" data-action="delete-member" data-member="${esc(m.id)}">${esc(t("delete"))}</button>` : ""}`}
      </span>
    </li>`;
  }).join("")}</ul>`;
}

function durationField(value) {
  return `
    <fieldset class="seg">
      <legend>${esc(t("duration"))}</legend>
      ${[60, 90].map((d) => `<label><input type="radio" name="duration" value="${d}"${value === d ? " checked" : ""}><span>${d} min</span></label>`).join("")}
    </fieldset>`;
}

/* ---------- modals ---------- */

function openNewBooking(b = null) {
  const today = ymd(new Date());
  const editing = !!b;
  const community = b?.type === "community";
  const where = community ? b.location : b?.note;
  openModal(`
    <h2>${esc(editing ? (community ? t("editSessionTitle") : t("editBookingTitle")) : t("newBooking"))}</h2>
    <p class="muted">${esc(editing ? (community ? t("editSessionIntro") : t("editBookingIntro")) : t("newBookingIntro"))}</p>
    ${!editing && appConfig.externalBooking?.url ? `<p class="muted">${esc(t("notBookedYet"))} ${bookLink("text-link")}</p>` : ""}
    <form data-form="${editing ? "edit-booking" : "new-booking"}" data-booking-form class="stack">
      <div class="row">
        <label>${esc(t("date"))}<input type="date" name="date" min="${today}" value="${esc(b?.date || today)}" required${community ? " disabled" : ""}></label>
        <label>${esc(t("startTime"))}<input type="time" name="start" step="900" value="${esc(b?.start || "18:00")}" required></label>
      </div>
      ${durationField(Number(b?.duration || 90))}
      <label class="check" id="split-label"><input type="checkbox" name="split"${b?.split ? " checked" : ""}> ${esc(t("splitLabel"))}</label>
      <div id="slot-options" class="stack"></div>
      ${community ? "" : `
      <label>${esc(t("bookingTitle"))}
        <span class="input-with-btn">
          <input name="title" maxlength="50" value="${esc(b?.title || "")}" placeholder="${esc(t("bookingTitlePlaceholder"))}">
          ${state.member?.company ? `<button type="button" class="btn btn-small" data-action="use-company">${esc(t("useCompany"))}</button>` : ""}
        </span>
        <span class="help">${esc(t("bookingTitleHelp"))}</span>
      </label>`}
      <label>${esc(community ? t("location") : t("note"))}<input name="note" maxlength="80" value="${esc(where || "")}"></label>
      ${editing ? "" : `
      <div class="row row--court">
        <label>${esc(t("courtOptional"))}<input name="court" class="court-input" maxlength="1" autocomplete="off" placeholder="–"></label>
        <label>${esc(t("codeOptional"))}<input name="code" maxlength="30" autocomplete="off"></label>
      </div>
      <span class="help">${esc(t("courtCodeOwnerHelp"))}</span>`}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-action="close-modal">${esc(t("cancel"))}</button>
        <button class="btn btn-primary">${esc(editing ? t("saveChanges") : t("addBooking"))}</button>
      </div>
    </form>`, editing ? { bookingId: b.id, editing: true, community, initialOpen: b.slots.map((s) => s.open !== false) } : null);
  updateSlotOptions();
}

function updateSlotOptions() {
  const f = $modalBody.querySelector("form[data-booking-form]");
  if (!f) return;
  const ctx = state.modalCtx || {};
  const E = f.elements;
  const dur = Number(E.namedItem("duration").value);
  const split = E.namedItem("split");
  split.disabled = dur !== 90;
  if (dur !== 90) split.checked = false;
  f.querySelector("#split-label").classList.toggle("is-disabled", dur !== 90);
  f.querySelector("#split-label").title = dur !== 90 ? t("splitHelp") : "";

  const slots = buildSlots(E.namedItem("start").value || "18:00", dur, split.checked);
  const box = f.querySelector("#slot-options");
  if (ctx.community) { box.innerHTML = ""; return; }
  if (slots.length === 1) {
    box.innerHTML = `<p class="help">${esc(t("shareWhole"))}</p>`;
    return;
  }
  // Opgedeeld: kies welk deel je deelt. Minstens één slot is altijd gedeeld.
  const prev = f.querySelector('input[name="share"]:checked')?.value;
  const io = ctx.initialOpen;
  const init = !io || io.length < 2 || (io[0] && io[1]) ? "all" : io[0] ? "0" : "1";
  const current = prev || init;
  const opts = [["all", t("shareBoth")], ["0", t("shareSlot", { time: `${slots[0].start}–${slots[0].end}` })], ["1", t("shareSlot", { time: `${slots[1].start}–${slots[1].end}` })]];
  box.innerHTML = `
    <fieldset class="stack-tight">
      <legend>${esc(t("shareLegend"))}</legend>
      ${opts.map(([v, label]) => `<label class="check"><input type="radio" name="share" value="${v}"${current === v ? " checked" : ""}> ${esc(label)}</label>`).join("")}
      <span class="help">${esc(t("shareHelp"))}</span>
    </fieldset>`;
}

// Open-vlaggen per slot uit de keuze in het formulier
function shareFlags(f, slotCount) {
  if (slotCount === 1) return [true];
  const v = f.querySelector('input[name="share"]:checked')?.value || "all";
  return v === "all" ? [true, true] : v === "0" ? [true, false] : [false, true];
}

function openJoin(b, si) {
  const slot = b.slots[si];
  const inSlot = new Set((slot.players || []).filter((p) => p.uid).map((p) => p.uid));
  const others = activeMembers().filter((m) => !inSlot.has(m.id) && m.id !== uid()).sort(byName);
  const selfErr = limitError(b, { uid: uid() });
  openModal(`
    <h2>${esc(t("addPlayer"))}</h2>
    <p class="muted">${esc(dateLabel(b.date))}, ${slot.start}–${slot.end}</p>
    <div class="stack">
      ${selfErr ? `<p class="notice">${esc(t(selfErr.i18n, selfErr.vars))}</p>` : ""}
      ${!inSlot.has(uid()) && !selfErr ? `<button type="button" class="btn btn-primary btn-block" data-action="add-me">${esc(t("addMe"))}</button>` : ""}
      ${others.length ? `
        <form data-form="add-member" class="inline-form">
          <label>${esc(t("addMember"))}
            <select name="member" required>
              <option value="">${esc(t("chooseMember"))}</option>
              ${others.map((m) => {
                const busy = !!limitConflict(b, { uid: m.id });
                return `<option value="${esc(m.id)}"${busy ? " disabled" : ""}>${esc(fullName(m))}${m.company ? `, ${esc(m.company)}` : ""}${m.level ? ` (${esc(levelLabel(m.level))})` : ""}${busy ? ` – ${esc(t("alreadyBooked"))}` : ""}</option>`;
              }).join("")}
            </select>
          </label>
          <button class="btn">${esc(t("add"))}</button>
        </form>` : ""}
      ${selfErr ? "" : `<form data-form="add-guest" class="inline-form">
        <label>${esc(t("addGuest"))}<input name="guest" required maxlength="60" placeholder="${esc(t("guestName"))}" autocomplete="off"></label>
        <button class="btn">${esc(t("add"))}</button>
      </form>`}
    </div>`, { bookingId: b.id, slot: si });
}

/* ---------- events ---------- */

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;

  switch (a) {
    case "view":
      e.preventDefault();
      if (!state.member) return;
      state.view = el.dataset.view;
      closeModal();
      render();
      window.scrollTo(0, 0);
      break;

    case "lang":
      setLang(el.dataset.lang);
      render();
      break;

    case "google":
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (err) {
        if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") toast(errMsg(err), true);
      }
      break;

    case "signout":
      state.view = "agenda";
      state.authMode = "signin";
      await signOut(auth);
      break;

    case "auth-mode":
      state.authMode = el.dataset.mode;
      renderMain();
      $main.querySelector('input[name="email"]')?.focus();
      break;

    case "forgot": {
      const input = $main.querySelector('input[name="email"]');
      const email = input?.value.trim();
      if (!email) {
        toast(t("forgotNeedEmail"), true);
        input?.focus();
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
      } catch (err) {
        // Bij een onbekend adres geven we bewust dezelfde melding, zodat niet te achterhalen valt wie lid is.
        if (err.code !== "auth/user-not-found") { toast(errMsg(err), true); return; }
      }
      toast(t("resetSent", { email }));
      break;
    }

    case "close-modal":
      closeModal();
      break;

    case "new-booking":
      openNewBooking();
      break;

    case "edit-code": {
      const b = findBooking(el.dataset.booking);
      if (b && canEditCourtCode(b)) openDoorCode(b);
      break;
    }

    case "use-company": {
      const input = el.closest("form")?.elements.namedItem("title");
      if (input) { input.value = state.member?.company || ""; input.focus(); }
      break;
    }

    case "edit-recurring": {
      const r = recurringList().find((x) => x.id === el.dataset.rec);
      openRecurring(r || null);
      break;
    }

    case "new-recurring":
      openRecurring(null);
      break;

    case "delete-recurring": {
      const r = state.recurring.find((x) => x.id === el.dataset.rec);
      if (!r || !confirm(t("deleteRecurringConfirm", { name: recurringName(r) }))) return;
      try {
        await deleteDoc(doc(db, "recurring", r.id));
        toast(t("recurringDeleted"));
      } catch (err) { toast(errMsg(err), true); }
      break;
    }

    case "edit-booking": {
      const b = findBooking(el.dataset.booking);
      if (b) openNewBooking(b);
      break;
    }

    case "edit-member": {
      const m = state.members[el.dataset.member];
      if (!m) return;
      openModal(`
        <h2>${esc(t("editMemberTitle"))}</h2>
        ${profileForm(m, "admin-member")}`, { memberId: m.id });
      break;
    }

    case "toggle-admin": {
      const m = state.members[el.dataset.member];
      if (!m || m.id === uid()) return;
      const makeAdmin = m.role !== "admin";
      if (!confirm(t(makeAdmin ? "makeAdminConfirm" : "removeAdminConfirm", { name: fullName(m) }))) return;
      try {
        await updateDoc(doc(db, "members", m.id), { role: makeAdmin ? "admin" : deleteField() });
      } catch (err) { toast(errMsg(err), true); }
      break;
    }

    case "toggle-block": {
      const m = state.members[el.dataset.member];
      if (!m || m.id === uid()) return;
      try {
        if (m.blocked) {
          await updateDoc(doc(db, "members", m.id), { blocked: false });
          toast(t("unblocked", { name: fullName(m) }));
          return;
        }
        if (!confirm(t("blockConfirm", { name: fullName(m) }))) return;
        await updateDoc(doc(db, "members", m.id), { blocked: true });
        // Haal het lid uit alle komende inschrijvingen
        let removed = 0;
        for (const b of state.bookings) {
          if (!b.slots?.some((s) => s.players?.some((p) => p.uid === m.id))) continue;
          await mutateBooking(b, (slots) => {
            slots.forEach((s) => {
              const before = s.players.length;
              s.players = s.players.filter((p) => p.uid !== m.id);
              removed += before - s.players.length;
            });
          });
        }
        toast(t("blocked", { name: fullName(m), n: removed }));
      } catch (err) { toast(errMsg(err), true); }
      break;
    }

    case "delete-member": {
      const m = state.members[el.dataset.member];
      if (!m || m.id === uid() || !m.blocked) return;
      const today = ymd(new Date());
      const own = state.bookings.filter((b) => b.type === "member" && b.createdBy === m.id && b.date >= today);
      if (!confirm(t("deleteMemberConfirm", { name: fullName(m), n: own.length }))) return;
      try {
        // Eigen komende velden van dit lid verwijderen (samen met hun deurcode)
        for (const b of own) {
          await deleteDoc(doc(db, "bookings", b.id));
          await deleteDoc(doc(db, "doorCodes", b.id)).catch(() => {});
        }
        // Uit andere komende inschrijvingen halen (bij intrekken gebeurde dat al, dit vangt nieuwe gevallen op)
        for (const b of state.bookings) {
          if (b.createdBy === m.id || !b.slots?.some((s) => s.players?.some((p) => p.uid === m.id))) continue;
          await mutateBooking(b, (slots) => { slots.forEach((s) => { s.players = s.players.filter((p) => p.uid !== m.id); }); });
        }
        await deleteDoc(doc(db, "members", m.id));
        toast(t("memberDeleted", { name: fullName(m) }));
      } catch (err) { toast(errMsg(err), true); }
      break;
    }

    case "cleanup-scan": {
      const box = document.getElementById("cleanup");
      try {
        const today = ymd(new Date());
        const snap = await getDocs(query(collection(db, "bookings"), where("date", "<", today)));
        const codeSnap = await getDocs(query(collection(db, "doorCodes"), where("date", "<", today)));
        state.oldBookings = snap.docs.map((d) => d.id);
        state.oldCodes = codeSnap.docs.map((d) => d.id);
        box.innerHTML = state.oldBookings.length
          ? `<p>${esc(t("cleanupFound", { n: state.oldBookings.length }))}</p>
             <div><button type="button" class="btn btn-danger-solid" data-action="cleanup-run">${esc(t("cleanupRun", { n: state.oldBookings.length }))}</button></div>`
          : `<p>${esc(t("cleanupNone"))}</p>`;
      } catch (err) { toast(errMsg(err), true); }
      break;
    }

    case "cleanup-run": {
      const ids = state.oldBookings || [];
      if (!ids.length || !confirm(t("cleanupConfirm", { n: ids.length }))) return;
      el.disabled = true;
      try {
        for (let i = 0; i < ids.length; i += 400) {
          const batch = writeBatch(db);
          ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, "bookings", id)));
          await batch.commit();
        }
        const codes = state.oldCodes || [];
        for (let i = 0; i < codes.length; i += 400) {
          const batch = writeBatch(db);
          codes.slice(i, i + 400).forEach((id) => batch.delete(doc(db, "doorCodes", id)));
          await batch.commit();
        }
        document.getElementById("cleanup").innerHTML = `<p>${esc(t("cleanupDone", { n: ids.length }))}</p>`;
        state.oldBookings = [];
      } catch (err) {
        el.disabled = false;
        toast(errMsg(err), true);
      }
      break;
    }

    case "join": {
      const b = findBooking(el.dataset.booking);
      if (b) openJoin(b, Number(el.dataset.slot));
      break;
    }

    case "add-me": {
      const ctx = state.modalCtx;
      const b = ctx && findBooking(ctx.bookingId);
      if (b) await addPlayer(b, ctx.slot, { uid: uid(), name: fullName(state.member), addedBy: uid() });
      break;
    }

    case "remove-player": {
      const b = findBooking(el.dataset.booking);
      const si = Number(el.dataset.slot);
      const p = b?.slots[si]?.players?.[Number(el.dataset.idx)];
      if (!p) return;
      const name = p.uid && state.members[p.uid] ? fullName(state.members[p.uid]) : p.name;
      if (p.uid === uid() || confirm(t("removeConfirm", { name }))) await removePlayer(b, si, p);
      break;
    }

    case "delete-booking": {
      if (!confirm(t("deleteConfirm"))) return;
      try {
        await deleteDoc(doc(db, "doorCodes", el.dataset.booking)).catch(() => {});
        await deleteDoc(doc(db, "bookings", el.dataset.booking));
        toast(t("bookingDeleted"));
      } catch (err) {
        toast(errMsg(err), true);
      }
      break;
    }

    case "toggle-cancel": {
      const b = findBooking(el.dataset.booking);
      if (!b) return;
      if (!b.cancelled && !confirm(t("cancelConfirm", { date: dateLabel(b.date) }))) return;
      try {
        await mutateBooking(b, () => ({ cancelled: !b.cancelled }));
      } catch (err) {
        toast(errMsg(err), true);
      }
      break;
    }
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const E = f.elements;
  const btn = f.querySelector("button:not([type=button])");
  if (btn) btn.disabled = true;

  try {
    switch (f.dataset.form) {
      case "email-auth": {
        const email = E.namedItem("email").value.trim();
        const password = E.namedItem("password").value;
        if (state.authMode === "signup") await createUserWithEmailAndPassword(auth, email, password);
        else await signInWithEmailAndPassword(auth, email, password);
        break;
      }

      case "register":
      case "profile": {
        const data = {
          firstName: E.namedItem("firstName").value.trim(),
          lastName: E.namedItem("lastName").value.trim(),
          company: E.namedItem("company").value.trim(),
          level: E.namedItem("level").value,
          updatedAt: serverTimestamp()
        };
        if (f.dataset.form === "register") {
          data.inviteCode = E.namedItem("inviteCode").value.trim();
          data.createdAt = serverTimestamp();
          try {
            await setDoc(doc(db, "members", uid()), data);
          } catch (err) {
            if (err.code === "permission-denied") { toast(t("wrongInvite"), true); break; }
            throw err;
          }
          state.member = { id: uid(), ...data };
          startListeners();
          render();
        } else {
          await updateDoc(doc(db, "members", uid()), data);
          toast(t("profileSaved"));
        }
        break;
      }

      case "recurring": {
        const id = state.modalCtx?.recurringId;
        const duration = Number(E.namedItem("duration").value);
        const data = {
          name: E.namedItem("name").value.trim(),
          weekday: Number(E.namedItem("weekday").value),
          start: E.namedItem("start").value,
          duration,
          split: duration === 90 && E.namedItem("split").checked,
          location: E.namedItem("location").value.trim(),
          court: cleanCourt(E.namedItem("court").value) || null,
          active: E.namedItem("active").checked,
          onePerMember: E.namedItem("onePerMember").checked,
          startDate: E.namedItem("startDate").value || null,
          endDate: E.namedItem("endDate").value || null,
          updatedAt: serverTimestamp()
        };
        if (data.startDate && data.endDate && data.endDate < data.startDate) throw Object.assign(new Error("period"), { i18n: "errPeriod" });
        if (id === "default") await setDoc(doc(db, "config", "settings"), data, { merge: true });
        else if (id) await updateDoc(doc(db, "recurring", id), data);
        else await addDoc(collection(db, "recurring"), { ...data, createdAt: serverTimestamp() });
        closeModal();
        toast(t("settingsSaved"));
        break;
      }

      case "door-code": {
        const b = findBooking(state.modalCtx?.bookingId);
        if (!b) throw new Error("gone");
        const code = E.namedItem("code").value.trim();
        const court = cleanCourt(E.namedItem("court").value);
        // Sessie aanmaken indien nodig, veld bewaren en de lijst bijwerken van wie de code mag zien
        await mutateBooking(b, () => ({ court: court || null }));
        if (code) {
          await setDoc(doc(db, "doorCodes", b.id), { code, date: b.date, updatedBy: uid(), updatedAt: serverTimestamp() });
        } else {
          await deleteDoc(doc(db, "doorCodes", b.id));
        }
        toast(t("courtCodeSaved"));
        closeModal();
        break;
      }

      case "invite": {
        const code = E.namedItem("code").value.trim();
        if (!confirm(t("inviteConfirm", { code }))) break;
        await setDoc(doc(db, "config", "invite"), { code, updatedAt: serverTimestamp() });
        toast(t("inviteSaved"));
        break;
      }

      case "new-booking": {
        const date = E.namedItem("date").value;
        const start = E.namedItem("start").value;
        const duration = Number(E.namedItem("duration").value);
        const split = duration === 90 && E.namedItem("split").checked;
        const slots = buildSlots(start, duration, split, shareFlags(f, split ? 2 : 1));
        const code = E.namedItem("code").value.trim();
        const ref = await addDoc(collection(db, "bookings"), {
          type: "member", date, start, duration, split, slots,
          title: E.namedItem("title").value.trim(),
          court: cleanCourt(E.namedItem("court").value) || null,
          accessUids: [],
          note: E.namedItem("note").value.trim(),
          cancelled: false,
          createdBy: uid(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (code) await setDoc(doc(db, "doorCodes", ref.id), { code, date, updatedBy: uid(), updatedAt: serverTimestamp() });
        closeModal();
        toast(t("bookingAdded"));
        break;
      }

      case "edit-booking": {
        const ctx = state.modalCtx;
        const b = ctx && findBooking(ctx.bookingId);
        if (!b) throw new Error("gone");
        const date = b.type === "community" ? b.date : E.namedItem("date").value;
        const start = E.namedItem("start").value;
        const duration = Number(E.namedItem("duration").value);
        const split = duration === 90 && E.namedItem("split").checked;
        const open = b.type === "community" ? [true, true] : shareFlags(f, split ? 2 : 1);
        const newSlots = buildSlots(start, duration, split, open);
        const note = E.namedItem("note").value.trim();
        await mutateBooking(b, (slots) => {
          const players = slots.map((s) => s.players);
          if (players.slice(newSlots.length).some((p) => p.length)) throw new Error("slotHasPlayers");
          if (newSlots.some((s, i) => s.open === false && players[i]?.length)) throw new Error("closingHasPlayers");
          newSlots.forEach((s, i) => { s.players = players[i] || []; });
          slots.splice(0, slots.length, ...newSlots);
          return b.type === "community"
            ? { start, duration, split, location: note }
            : { date, start, duration, split, note, title: E.namedItem("title").value.trim() };
        });
        closeModal();
        toast(t("changesSaved"));
        break;
      }

      case "admin-member": {
        const id = state.modalCtx?.memberId;
        if (!id) break;
        await updateDoc(doc(db, "members", id), {
          firstName: E.namedItem("firstName").value.trim(),
          lastName: E.namedItem("lastName").value.trim(),
          company: E.namedItem("company").value.trim(),
          level: E.namedItem("level").value,
          updatedAt: serverTimestamp()
        });
        closeModal();
        toast(t("profileSaved"));
        break;
      }

      case "add-member": {
        const id = E.namedItem("member").value;
        const m = state.members[id];
        const ctx = state.modalCtx;
        const b = ctx && findBooking(ctx.bookingId);
        if (m && b) await addPlayer(b, ctx.slot, { uid: id, name: fullName(m), addedBy: uid() });
        break;
      }

      case "add-guest": {
        const name = E.namedItem("guest").value.trim();
        const ctx = state.modalCtx;
        const b = ctx && findBooking(ctx.bookingId);
        if (name && b) await addPlayer(b, ctx.slot, { uid: null, name, addedBy: uid() });
        break;
      }
    }
  } catch (err) {
    toast(errMsg(err), true);
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.classList?.contains("court-input")) {
    e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase();
  }
  if (e.target.id === "member-search") {
    state.memberSearch = e.target.value;
    document.getElementById("member-list").innerHTML = memberListHtml();
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.classList?.contains("role-select")) {
    const sel = e.target;
    const m = state.members[sel.dataset.member];
    if (!m || m.id === uid()) return;
    const role = sel.value;
    if (!confirm(t("roleConfirm", { name: fullName(m), role: t("role_" + role) }))) {
      sel.value = m.role || "member";
      return;
    }
    try {
      await updateDoc(doc(db, "members", m.id), { role: role === "member" ? deleteField() : role });
      toast(t("roleSaved"));
    } catch (err) {
      sel.value = m.role || "member";
      toast(errMsg(err), true);
    }
    return;
  }
  if (e.target.closest("form[data-booking-form]") && ["duration", "split", "start"].includes(e.target.name)) {
    updateSlotOptions();
  }
});

/* ---------- start ---------- */

setLang(getLang());
render();
