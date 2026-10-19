import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  query, where, orderBy, onSnapshot, runTransaction, serverTimestamp
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
  bookings: [],
  view: "agenda",
  memberSearch: "",
  modalCtx: null,
  linkSentTo: null
};
let listeners = [];

const $top = document.getElementById("topbar");
const $main = document.getElementById("main");
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
  const map = { full: "errFull", already: "errAlready", closed: "errClosed", cancelled: "errCancelled", gone: "errGone" };
  if (map[e?.message]) return t(map[e.message]);
  if (e?.code === "permission-denied") return t("errPermission");
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
}

function startListeners() {
  stopListeners();
  listeners.push(onSnapshot(collection(db, "members"), (snap) => {
    const m = {};
    snap.forEach((d) => { m[d.id] = { id: d.id, ...d.data() }; });
    state.members = m;
    if (m[uid()]) state.member = m[uid()];
    refresh();
  }, onListenError));

  listeners.push(onSnapshot(doc(db, "config", "settings"), (snap) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    refresh();
  }, onListenError));

  const q = query(collection(db, "bookings"), where("date", ">=", ymd(new Date())), orderBy("date"));
  listeners.push(onSnapshot(q, (snap) => {
    state.bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    refresh();
  }, onListenError));
}

function onListenError(e) { toast(errMsg(e), true); }

function communityDates() {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((Number(state.settings.weekday) - d.getDay() + 7) % 7));
  for (let i = 0; i < (appConfig.weeksAhead || 8); i++) {
    out.push(ymd(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

function virtualCommunity(date) {
  const s = state.settings;
  const duration = Number(s.duration);
  return {
    id: `community_${date}`, type: "community", date, start: s.start, duration,
    split: !!s.split && duration === 90, location: s.location || "", cancelled: false,
    createdBy: null, virtual: true,
    slots: buildSlots(s.start, duration, !!s.split, [true, true])
  };
}

function agendaItems() {
  const today = ymd(new Date());
  const items = new Map();
  for (const d of communityDates()) items.set(`community_${d}`, virtualCommunity(d));
  for (const b of state.bookings) items.set(b.id, b);
  return [...items.values()]
    .filter((b) => b.date >= today)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || (a.type === "community" ? -1 : 1));
}

const findBooking = (id) => agendaItems().find((b) => b.id === id);

function canAdd(b, slot) {
  if (!state.member || b.cancelled) return false;
  return b.type === "community" || slot.open || b.createdBy === uid() || isAdmin();
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
    if (snap.exists()) tx.update(ref, { slots, ...extra, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...data, slots, ...extra, updatedAt: serverTimestamp() });
  });
}

async function addPlayer(b, si, player) {
  try {
    await mutateBooking(b, (slots, data) => {
      const slot = slots[si];
      if (!slot) throw new Error("gone");
      if (data.cancelled) throw new Error("cancelled");
      if (data.type !== "community" && !slot.open && data.createdBy !== uid() && !isAdmin()) throw new Error("closed");
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

async function completeEmailLink() {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  let email = null;
  try { email = localStorage.getItem("padel.email"); } catch { /* ignore */ }
  if (!email) email = window.prompt(t("confirmEmail"));
  if (email) {
    try {
      await signInWithEmailLink(auth, email, location.href);
      try { localStorage.removeItem("padel.email"); } catch { /* ignore */ }
    } catch (e) {
      toast(errMsg(e), true);
    }
  }
  history.replaceState(null, "", location.pathname);
}

onAuthStateChanged(auth, async (user) => {
  stopListeners();
  state.user = user;
  state.member = null;
  state.members = {};
  state.bookings = [];
  if (!user) {
    state.loading = false;
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    const snap = await getDoc(doc(db, "members", user.uid));
    if (snap.exists()) {
      state.member = { id: snap.id, ...snap.data() };
      startListeners();
    }
  } catch (e) {
    toast(errMsg(e), true);
  }
  state.loading = false;
  render();
});

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
  if (state.view === "agenda") renderMain();
  else if (state.view === "members") {
    const el = document.getElementById("member-list");
    if (el) el.innerHTML = memberListHtml();
  }
}

function renderTop() {
  const nav = state.member
    ? [["agenda", "navAgenda"], ["members", "navMembers"], ["profile", "navProfile"], ...(isAdmin() ? [["admin", "navAdmin"]] : [])]
    : [];
  $top.innerHTML = `
    <div class="wrap topbar-inner">
      <a class="brand" href="#" data-action="view" data-view="agenda"><span class="brand-mark" aria-hidden="true"></span>${esc(appConfig.name)}</a>
      <nav class="nav" aria-label="Menu">
        ${nav.map(([v, k]) => `<button type="button" class="nav-link${state.view === v ? " is-active" : ""}" data-action="view" data-view="${v}"${state.view === v ? ' aria-current="page"' : ""}>${esc(t(k))}</button>`).join("")}
      </nav>
      <div class="lang" role="group" aria-label="${esc(t("language"))}">
        ${["nl", "en"].map((l) => `<button type="button" class="lang-btn${getLang() === l ? " is-active" : ""}" data-action="lang" data-lang="${l}" aria-pressed="${getLang() === l}">${l.toUpperCase()}</button>`).join("")}
      </div>
    </div>`;
}

function renderMain() {
  if (state.loading) {
    $main.innerHTML = `<p class="loading">${esc(t("loading"))}</p>`;
    return;
  }
  if (!state.user) {
    $main.innerHTML = renderLogin();
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
  const views = { agenda: renderAgenda, members: renderMembers, profile: renderProfile, admin: renderAdmin };
  $main.innerHTML = views[state.view]();
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
        <h1 class="display">${esc(appConfig.name)}</h1>
        <p class="lead">${esc(t("signInIntro"))}</p>
        <button type="button" class="btn btn-primary btn-block" data-action="google">${esc(t("google"))}</button>
        <div class="or"><span>${esc(t("or"))}</span></div>
        ${state.linkSentTo
          ? `<p class="notice">${t("linkSent", { email: `<strong>${esc(state.linkSentTo)}</strong>` })}</p>`
          : `<form data-form="email-link" class="stack">
               <label>${esc(t("emailLabel"))}<input type="email" name="email" required autocomplete="email"></label>
               <button class="btn btn-block">${esc(t("sendLink"))}</button>
             </form>`}
      </div>
    </section>`;
}

function renderAgenda() {
  const s = state.settings;
  const end = fromMin(toMin(s.start) + Number(s.duration));
  const introKey = s.split && Number(s.duration) === 90 ? "agendaIntro" : "agendaIntroCustom";
  const today = ymd(new Date());
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
        <p class="lead">${esc(t(introKey, { day: weekdayName(s.weekday), start: s.start, end }))}</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="new-booking">${esc(t("newBooking"))}</button>
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
  const title = b.type === "community"
    ? t("community")
    : mine ? t("yourBooking") : t("memberBooking", { name: owner ? fullName(owner) : "?" });
  const end = fromMin(toMin(b.start) + Number(b.duration));
  const where = b.type === "community" ? b.location : b.note;
  const actions = [];
  if (b.type === "member" && (mine || isAdmin())) {
    actions.push(`<button type="button" class="btn btn-ghost btn-small" data-action="delete-booking" data-booking="${esc(b.id)}">${esc(t("deleteBooking"))}</button>`);
  }
  if (b.type === "community" && isAdmin()) {
    actions.push(`<button type="button" class="btn btn-ghost btn-small" data-action="toggle-cancel" data-booking="${esc(b.id)}">${esc(b.cancelled ? t("restoreSession") : t("cancelSession"))}</button>`);
  }
  return `
    <article class="booking booking--${b.type}${b.cancelled ? " is-cancelled" : ""}">
      <header class="booking-head">
        <div>
          <p class="tag">${esc(b.type === "community" ? t("tagCommunity") : t("tagMember"))}</p>
          <h3>${esc(title)}</h3>
          <p class="booking-sub">${b.start}–${end}${where ? `, ${esc(where)}` : ""}</p>
        </div>
        ${actions.length ? `<div class="booking-actions">${actions.join("")}</div>` : ""}
      </header>
      ${b.cancelled
        ? `<p class="cancel-note">${esc(t("cancelledSession"))}</p>`
        : `<div class="slots slots--${b.slots.length}">${b.slots.map((s, i) => renderCourt(b, s, i)).join("")}</div>`}
    </article>`;
}

function renderCourt(b, slot, si) {
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
    <form data-form="${mode}" class="stack panel">
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
  const list = Object.values(state.members)
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
  const s = state.settings;
  const days = [1, 2, 3, 4, 5, 6, 0];
  return `
    <section class="narrow">
      <h1>${esc(t("adminTitle"))}</h1>
      <p class="lead">${esc(t("adminIntro"))}</p>
      <form data-form="settings" class="stack panel">
        <div class="row">
          <label>${esc(t("weekday"))}
            <select name="weekday">${days.map((d) => `<option value="${d}"${Number(s.weekday) === d ? " selected" : ""}>${esc(weekdayName(d))}</option>`).join("")}</select>
          </label>
          <label>${esc(t("startTime"))}<input type="time" name="start" step="900" required value="${esc(s.start)}"></label>
        </div>
        ${durationField(Number(s.duration))}
        <label class="check"><input type="checkbox" name="split"${s.split ? " checked" : ""}> ${esc(t("splitLabel"))}</label>
        <label>${esc(t("location"))}<input name="location" maxlength="80" value="${esc(s.location)}"></label>
        <div><button class="btn btn-primary">${esc(t("saveSettings"))}</button></div>
      </form>
    </section>`;
}

function durationField(value) {
  return `
    <fieldset class="seg">
      <legend>${esc(t("duration"))}</legend>
      ${[60, 90].map((d) => `<label><input type="radio" name="duration" value="${d}"${value === d ? " checked" : ""}><span>${d} min</span></label>`).join("")}
    </fieldset>`;
}

/* ---------- modals ---------- */

function openNewBooking() {
  const today = ymd(new Date());
  openModal(`
    <h2>${esc(t("newBooking"))}</h2>
    <p class="muted">${esc(t("newBookingIntro"))}</p>
    <form data-form="new-booking" class="stack">
      <div class="row">
        <label>${esc(t("date"))}<input type="date" name="date" min="${today}" value="${today}" required></label>
        <label>${esc(t("startTime"))}<input type="time" name="start" step="900" value="18:00" required></label>
      </div>
      ${durationField(90)}
      <label class="check" id="split-label"><input type="checkbox" name="split"> ${esc(t("splitLabel"))}</label>
      <div id="slot-options" class="stack"></div>
      <label>${esc(t("note"))}<input name="note" maxlength="80"></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-action="close-modal">${esc(t("cancel"))}</button>
        <button class="btn btn-primary">${esc(t("addBooking"))}</button>
      </div>
    </form>`);
  updateSlotOptions();
}

function updateSlotOptions() {
  const f = $modalBody.querySelector('form[data-form="new-booking"]');
  if (!f) return;
  const E = f.elements;
  const dur = Number(E.namedItem("duration").value);
  const split = E.namedItem("split");
  split.disabled = dur !== 90;
  if (dur !== 90) split.checked = false;
  f.querySelector("#split-label").classList.toggle("is-disabled", dur !== 90);
  f.querySelector("#split-label").title = dur !== 90 ? t("splitHelp") : "";

  const slots = buildSlots(E.namedItem("start").value || "18:00", dur, split.checked);
  const prevOpen = [...f.querySelectorAll('input[name="open"]')].map((i) => i.checked);
  const prevPlay = E.namedItem("play")?.value;
  const box = f.querySelector("#slot-options");
  box.innerHTML = `
    <fieldset class="stack-tight">
      <legend>${esc(t("openForMembers"))}</legend>
      ${slots.map((s, i) => `<label class="check"><input type="checkbox" name="open" value="${i}"${(prevOpen[i] ?? true) ? " checked" : ""}> ${s.start}–${s.end}</label>`).join("")}
      <span class="help">${esc(t("openHelp"))}</span>
    </fieldset>
    <label>${esc(t("iPlay"))}
      <select name="play">
        ${slots.length === 2
          ? `<option value="all">${esc(t("iPlayBoth"))}</option>${slots.map((s, i) => `<option value="${i}">${esc(t("iPlaySlot", { time: `${s.start}–${s.end}` }))}</option>`).join("")}`
          : `<option value="all">${esc(t("iPlayYes"))}</option>`}
        <option value="none">${esc(t("iPlayNone"))}</option>
      </select>
    </label>`;
  const sel = box.querySelector("select");
  if (prevPlay && [...sel.options].some((o) => o.value === prevPlay)) sel.value = prevPlay;
}

function openJoin(b, si) {
  const slot = b.slots[si];
  const inSlot = new Set((slot.players || []).filter((p) => p.uid).map((p) => p.uid));
  const others = Object.values(state.members).filter((m) => !inSlot.has(m.id) && m.id !== uid()).sort(byName);
  openModal(`
    <h2>${esc(t("addPlayer"))}</h2>
    <p class="muted">${esc(dateLabel(b.date))}, ${slot.start}–${slot.end}</p>
    <div class="stack">
      ${!inSlot.has(uid()) ? `<button type="button" class="btn btn-primary btn-block" data-action="add-me">${esc(t("addMe"))}</button>` : ""}
      ${others.length ? `
        <form data-form="add-member" class="inline-form">
          <label>${esc(t("addMember"))}
            <select name="member" required>
              <option value="">${esc(t("chooseMember"))}</option>
              ${others.map((m) => `<option value="${esc(m.id)}">${esc(fullName(m))}${m.company ? `, ${esc(m.company)}` : ""}${m.level ? ` (${esc(levelLabel(m.level))})` : ""}</option>`).join("")}
            </select>
          </label>
          <button class="btn">${esc(t("add"))}</button>
        </form>` : ""}
      <form data-form="add-guest" class="inline-form">
        <label>${esc(t("addGuest"))}<input name="guest" required maxlength="60" placeholder="${esc(t("guestName"))}" autocomplete="off"></label>
        <button class="btn">${esc(t("add"))}</button>
      </form>
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
      state.linkSentTo = null;
      await signOut(auth);
      break;

    case "close-modal":
      closeModal();
      break;

    case "new-booking":
      openNewBooking();
      break;

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
      case "email-link": {
        const email = E.namedItem("email").value.trim();
        await sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
        try { localStorage.setItem("padel.email", email); } catch { /* ignore */ }
        state.linkSentTo = email;
        renderMain();
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

      case "settings": {
        const duration = Number(E.namedItem("duration").value);
        await setDoc(doc(db, "config", "settings"), {
          weekday: Number(E.namedItem("weekday").value),
          start: E.namedItem("start").value,
          duration,
          split: duration === 90 && E.namedItem("split").checked,
          location: E.namedItem("location").value.trim(),
          updatedAt: serverTimestamp()
        });
        toast(t("settingsSaved"));
        break;
      }

      case "new-booking": {
        const date = E.namedItem("date").value;
        const start = E.namedItem("start").value;
        const duration = Number(E.namedItem("duration").value);
        const split = duration === 90 && E.namedItem("split").checked;
        const open = [...f.querySelectorAll('input[name="open"]')].map((i) => i.checked);
        const slots = buildSlots(start, duration, split, open);
        const play = E.namedItem("play").value;
        const me = { uid: uid(), name: fullName(state.member), addedBy: uid() };
        slots.forEach((s, i) => { if (play === "all" || play === String(i)) s.players.push(me); });
        await addDoc(collection(db, "bookings"), {
          type: "member", date, start, duration, split, slots,
          note: E.namedItem("note").value.trim(),
          cancelled: false,
          createdBy: uid(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        closeModal();
        toast(t("bookingAdded"));
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
  if (e.target.id === "member-search") {
    state.memberSearch = e.target.value;
    document.getElementById("member-list").innerHTML = memberListHtml();
  }
});

document.addEventListener("change", (e) => {
  if (e.target.closest('form[data-form="new-booking"]') && ["duration", "split", "start"].includes(e.target.name)) {
    updateSlotOptions();
  }
});

/* ---------- start ---------- */

setLang(getLang());
render();
completeEmailLink();
