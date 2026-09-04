import { BELLS, GROUPS, DEFAULT_GROUP, groupById, lessonCount } from "./schedule.js";

const KEY = "weekly:groups:v2";
const SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const PALETTES = [
  "default",
  "colorful",
  "neutral",
  "opaque",
  "ocean",
  "forest",
  "plum",
  "sand",
  "aurora",
  "sunset",
  "candy",
  "cyber",
  "midnight",
  "rose",
  "mint",
  "coral",
];

/* Все дополнительные палитры сохраняют отдельные светлые и тёмные варианты. */
const LIGHT_VARIANT_PALETTES = new Set([
  "neutral",
  "opaque",
  "ocean",
  "forest",
  "plum",
  "sand",
  "aurora",
  "sunset",
  "candy",
  "cyber",
  "midnight",
  "rose",
  "mint",
  "coral",
]);

const PALETTE_COLORS = {
  default: { light: "#F5F5F7", dark: "#000000" },
  colorful: { light: "#F5F5FA", dark: "#0F1119" },
  neutral: { light: "#EEF2F5", dark: "#1A2026" },
  opaque: { light: "#F2F0EA", dark: "#0A0A0B" },
  ocean: { light: "#EDF4F8", dark: "#0B1620" },
  forest: { light: "#EFF4EE", dark: "#0D1712" },
  plum: { light: "#F5F0F6", dark: "#150F1A" },
  sand: { light: "#F7F2EA", dark: "#17130E" },
  aurora: { light: "#F1F6F7", dark: "#0C151A" },
  sunset: { light: "#FFF3EC", dark: "#1C1114" },
  candy: { light: "#FFF2F8", dark: "#1A101D" },
  cyber: { light: "#EFF8F6", dark: "#090F14" },
  midnight: { light: "#EEF0FB", dark: "#0C1020" },
  rose: { light: "#FCEEF3", dark: "#1B1014" },
  mint: { light: "#EAF6F1", dark: "#0A1614" },
  coral: { light: "#FFF0EB", dark: "#1C1310" },
};
const PALETTE_LABEL = {
  default: "базовая",
  colorful: "цветная",
  neutral: "нейтральная",
  opaque: "глубоко тёмная",
  ocean: "океан",
  forest: "лесная",
  plum: "сливовая",
  sand: "песчаная",
  aurora: "аврора",
  sunset: "закат",
  candy: "конфетная",
  cyber: "кибер",
  midnight: "полночь",
  rose: "роза",
  mint: "мятная",
  coral: "коралл",
};

const ICON_EMPTY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18M10 16l4-4M14 16l-4-4"/></svg>';
const ICON_CLOCK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>';

const $ = (sel) => document.querySelector(sel);

const state = {
  selected: startOfDay(new Date()),
  tab: "schedule",
  theme: "dark",
  palette: "default",
  windows: false,
  parityMode: "auto",
  settingsOpen: false,
  nowOverride: null,
  light: false,
  scope: "week",
  group: DEFAULT_GROUP,
  draftGroup: DEFAULT_GROUP,
  onboarded: false,
  profileOpen: false,
  onboardingStep: 0,
};

let quietMotion = false;
let sceneTimer = null;
let lastRenderAt = 0;

function cssTimeMs(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

function cssVar(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

function minAllowedDate() {
  return weekStart(startOfDay(new Date()));
}

function clampDate(d) {
  const x = startOfDay(d);
  const min = minAllowedDate();
  return x < min ? min : x;
}

function snapshotVisual(el) {
  const cs = getComputedStyle(el);
  return {
    opacity: cs.opacity,
    transform: !cs.transform || cs.transform === "none" ? "translate3d(0,0,0)" : cs.transform,
    filter: !cs.filter || cs.filter === "none" ? "blur(0px)" : cs.filter,
  };
}

function currentGroup() {
  return groupById(state.group);
}

function groupName() {
  return currentGroup().id;
}

function groupOptions(selected) {
  return GROUPS.map(
    (g) => `<option value="${escapeHtml(g.id)}"${g.id === selected ? " selected" : ""}>${escapeHtml(g.id)}</option>`
  ).join("");
}

// ?now=10:40 — подмена времени для проверки карточки «сейчас»
function currentDate() {
  if (state.nowOverride === null) return new Date();
  const d = new Date();
  d.setHours(Math.floor(state.nowOverride / 60), state.nowOverride % 60, 0, 0);
  return d;
}

let liveKey = "";
let tickTimer = null;

/* ---------- даты ---------- */

function startOfDay(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

function weekStart(d) {
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7;
  return addDays(x, -shift);
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isoWeek(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day + 3);
  const first = new Date(x.getFullYear(), 0, 4);
  const fd = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - fd + 3);
  return 1 + Math.round((x - first) / 604800000);
}

function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateLabel(d) {
  return `${dayEntry(d).name}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function relLabel(d) {
  const today = startOfDay(new Date());
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === -1) return "вчера";
  return null;
}

/* ---------- расписание ---------- */

function dayEntry(d) {
  const days = currentGroup().days;
  const id = d.getDay();
  return days.find((x) => x.id === id) || days[days.length - 1];
}

// счёт учебных недель идёт от 1 сентября: неделя с 1 сентября — первая (нечётная)
function academicWeek(d) {
  const mondayOf = weekStart(startOfDay(d));
  let year = mondayOf.getFullYear();
  let anchor = weekStart(new Date(year, 8, 1));
  if (mondayOf < anchor) {
    year -= 1;
    anchor = weekStart(new Date(year, 8, 1));
  }
  return Math.round((mondayOf - anchor) / 604800000) + 1;
}

function parityOf(d) {
  if (state.parityMode !== "auto") return state.parityMode;
  return academicWeek(d) % 2 === 1 ? "odd" : "even";
}

function parityLabel(p) {
  return p === "odd" ? "нечётная" : "чётная";
}

function subInfo(slot) {
  return { ok: true, teacher: slot.teacher, room: slot.room, tag: null };
}

// все слоты дня с учётом чётности и подгруппы
/* лето — каникулы: июнь, июль, август без пар и красные в полосе */
function isSummer(d) {
  const m = d.getMonth();
  return m === 5 || m === 6 || m === 7;
}

function isDayOff(d) {
  return d.getDay() === 0 || isSummer(d);
}

function slotsFor(d) {
  if (isSummer(d)) return [];
  const p = parityOf(d);
  const entry = dayEntry(d);
  return entry.slots
    .filter((s) => !s.parity || s.parity === p)
    .map((s) => {
      const info = subInfo(s);
      const isWindow = Boolean(s.empty) || !info.ok;
      return {
        n: s.n,
        from: s.from,
        to: s.to,
        subject: s.subject,
        self: Boolean(s.self),
        window: isWindow,
        teacher: info.ok ? info.teacher : null,
        room: info.ok ? info.room : null,
        tag: info.ok ? info.tag : null,
      };
    });
}

function lessonsFor(d) {
  return slotsFor(d).filter((s) => !s.window);
}

function mins(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function nowMins(now) {
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

function fmtLeft(m) {
  const total = Math.max(0, Math.round(m));
  const h = Math.floor(total / 60);
  const r = total % 60;
  if (h && r) return `${h} ч ${r} мин`;
  if (h) return `${h} ч`;
  return `${r} мин`;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function liveState(d) {
  const now = currentDate();
  if (!sameDay(d, startOfDay(now))) return null;
  const list = lessonsFor(d);
  if (!list.length) return null;
  const cur = nowMins(now);
  for (const s of list) {
    const from = mins(s.from);
    const to = mins(s.to);
    if (cur >= from && cur < to) {
      return {
        kind: "current",
        slot: s,
        left: to - cur,
        progress: (cur - from) / (to - from),
        now,
      };
    }
  }
  const next = list.find((s) => mins(s.from) > cur);
  if (next) return { kind: "next", slot: next, left: mins(next.from) - cur, progress: 0, now };
  return { kind: "done", slot: list[list.length - 1], left: 0, progress: 1, now };
}

/* ---------- разметка ---------- */

function clockText(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

function metaHtml(slot) {
  const parts = [];
  if (slot.teacher) {
    const teacher = escapeHtml(slot.teacher);
    const vacancy = slot.teacher.trim().toLowerCase() === "вакансия";
    parts.push(
      `<span class="lesson-type-accent${vacancy ? " is-vacancy" : ""}">• ${teacher}</span>`
    );
  }
  if (slot.room) parts.push(`<span class="lesson-room">ауд. ${slot.room}</span>`);
  if (slot.tag) parts.push(`<span class="lesson-location">${slot.tag}</span>`);
  if (slot.self) parts.push(`<span class="lesson-origin-mark is-local">сам. работа</span>`);
  if (!slot.teacher && !slot.room && !slot.self) {
    parts.push(`<span class="lesson-location">без аудитории</span>`);
  }
  return parts.join("");
}

function liveCardHtml(live) {
  if (!live || live.kind === "done") return "";
  const s = live.slot;
  const current = live.kind === "current";
  const status = current
    ? `<span><i></i>сейчас · ${s.n} пара</span><time id="live-clock">${clockText(live.now)}</time>`
    : `<span>${ICON_CLOCK}далее · ${s.n} пара</span><time id="live-clock">${s.from}</time>`;
  const progress = current
    ? `<div class="live-card-progress"><i id="live-progress" style="transform:scaleX(${live.progress.toFixed(
        3
      )})"></i></div>`
    : "";
  const timing = current
    ? `<div class="live-card-timing"><span>${s.from}–${s.to}</span><span id="live-left">осталось ${fmtLeft(
        live.left
      )}</span></div>`
    : `<div class="live-card-timing is-next-timing"><strong id="live-left">через ${fmtLeft(
        live.left
      )}</strong><span class="live-next-range">${s.from}–${s.to}</span></div>`;
  const body = `
    <div class="live-card-status">${status}</div>
    <h3>${s.subject}</h3>
    <p class="lesson-meta">${metaHtml(s)}</p>
    ${progress}
    ${timing}`;

  if (!current) {
    return `<article class="live-lesson-card is-next">${body}</article>`;
  }
  return `<article class="live-lesson-card is-current">
    <div class="live-card-backglow"></div>
    <div class="live-card-glass">
      <div class="live-card-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      ${body}
    </div>
  </article>`;
}

function rowHtml(slot, live) {
  const isCurrent = live && live.kind === "current" && live.slot.n === slot.n && !slot.window;
  const isNext = live && live.kind === "next" && live.slot.n === slot.n && !slot.window;
  const cls = ["agenda-row"];
  if (isCurrent) cls.push("is-overlap");
  if (isNext) cls.push("is-next");
  if (slot.tag) cls.push("is-subgroup-row");

  const time = `<div class="agenda-row-time"><time>${slot.from}<span>${slot.to}</span></time></div>`;

  if (slot.window) {
    return `<div class="${cls.join(" ")}">${time}<div class="agenda-row-content">
      <strong>окно</strong>
      <span class="lesson-meta"><span class="lesson-advisory is-warning">пары нет</span></span>
      <small>${slot.n} пара · 1 ч 35 мин свободно</small>
    </div></div>`;
  }

  const mark = isCurrent
    ? `<span class="lesson-origin-mark is-overlap">сейчас</span>`
    : isNext
      ? `<span class="lesson-origin-mark is-next">далее</span>`
      : "";

  return `<div class="${cls.join(" ")}">${time}<div class="agenda-row-content">
    <strong>${slot.subject}${mark}</strong>
    <span class="lesson-meta">${metaHtml(slot)}</span>
    <small>${slot.n} пара · 1 ч 35 мин</small>
  </div></div>`;
}

function emptyDayHtml(d) {
  const summer = isSummer(d);
  const off = isDayOff(d);
  const title = summer ? "каникулы" : off ? "выходной" : "пар нет";
  const note = summer
    ? "лето — занятий нет"
    : off
      ? "воскресенье — занятий нет"
      : `в этот день у ${groupName()} пар нет (${parityLabel(parityOf(d))} неделя)`;
  return `<div class="weekly-empty-day">${ICON_EMPTY}<strong>${title}</strong><span>${note}</span></div>`;
}

function headingHtml(d, sub) {
  const today = sameDay(d, startOfDay(new Date()));
  const title = today ? "Сегодня" : dateLabel(d);
  const rel = today ? "" : relLabel(d);
  return `<div class="weekly-day-heading t-stagger is-shown">
    <div class="weekly-day-heading-copy">
      <h2 class="t-stagger-line t-stagger-line--1">${title}</h2>
      <span class="t-stagger-line t-stagger-line--2">${sub}${rel ? ` · ${rel}` : ""}</span>
    </div>
  </div>`;
}

function completedLabel(n) {
  if (n === 1) return "1 пара завершена";
  if (n > 1 && n < 5) return `${n} пары завершены`;
  return `${n} пар завершено`;
}

let completedOpen = false;

function completedBlockHtml(slots) {
  if (!slots.length) return "";
  const open = completedOpen ? "true" : "false";
  return `<div class="completed-lessons t-acc" data-open="${open}">
    <button class="completed-lessons-toggle t-acc-head" type="button" aria-expanded="${open}" data-act="toggle-completed">
      <span class="completed-lessons-label">${ICON_CLOCK}${completedLabel(slots.length)}</span>
      <span class="completed-lessons-chevron t-acc-chevron">${ICON_CHEVRON}</span>
    </button>
    <div class="completed-lessons-panel t-acc-panel" aria-hidden="${completedOpen ? "false" : "true"}">
      <div class="completed-lessons-panel-inner t-acc-panel-inner">
        <div class="agenda-list is-completed">${slots.map((s) => rowHtml(s, null)).join("")}</div>
      </div>
    </div>
  </div>`;
}

function dayHtml(d, withLive, future) {
  const all = slotsFor(d);
  const lessons = all.filter((s) => !s.window);
  const rows = state.windows ? all : lessons;
  const live = withLive ? liveState(d) : null;
  const count = lessons.length;
  const today = sameDay(d, startOfDay(currentDate()));
  const sub = count
    ? `${count} ${plural(count, "пара", "пары", "пар")} · ${parityLabel(parityOf(d))} неделя`
    : `${parityLabel(parityOf(d))} неделя`;

  let completed = [];
  let visible = rows;
  if (today && withLive && !future) {
    const cur = nowMins(currentDate());
    completed = lessons.filter((s) => mins(s.to) <= cur);
    const hideN = new Set(completed.map((s) => s.n));
    if (live && (live.kind === "current" || live.kind === "next")) hideN.add(live.slot.n);
    visible = rows.filter((s) => !hideN.has(s.n));
  }

  let body;
  if (!count) {
    body = emptyDayHtml(d);
  } else {
    const liveHost = withLive ? `<div id="live-host">${liveCardHtml(live)}</div>` : "";
    const completedHost = today && withLive && !future ? completedBlockHtml(completed) : "";
    const list = visible.length
      ? `<div class="agenda-list">${visible.map((s) => rowHtml(s, live)).join("")}</div>`
      : "";
    body = `${completedHost}${liveHost}${list}`;
  }

  return `<div class="weekly-day-block${future ? " is-future" : ""}">${headingHtml(d, sub)}${body}</div>`;
}

function weekHtml() {
  const ws = weekStart(state.selected);
  const p = parityLabel(parityOf(state.selected));
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDays(ws, i);
    const all = slotsFor(d);
    const lessons = all.filter((s) => !s.window);
    const rows = state.windows ? all : lessons;
    days.push(`<div class="weekly-day-block">
      <div class="weekly-day-heading">
        <div class="weekly-day-heading-copy">
          <h2>${dayEntry(d).name}, ${d.getDate()} ${MONTHS[d.getMonth()]}</h2>
          <span>${
            lessons.length
              ? `${lessons.length} ${plural(lessons.length, "пара", "пары", "пар")}`
              : "пар нет"
          }</span>
        </div>
        ${sameDay(d, startOfDay(new Date())) ? '<span class="weekly-week-badge">сегодня</span>' : ""}
      </div>
      ${
        lessons.length
          ? `<div class="agenda-list">${rows.map((s) => rowHtml(s, null)).join("")}</div>`
          : `<div class="weekly-empty-day compact">${ICON_EMPTY}<strong>${
              isSummer(d) ? "каникулы" : d.getDay() === 0 ? "выходной" : "пар нет"
            }</strong></div>`
      }
    </div>`);
  }
  return `<div class="weekly-day-block">
      <div class="weekly-day-heading">
        <div class="weekly-day-heading-copy">
          <h2>неделя ${academicWeek(state.selected)}</h2>
          <span>${p} неделя · ${groupName()}</span>
        </div>
      </div>
    </div>${days.join("")}`;
}

function bellMinutes(value) {
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + m;
}

function bellRange(text) {
  if (!text || text === "—") return null;
  const parts = String(text).split("–");
  if (parts.length < 2) return null;
  const from = parts[0].trim();
  const to = parts[1].trim();
  if (!from || !to) return null;
  return { from, to };
}

function bellDuration(minutes) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${h} ч ${rest} мин` : `${h} ч`;
  }
  return `${minutes} мин`;
}

function bellItems(kind) {
  return BELLS.map((b) => ({
    n: b.n,
    range: bellRange(kind === "sat" ? b.sat : b.week),
  })).filter((item) => item.range);
}

// пары и перерывы между ними одним списком
function bellsRows(kind) {
  const items = bellItems(kind);
  const rows = [];
  items.forEach((item, i) => {
    const lesson = bellMinutes(item.range.to) - bellMinutes(item.range.from);
    rows.push(`<div class="agenda-row is-bell-pair">
      <div class="agenda-row-time"><time>${item.n} пара</time></div>
      <div class="agenda-row-content">
        <strong>${item.range.from}–${item.range.to}</strong>
        <small>${bellDuration(lesson)}</small>
      </div>
    </div>`);
    const next = items[i + 1];
    if (!next) return;
    const gap = bellMinutes(next.range.from) - bellMinutes(item.range.to);
    if (gap <= 0) return;
    rows.push(`<div class="agenda-row is-bell-break">
      <div class="agenda-row-time"><time>перерыв</time></div>
      <div class="agenda-row-content">
        <strong>${item.range.to}–${next.range.from}</strong>
        <small>${bellDuration(gap)}${gap >= 30 ? " · большой" : ""}</small>
      </div>
    </div>`);
  });
  return rows.join("");
}

function bellsHtml() {
  const weekdayCount = bellItems("week").length;
  const satCount = bellItems("sat").length;
  return `<div class="weekly-day-block">
    <div class="weekly-day-heading">
      <div class="weekly-day-heading-copy">
        <button class="weekly-onboarding-back" type="button" data-act="back-schedule">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
          к расписанию
        </button>
        <h2>расписание звонков</h2>
        <span>группа ${groupName()} · с перерывами</span>
      </div>
    </div>

    <div class="bells-grid">
      <section class="bells-section">
        <div class="bells-section-head">
          <strong>будни</strong>
          <span>пн–пт · ${weekdayCount} ${plural(weekdayCount, "пара", "пары", "пар")}</span>
        </div>
        <div class="agenda-list">${bellsRows("week")}</div>
      </section>

      <section class="bells-section">
        <div class="bells-section-head">
          <strong>суббота</strong>
          <span>сб · ${satCount} ${plural(satCount, "пара", "пары", "пар")}</span>
        </div>
        <div class="agenda-list">${bellsRows("sat")}</div>
      </section>
    </div>
  </div>`;
}

/* ---------- рендер ---------- */

function setScene(html, direction) {
  const stage = $("#stage");
  const old = $("#day-scene");

  if (sceneTimer !== null) {
    window.clearTimeout(sceneTimer);
    sceneTimer = null;
  }
  stage.querySelectorAll(".weekly-active-day-scene").forEach((node) => {
    if (node !== old) node.remove();
  });

  if (!old) {
    const first = document.createElement("div");
    first.className = "weekly-active-day-scene";
    first.id = "day-scene";
    first.innerHTML = html;
    stage.appendChild(first);
    return;
  }

  const scene = $("#scene");
  const reduced =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    Boolean(scene && scene.classList.contains("is-motion-lite"));

  if (!direction || reduced) {
    old.getAnimations().forEach((a) => a.cancel());
    old.classList.remove("is-leaving", "is-entering");
    old.removeAttribute("data-direction");
    old.style.cssText = "";
    old.innerHTML = html;
    return;
  }

  const from = snapshotVisual(old);
  old.getAnimations().forEach((a) => a.cancel());
  old.classList.remove("is-leaving", "is-entering");
  old.removeAttribute("data-direction");
  old.removeAttribute("id");
  old.classList.add("is-leaving");
  old.dataset.direction = direction;
  old.style.animation = "none";

  const next = document.createElement("div");
  next.className = "weekly-active-day-scene is-entering";
  next.id = "day-scene";
  next.dataset.direction = direction;
  next.style.animation = "none";
  next.innerHTML = html;
  stage.appendChild(next);

  const dist = cssVar("--page-slide-distance", "8px");
  const blur = cssVar("--page-blur", "3px");
  const ease = cssVar("--page-slide-ease", "cubic-bezier(0.22, 1, 0.36, 1)");
  const dur = cssTimeMs("--page-slide-dur", 250);
  const outX =
    direction === "forward" ? `translate3d(calc(${dist} * -1), 0, 0)` : `translate3d(${dist}, 0, 0)`;
  const inX =
    direction === "forward" ? `translate3d(${dist}, 0, 0)` : `translate3d(calc(${dist} * -1), 0, 0)`;

  old.animate(
    [
      { opacity: from.opacity, transform: from.transform, filter: from.filter },
      { opacity: 0, transform: outX, filter: `blur(${blur})` },
    ],
    { duration: dur, easing: ease, fill: "forwards" }
  );
  next.animate(
    [
      { opacity: 0, transform: inX, filter: `blur(${blur})` },
      { opacity: 1, transform: "translate3d(0, 0, 0)", filter: "blur(0px)" },
    ],
    { duration: dur, easing: ease, fill: "both" }
  );

  sceneTimer = window.setTimeout(() => {
    old.remove();
    next.classList.remove("is-entering");
    next.removeAttribute("data-direction");
    next.getAnimations().forEach((a) => {
      try {
        a.commitStyles();
      } catch (err) {
        /* ignore */
      }
      a.cancel();
    });
    next.style.animation = "";
    next.style.opacity = "";
    next.style.transform = "";
    next.style.filter = "";
    sceneTimer = null;
  }, dur);
}

function renderStrip() {
  const strip = $("#strip");
  const nextArrow = $("#next-week");
  const ws = weekStart(state.selected);
  const today = startOfDay(new Date());
  const selectedIndex = Math.max(
    0,
    Math.min(6, Math.round((state.selected - ws) / 86400000))
  );
  const existing = Array.from(strip.querySelectorAll("button[data-date-index]"));
  const sameWeek = existing.length === 7 && existing[0].dataset.date === iso(ws);

  if (!sameWeek) {
    existing.forEach((b) => b.remove());
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(ws, i);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.dateIndex = String(i);
      btn.dataset.date = iso(d);
      if (i === selectedIndex) btn.classList.add("is-selected");
      if (sameDay(d, today)) btn.classList.add("is-today");
      if (isDayOff(d)) btn.classList.add("is-day-off");
      btn.innerHTML = `<span>${SHORT[i]}</span><strong>${d.getDate()}</strong>${dotsHtml(d)}`;
      frag.appendChild(btn);
    }
    strip.insertBefore(frag, nextArrow);
  } else {
    existing.forEach((btn, i) => {
      const d = addDays(ws, i);
      btn.classList.toggle("is-selected", i === selectedIndex);
      btn.classList.toggle("is-today", sameDay(d, today));
      btn.classList.toggle("is-day-off", isDayOff(d));
    });
  }

  const prevIndex = Number(strip.dataset.selectedIndex);
  strip.dataset.selectedIndex = String(selectedIndex);
  if (
    sameWeek &&
    Number.isFinite(prevIndex) &&
    prevIndex !== selectedIndex &&
    !(scrub && scrub.active)
  ) {
    const sel = $("#selection");
    if (sel) {
      strip.classList.remove("is-hop");
      sel.classList.remove("is-hop");
      void sel.offsetWidth;
      strip.classList.add("is-hop");
      sel.classList.add("is-hop");
      window.clearTimeout(sel._hopTimer);
      sel._hopTimer = window.setTimeout(() => {
        strip.classList.remove("is-hop");
        sel.classList.remove("is-hop");
      }, 380);
    }
  }
  $("#today-btn").classList.toggle("is-visible", !sameDay(state.selected, today));
  const prev = $("#prev-week");
  if (prev) prev.disabled = weekStart(state.selected).getTime() <= weekStart(today).getTime();
}

function renderHeader() {
  const p = parityOf(state.selected);
  $("#week-number").textContent = String(academicWeek(state.selected));
  $("#week-parity").textContent = parityLabel(p);
  $("#week-badge").title = "чётность считается по номеру недели";
  $("#week-switch").classList.toggle("is-second", p === "even");
  $("#theme-hint").textContent = state.theme === "dark" ? "тёмная" : "светлая";
  $("#palette-hint").textContent = PALETTE_LABEL[state.palette];
  $("#freshness").textContent = `группа ${groupName()}`;
}

function renderTab() {
  const scheduleView = $("#schedule-view");
  const auxView = $("#aux-view");
  const strip = $("#strip");

  if (state.tab === "bells") {
    scheduleView.style.display = "none";
    strip.style.display = "none";
    auxView.hidden = false;
    auxView.innerHTML = bellsHtml();
  } else {
    state.tab = "schedule";
    scheduleView.style.display = "";
    strip.style.display = "";
    auxView.hidden = true;
    auxView.innerHTML = "";
  }
  applyFlags();
}

function render(direction) {
  lastRenderAt = performance.now();
  // быстрые переключения больше не глушат анимацию: каждый день запускает каскад заново.
  // при перемещении рулетки сцену уже меняет selectDate, здесь не дублируем
  quietMotion = Boolean(scrub && scrub.active);
  renderHeader();
  renderStrip();
  renderTab();
  if (state.tab === "schedule") {
    setScene(dayHtml(state.selected, true) + futureDaysHtml(), quietMotion ? null : direction);
    liveKey = liveSignature();
  }
  quietMotion = false;
  save();
}

function liveSignature() {
  const live = liveState(state.selected);
  const now = currentDate();
  let done = 0;
  if (sameDay(state.selected, startOfDay(now))) {
    const cur = nowMins(now);
    done = lessonsFor(state.selected).filter((s) => mins(s.to) <= cur).length;
  }
  if (!live) return `none:${done}`;
  return `${live.kind}:${live.slot ? live.slot.n : "-"}:${done}`;
}

function tick() {
  if (state.tab !== "schedule") return;
  const live = liveState(state.selected);
  const sig = live ? `${live.kind}:${live.slot ? live.slot.n : "-"}` : "none";
  if (sig !== liveKey) {
    liveKey = sig;
    render();
    return;
  }
  if (!live || live.kind === "done") return;
  const clock = $("#live-clock");
  const left = $("#live-left");
  const bar = $("#live-progress");
  if (clock && live.kind === "current") clock.textContent = clockText(live.now);
  if (left) {
    left.textContent =
      live.kind === "current" ? `осталось ${fmtLeft(live.left)}` : `через ${fmtLeft(live.left)}`;
  }
  if (bar) bar.style.transform = `scaleX(${live.progress.toFixed(3)})`;
}

/* ---------- тема и палитра ---------- */

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  // Тёмные варианты neutral/opaque больше не переключают тему сами.
  // Для белого режима используем отдельные светлые варианты этих же палитр.
  const renderedPalette =
    state.theme === "light" && LIGHT_VARIANT_PALETTES.has(state.palette)
      ? `${state.palette}-light`
      : state.palette;
  if (renderedPalette === "default") root.removeAttribute("data-weekly-palette");
  else root.dataset.weeklyPalette = renderedPalette;

  $("#theme-toggle").setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
  $("#dark-switch").setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
  const pal = $("#palette-toggle");
  pal.classList.toggle("is-colorful", state.palette === "colorful");
  pal.classList.toggle("is-opaque", state.palette === "opaque");
  pal.dataset.palette = state.palette;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const colors = PALETTE_COLORS[state.palette] || PALETTE_COLORS.default;
    meta.setAttribute("content", state.theme === "light" ? colors.light : colors.dark);
  }
  applyFlags();
}

/* ---------- состояние ---------- */

function save() {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        theme: state.theme,
        palette: state.palette,
        windows: state.windows,
        tab: state.tab,
        light: state.light,
        scope: state.scope,
        group: state.group,
        onboarded: state.onboarded,
      })
    );
  } catch (e) {
    /* приватный режим */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.theme === "dark" || data.theme === "light") state.theme = data.theme;
    if (PALETTES.includes(data.palette)) state.palette = data.palette;
    if (typeof data.windows === "boolean") state.windows = data.windows;
    if (["schedule", "bells"].includes(data.tab)) state.tab = data.tab;
    if (typeof data.light === "boolean") state.light = data.light;
    if (data.scope === "day" || data.scope === "week") state.scope = data.scope;
    if (typeof data.group === "string" && GROUPS.some((g) => g.id === data.group)) {
      state.group = data.group;
      state.draftGroup = data.group;
    }
    if (typeof data.onboarded === "boolean") state.onboarded = data.onboarded;
  } catch (e) {
    /* повреждённые данные */
  }
}

/* ---------- настройки ---------- */

function openSettings() {
  state.settingsOpen = true;
  $("#settings").classList.add("is-open");
  $("#app").classList.add("is-settings-open");
  const pop = $("#settings-popover");
  pop.classList.remove("is-closing");
  pop.classList.add("is-open");
  $("#settings-trigger").setAttribute("aria-expanded", "true");
}

function closeSettings() {
  if (!state.settingsOpen) return;
  state.settingsOpen = false;
  const pop = $("#settings-popover");
  pop.classList.remove("is-open");
  pop.classList.add("is-closing");
  $("#settings").classList.remove("is-open");
  $("#app").classList.remove("is-settings-open");
  $("#settings-trigger").setAttribute("aria-expanded", "false");
  window.setTimeout(() => pop.classList.remove("is-closing"), 220);
}

/* ---------- действия ---------- */

function selectDate(d, direction, options) {
  const next = clampDate(d);
  if (sameDay(next, state.selected)) {
    renderStrip();
    return;
  }
  if (options && options.silent) {
    const scrubDir = next > state.selected ? "forward" : "backward";
    state.selected = next;
    renderHeader();
    if (state.tab === "schedule") {
      setScene(dayHtml(state.selected, true) + futureDaysHtml(), scrubDir);
      liveKey = liveSignature();
    }
    const strip = $("#strip");
    const key = iso(state.selected);
    strip.querySelectorAll("button[data-date-index]").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.dataset.date === key);
    });
    strip.dataset.selectedIndex = String(
      Math.round((state.selected - weekStart(state.selected)) / 86400000)
    );
    const todayButton = $("#today-btn");
    if (todayButton) {
      todayButton.classList.toggle(
        "is-visible",
        !sameDay(state.selected, startOfDay(new Date()))
      );
    }
    return;
  }
  const dir =
    direction || (next > state.selected ? "forward" : next < state.selected ? "backward" : null);
  const weekChanged = weekStart(next).getTime() !== weekStart(state.selected).getTime();
  state.selected = next;
  if (weekChanged) {
    const sel = $("#selection");
    sel.classList.add("is-week-reset");
    render(dir);
    void sel.offsetWidth;
    window.setTimeout(() => $("#selection").classList.remove("is-week-reset"), 40);
  } else {
    render(dir);
  }
}

function shiftDay(delta) {
  selectDate(addDays(state.selected, delta), delta > 0 ? "forward" : "backward");
}

/* ---------- зажать и вести выделение по дням ---------- */

let scrub = null;
let scrubFrame = null;
let holdTimer = null;
/* Флаг вместо таймера: глушится только клик от самого перетаскивания,
   а не всё, что попадёт в окно 400 мс после него. */
let dragClick = false;

function springStep(position, velocity, target, dt, stiffness, damping) {
  let pos = position;
  let vel = velocity;
  let rest = Math.min(0.05, Math.max(0.001, dt));
  while (rest > 0.0001) {
    const step = Math.min(1 / 120, rest);
    const accel = (target - pos) * stiffness - vel * damping;
    vel += accel * step;
    pos += vel * step;
    rest -= step;
  }
  return { position: pos, velocity: vel };
}

function dayButtons() {
  return Array.from($("#strip").querySelectorAll("button[data-date-index]"));
}

function paintScrub() {
  if (!scrub) return;
  const selection = $("#selection");
  if (!selection) return;
  const pointerVelocity = scrub.pointerVelocity || 0;
  const speed = Math.min(
    1,
    Math.max(Math.abs(scrub.velocity), Math.abs(pointerVelocity) * 0.55) / 1050
  );
  const delta = scrub.target - scrub.position;
  const under = Math.max(0, Math.min(6, Math.round(scrub.position / scrub.step)));
  const between =
    under !== scrub.targetIndex ? Math.min(1, Math.abs(delta) / (scrub.step * 0.18)) : 0;
  const lite = Boolean(scrub.lowFrameRate);
  const cap = lite ? 16 : 26;
  const shift =
    Math.max(
      -cap,
      Math.min(cap, delta * (lite ? 0.38 : 0.52) + pointerVelocity * (lite ? 0.0014 : 0.0025))
    ) * between;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const blur = reduced || lite ? 0 : Math.min(2.4, speed * 1.9 + Math.abs(delta) / 34) * between;
  selection.style.transform = `translate3d(${scrub.position.toFixed(2)}px, 0, 0)`;
  if (under !== scrub.underIndex) {
    const buttons = dayButtons();
    if (buttons[scrub.underIndex]) buttons[scrub.underIndex].removeAttribute("data-under-selection");
    if (buttons[under]) buttons[under].setAttribute("data-under-selection", "true");
    scrub.underIndex = under;
  }
  const scene = $("#scene");
  if (scene) {
    scene.style.setProperty("--scrub-scene-x", `${shift.toFixed(2)}px`);
    scene.style.setProperty("--scrub-scene-blur", `${blur.toFixed(2)}px`);
    scene.style.setProperty(
      "--scrub-scene-scale",
      `${(1 - speed * between * (lite ? 0.001 : 0.0025)).toFixed(4)}`
    );
    scene.style.setProperty(
      "--scrub-scene-opacity",
      `${(1 - speed * between * (lite ? 0.025 : 0.055)).toFixed(3)}`
    );
  }
}

function scrubFrameStep(now) {
  if (!scrub) {
    scrubFrame = null;
    return;
  }
  const delta = scrub.lastFrame ? now - scrub.lastFrame : 1000 / 60;
  scrub.lastFrame = now;
  const dt = Math.min(0.05, Math.max(0.001, delta / 1000));
  if (delta > 8 && delta < 80) {
    scrub.frameInterval += (delta - (scrub.frameInterval || 16.7)) * 0.22;
    if (delta > 23) {
      scrub.slowFrameCount = (scrub.slowFrameCount || 0) + 1;
      scrub.fastFrameCount = 0;
    } else if (delta < 20) {
      scrub.fastFrameCount = (scrub.fastFrameCount || 0) + 1;
      scrub.slowFrameCount = Math.max(0, (scrub.slowFrameCount || 0) - 1);
    }
    const scene = $("#scene");
    if (!scrub.lowFrameRate && ((scrub.slowFrameCount || 0) >= 2 || scrub.frameInterval > 24)) {
      scrub.lowFrameRate = true;
      scrub.strip.classList.add("is-motion-lite");
      if (scene) scene.classList.add("is-motion-lite");
    } else if (scrub.lowFrameRate && (scrub.fastFrameCount || 0) >= 8) {
      scrub.lowFrameRate = false;
      scrub.strip.classList.remove("is-motion-lite");
      if (scene) scene.classList.remove("is-motion-lite");
    }
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    scrub.position = scrub.target;
    scrub.velocity = 0;
  } else {
    const next = springStep(
      scrub.position,
      scrub.velocity,
      scrub.target,
      dt,
      scrub.pointerDown ? 330 : 410,
      scrub.pointerDown ? 23 : 27
    );
    scrub.position = Math.max(-8, Math.min(scrub.max + 8, next.position));
    scrub.velocity = next.velocity;
  }
  scrub.pointerVelocity = (scrub.pointerVelocity || 0) * Math.exp(-dt * 10);
  paintScrub();
  if (
    !scrub.pointerDown &&
    Math.abs(scrub.target - scrub.position) < 0.12 &&
    Math.abs(scrub.velocity) < 2.5
  ) {
    scrub.position = scrub.target;
    paintScrub();
    endScrub();
    return;
  }
  scrubFrame = window.requestAnimationFrame(scrubFrameStep);
}

function startScrubLoop() {
  if (scrubFrame === null) scrubFrame = window.requestAnimationFrame(scrubFrameStep);
}

function activateScrub() {
  holdTimer = null;
  if (!scrub || !scrub.pointerDown || scrub.active) return;
  scrub.active = true;
  /* Захватываем указатель только после начала настоящего перетаскивания.
     Поэтому обычный клик остаётся кликом по самой кнопке дня. */
  if (!scrub.strip.hasPointerCapture(scrub.pointerId)) {
    scrub.strip.setPointerCapture(scrub.pointerId);
  }
  scrub.strip.classList.remove("is-pressing");
  scrub.strip.classList.add("is-scrubbing");
  const scene = $("#scene");
  if (scene) {
    scene.classList.remove("is-date-settling");
    scene.classList.add("is-date-scrubbing");
  }
  dragClick = true;
  moveScrub(scrub.pointerX);
  scrub.lastFrame = performance.now();
  startScrubLoop();
}

function moveScrub(clientX) {
  if (!scrub) return;
  scrub.target = Math.max(0, Math.min(scrub.max, clientX - scrub.firstCenter - scrub.grabOffset));
  const index = Math.max(0, Math.min(6, Math.round(scrub.target / scrub.step)));
  if (index !== scrub.targetIndex) {
    scrub.targetIndex = index;
    selectDate(addDays(weekStart(state.selected), index), null, { silent: true });
  }
}

function endScrub() {
  /* Работает и без активного scrub: используется как полный сброс состояния,
     чтобы после резкого отпускания не оставались инлайн-трансформ и блюр. */
  const stripEl = (scrub && scrub.strip) || $("#strip");
  if (!stripEl) return;
  const wasActive = Boolean(scrub && scrub.active);
  dayButtons().forEach((btn) => btn.removeAttribute("data-under-selection"));
  window.clearTimeout(stripEl._releaseTimer);
  stripEl.classList.remove("is-pressing", "is-scrubbing", "is-motion-lite", "is-releasing");
  if (wasActive) {
    // Оставляем полный прямоугольник хотя бы на один кадр, иначе браузер
    // склеивает состояния и он резко проваливается вниз без transition.
    stripEl.classList.add("is-settling");
    const pill = $("#selection");
    if (pill) void getComputedStyle(pill, "::before").clipPath;
    window.requestAnimationFrame(() => {
      /* Если пользователь уже начал новый жест, дожимать старую анимацию нельзя. */
      if (scrub) return;
      stripEl.classList.remove("is-settling");
      stripEl.classList.add("is-releasing");
      stripEl._releaseTimer = window.setTimeout(() => {
        stripEl.classList.remove("is-releasing");
      }, 460);
    });
  } else {
    stripEl.classList.remove("is-settling");
  }
  const scene = $("#scene");
  if (scene) {
    scene.classList.remove("is-date-scrubbing", "is-date-settling", "is-motion-lite");
    scene.style.removeProperty("--scrub-scene-blur");
    scene.style.removeProperty("--scrub-scene-scale");
    scene.style.removeProperty("--scrub-scene-opacity");
    scene.style.removeProperty("--scrub-scene-x");
  }
  const selection = $("#selection");
  if (stripEl) {
    stripEl.dataset.selectedIndex = String(
      Math.round((state.selected - weekStart(state.selected)) / 86400000)
    );
  }
  if (selection) {
    selection.classList.add("is-week-reset");
    selection.style.removeProperty("transform");
    void selection.offsetWidth;
    selection.classList.remove("is-week-reset");
  }
  scrub = null;
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (scrubFrame !== null) {
    window.cancelAnimationFrame(scrubFrame);
    scrubFrame = null;
  }
  renderStrip();
  save();
}

function settleScrub() {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (!scrub) return;
  scrub.strip.classList.remove("is-pressing");
  if (!scrub.active) {
    /* Обычный тап: доводим состояние до конца, иначе остатки предыдущего
       перетаскивания (трансформ пилюли и блюр сцены) остаются висеть. */
    endScrub();
    return;
  }
  scrub.pointerDown = false;
  scrub.target = scrub.targetIndex * scrub.step;
  scrub.strip.classList.remove("is-scrubbing");
  scrub.strip.classList.add("is-settling");
  const scene = $("#scene");
  if (scene) {
    scene.classList.remove("is-date-scrubbing");
    scene.classList.add("is-date-settling");
  }
  dragClick = true;
  startScrubLoop();
}

function bindStrip() {
  const strip = $("#strip");

  strip.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const btn = e.target.closest("button[data-date-index]");
    if (!btn) return;
    /* Предыдущий жест мог не успеть доиграть (резко отпустили и сразу нажали
       другой день) — завершаем его, чтобы квадратик и блюр не залипали. */
    if (scrub || scrubFrame !== null) endScrub();
    dragClick = false;
    const index = Number(btn.dataset.dateIndex);
    const selectedIndex = Number(strip.dataset.selectedIndex);
    const buttons = dayButtons();
    const first = buttons[0];
    const second = buttons[1];
    const last = buttons[6];
    if (!first || !second || !last) return;

    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    const step = secondRect.left - firstRect.left;
    const position = selectedIndex * step;
    const pressedPosition = index * step;

    window.clearTimeout(strip._releaseTimer);
    strip.classList.remove("is-releasing");
    strip.classList.add("is-pressing");
    scrub = {
      pointerId: e.pointerId,
      pointerDown: true,
      active: false,
      strip,
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      lastPointerX: e.clientX,
      lastPointerTime: performance.now(),
      pointerVelocity: 0,
      position,
      target: pressedPosition,
      velocity: 0,
      step,
      max: lastRect.left - firstRect.left,
      firstCenter: firstRect.left + firstRect.width / 2,
      /* Курсор цепляет любую нажатую ячейку, а не только текущую. */
      grabOffset: e.clientX - (firstRect.left + firstRect.width / 2 + pressedPosition),
      targetIndex: selectedIndex,
      underIndex: selectedIndex,
      lastFrame: 0,
      frameInterval: 1000 / 60,
      slowFrameCount: 0,
      fastFrameCount: 0,
      lowFrameRate: false,
    };
    /* Мышью скраббинг начинается только при горизонтальном движении:
       короткий и долгий клик по дню работают одинаково. */
    holdTimer = e.pointerType === "mouse" ? null : window.setTimeout(activateScrub, 135);
  });

  strip.addEventListener("pointermove", (e) => {
    if (!scrub || scrub.pointerId !== e.pointerId || !scrub.pointerDown) return;
    scrub.pointerX = e.clientX;
    const dx = e.clientX - scrub.startX;
    const dy = e.clientY - scrub.startY;
    if (!scrub.active) {
      const horizontal = Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy) * 1.2;
      if (horizontal) {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        activateScrub();
      } else if (Math.abs(dy) > 7 || Math.hypot(dx, dy) > 10) {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;
        strip.classList.remove("is-pressing");
        scrub = null;
      }
      if (!scrub || !scrub.active) return;
    }
    e.preventDefault();
    const now = performance.now();
    const dtPointer = Math.max(8, now - (scrub.lastPointerTime || now)) / 1000;
    const vel = (e.clientX - (scrub.lastPointerX ?? e.clientX)) / dtPointer;
    scrub.pointerVelocity = (scrub.pointerVelocity || 0) * 0.48 + vel * 0.52;
    scrub.lastPointerX = e.clientX;
    scrub.lastPointerTime = now;
    moveScrub(e.clientX);
  });

  const release = (e) => {
    if (!scrub || scrub.pointerId !== e.pointerId) return;
    settleScrub();
    if (strip.hasPointerCapture(e.pointerId)) strip.releasePointerCapture(e.pointerId);
  };

  strip.addEventListener("pointerup", release);
  strip.addEventListener("pointercancel", () => endScrub());
  strip.addEventListener("lostpointercapture", (e) => {
    if (scrub && scrub.pointerId === e.pointerId && scrub.pointerDown) endScrub();
  });
  /* Отпустили курсор вне полосы или ушли из окна — состояние всё равно чистим. */
  window.addEventListener("pointerup", (e) => {
    if (scrub && scrub.pointerId === e.pointerId && !scrub.active) endScrub();
  });
  window.addEventListener("blur", () => {
    if (scrub || scrubFrame !== null) endScrub();
  });

  strip.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-date-index]");
    if (!btn) return;
    /* Глушим только клик того же жеста, что был перетаскиванием. */
    if (dragClick) {
      dragClick = false;
      return;
    }
    const [y, m, d] = btn.dataset.date.split("-").map(Number);
    selectDate(new Date(y, m - 1, d));
  });

  /* колесо мыши: шаг без задержки и без очереди — анимация перехватывается на лету */
  const WHEEL_STEP = 24;
  let wheelAcc = 0;
  strip.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (scrub && scrub.active) return;
      const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      wheelAcc += raw * scale;
      if (Math.abs(wheelAcc) < WHEEL_STEP) return;
      const steps = Math.trunc(wheelAcc / WHEEL_STEP);
      wheelAcc -= steps * WHEEL_STEP;
      shiftDay(steps > 0 ? 1 : -1);
    },
    { passive: false }
  );
}

function bindEvents() {
  bindStrip();

  const arrow = (el, delta) => {
    el.addEventListener("click", () => {
      el.classList.add("is-triggered");
      window.setTimeout(() => el.classList.remove("is-triggered"), 260);
      selectDate(addDays(state.selected, delta), delta > 0 ? "forward" : "backward");
    });
  };
  arrow($("#prev-week"), -7);
  arrow($("#next-week"), 7);

  $("#today-btn").addEventListener("click", () => selectDate(new Date()));

  /* завершённые пары: раскрытие с плавной анимацией высоты и проявления */
  $("#scene").addEventListener("click", (e) => {
    const head = e.target.closest('[data-act="toggle-completed"]');
    if (!head) return;
    const acc = head.closest(".t-acc");
    if (!acc) return;
    completedOpen = acc.dataset.open !== "true";
    const flag = completedOpen ? "true" : "false";
    acc.dataset.open = flag;
    head.setAttribute("aria-expanded", flag);
    const panel = acc.querySelector(".t-acc-panel");
    if (panel) panel.setAttribute("aria-hidden", completedOpen ? "false" : "true");
  });

  $("#theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    renderHeader();
    save();
  });

  $("#dark-switch").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    renderHeader();
    save();
  });

  $("#palette-toggle").addEventListener("click", () => {
    const i = PALETTES.indexOf(state.palette);
    state.palette = PALETTES[(i + 1) % PALETTES.length];
    applyTheme();
    renderHeader();
    save();
  });

  $("#windows-switch").addEventListener("click", () => {
    state.windows = !state.windows;
    $("#windows-switch").setAttribute("aria-pressed", state.windows ? "true" : "false");
    render();
  });

  $("#settings-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.settingsOpen) closeSettings();
    else openSettings();
  });

  $("#go-bells").addEventListener("click", () => {
    closeSettings();
    state.tab = "bells";
    render();
  });

  document.addEventListener("click", (e) => {
    if (!state.settingsOpen) return;
    if (e.target.closest("#settings")) return;
    closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSettings();
      return;
    }
    if (state.tab !== "schedule") return;
    if (e.key === "ArrowRight") shiftDay(1);
    if (e.key === "ArrowLeft") shiftDay(-1);
  });

  // свайп по дням
  const scene = $("#scene");
  let x0 = null;
  let y0 = null;
  scene.addEventListener(
    "touchstart",
    (e) => {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    },
    { passive: true }
  );
  scene.addEventListener(
    "touchend",
    (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) shiftDay(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );

  const vh = () =>
    document.documentElement.style.setProperty("--weekly-viewport-height", `${window.innerHeight}px`);
  window.addEventListener("resize", vh);
  vh();
}

/* ---------- старт ---------- */

function applyQuery() {
  const q = new URLSearchParams(location.search);
  const day = q.get("day");
  if (day) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const [y, m, d] = day.split("-").map(Number);
      state.selected = startOfDay(new Date(y, m - 1, d));
    } else if (/^[0-6]$/.test(day)) {
      const target = Number(day);
      const ws = weekStart(state.selected);
      state.selected = addDays(ws, target === 0 ? 6 : target - 1);
    }
  }
  const group = q.get("group");
  if (group && GROUPS.some((g) => g.id === group)) {
    state.group = group;
    state.draftGroup = group;
  }
  const theme = q.get("theme");
  if (theme === "dark" || theme === "light") state.theme = theme;
  const palette = q.get("palette");
  if (PALETTES.includes(palette)) state.palette = palette;
  const tab = q.get("tab");
  if (["schedule", "bells"].includes(tab)) state.tab = tab;
  if (q.get("light") === "1") state.light = true;
  if (q.get("scope") === "week") state.scope = "week";
  if (q.get("onboarding") === "1") state.onboarded = false;
  if (q.get("ostep") === "1") state.onboardingStep = 1;
  if (q.get("onboarding") === "0") state.onboarded = true;
  if (q.get("profile") === "1") state.profileOpen = true;
  const now = q.get("now");
  if (now && /^\d{1,2}:\d{2}$/.test(now)) state.nowOverride = mins(now);
  if (q.get("settings") === "1") state.settingsOpen = true;
}

/* ---------- оформление: флаги ---------- */

function applyFlags() {
  const root = document.documentElement;
  if (state.light) root.dataset.weeklyScheduleView = "light";
  else root.removeAttribute("data-weekly-schedule-view");
  const ls = $("#light-switch");
  if (ls) ls.setAttribute("aria-pressed", state.light ? "true" : "false");
  const ss = $("#scope-switch");
  if (ss) ss.setAttribute("aria-pressed", state.scope === "week" ? "true" : "false");
  const li = $("#light-hint");
  if (li) li.textContent = state.light ? "плоские и компактные пары" : "обычные карточки";
  const sh = $("#scope-hint");
  if (sh) sh.textContent = state.scope === "week" ? "следующие дни ниже" : "только выбранный день";
  const ph = $("#profile-hint");
  if (ph) ph.textContent = `группа ${groupName()} · без входа`;
}

/* ---------- даты в полосе ---------- */

function dotsHtml(d) {
  const lessons = slotsFor(d).filter((sl) => !sl.window);
  if (!lessons.length) return "";
  const dots = [];
  const max = Math.min(lessons.length, 5);
  for (let i = 0; i < max; i += 1) dots.push("<i></i>");
  return `<span class="date-lesson-dots" aria-hidden="true">${dots.join("")}</span>`;
}

function futureDaysHtml() {
  if (state.scope !== "week") return "";
  const ws = weekStart(state.selected);
  const out = [];
  for (let i = 0; i < 6; i += 1) {
    const d = addDays(ws, i);
    if (d <= state.selected) continue;
    out.push(dayHtml(d, false, true));
  }
  return out.join("");
}

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 13l4 4 10-10"/></svg>';
const ICON_CAL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_GIFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18M12 8v12M8.5 8a2.5 2.5 0 1 1 3.5-2.3A2.5 2.5 0 1 1 15.5 8z"/></svg>';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- профиль ---------- */

function openProfile() {
  const backdrop = $("#profile-backdrop");
  const count = lessonCount(state.group);
  backdrop.innerHTML = `<div class="weekly-profile">
    <div class="weekly-profile-header">
      <button type="button" data-act="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        назад
      </button>
      <h1>профиль</h1>
      <span></span>
    </div>
    <div class="weekly-profile-identity">
      <div>
        <h2>${groupName()}</h2>
        <p>${count} ${plural(count, "пара", "пары", "пар")} в неделю</p>
      </div>
    </div>
    <div class="weekly-profile-content">
      <div class="weekly-profile-group">
        <div class="weekly-profile-group-heading"><span>учебная группа</span></div>
        <div class="weekly-profile-select">
          <select id="profile-group">${groupOptions(state.group)}</select>
          ${ICON_CHEVRON}
        </div>
        <div class="weekly-profile-pending-schedule">${ICON_CAL}<span><strong>выбор сохраняется</strong><small>группа и настройки хранятся в этом браузере</small></span></div>
      </div>
    </div>
    <div class="weekly-profile-footer">
      <button type="button" data-act="close">готово</button>
    </div>
  </div>`;
  backdrop.hidden = false;
  state.profileOpen = true;
}

function closeProfile() {
  const backdrop = $("#profile-backdrop");
  backdrop.hidden = true;
  backdrop.innerHTML = "";
  state.profileOpen = false;
}

/* ---------- онбординг ---------- */

function onboardingHtml() {
  const total = 2;
  const offset = `-${state.onboardingStep * (100 / total)}%`;
  const dots = [];
  for (let i = 0; i < total; i += 1) {
    dots.push(
      `<button type="button" class="${i === state.onboardingStep ? "is-active" : ""}" data-step="${i}" aria-label="шаг ${
        i + 1
      }"></button>`
    );
  }
  const draft = state.draftGroup;
  const count = lessonCount(draft);
  return `<div class="weekly-onboarding-top">
    <div class="weekly-onboarding-progress">${dots.join("")}</div>
  </div>
  <div class="weekly-onboarding-slides" style="--onboarding-count:${total};--onboarding-slide-width:${
    100 / total
  }%;--onboarding-offset:${offset}">
    <div class="weekly-onboarding-slide is-welcome" aria-hidden="${state.onboardingStep === 0 ? "false" : "true"}">
      <div class="weekly-onboarding-copy is-centered">
        <div class="weekly-onboarding-mark">
          <svg class="weeqo-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.937A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
        </div>
        <span class="weekly-onboarding-kicker">weeqo beta</span>
        <h1>только расписание</h1>
        <p>это просто короче смотреть расписание вооот</p>
      </div>
      <button class="weekly-onboarding-action" type="button" data-act="next">выбрать группу</button>
    </div>
    <div class="weekly-onboarding-slide is-profile" aria-hidden="${state.onboardingStep === 1 ? "false" : "true"}">
      <div class="weekly-onboarding-copy">
        <button class="weekly-onboarding-back" type="button" data-act="back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
          назад
        </button>
        <h1>какая группа?</h1>
        <p>выбор можно поменять потом в настройках</p>
        <div class="weekly-profile-fields">
          <label class="weekly-profile-field">учебная группа
            <div class="weekly-profile-control">
              <select id="onboarding-group">${groupOptions(draft)}</select>
              ${ICON_CHEVRON}
            </div>
            <small>${draft} · ${count} ${plural(count, "пара", "пары", "пар")} в неделю</small>
          </label>
        </div>
      </div>
      <button class="weekly-onboarding-action" type="button" data-act="finish">подтвердить группу</button>
    </div>
  </div>`;
}

function renderOnboarding() {
  const host = $("#onboarding");
  document.documentElement.dataset.theme = "dark";
  host.innerHTML = onboardingHtml();
  host.hidden = false;
}

function closeOnboarding() {
  const host = $("#onboarding");
  host.classList.add("is-closing");
  window.setTimeout(() => {
    host.hidden = true;
    host.classList.remove("is-closing");
    host.innerHTML = "";
  }, 320);
  state.onboarded = true;
  save();
  applyTheme();
}

/* ---------- события разделов ---------- */

function bindExtra() {
  $("#light-switch").addEventListener("click", () => {
    state.light = !state.light;
    applyFlags();
    save();
  });

  $("#scope-switch").addEventListener("click", () => {
    state.scope = state.scope === "week" ? "day" : "week";
    applyFlags();
    render();
  });

  $("#go-profile").addEventListener("click", () => {
    closeSettings();
    openProfile();
  });

  $("#aux-view").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "back-schedule") {
      state.tab = "schedule";
      render();
    }
  });

  $("#profile-backdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      closeProfile();
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "close") closeProfile();
  });

  $("#profile-backdrop").addEventListener("change", (e) => {
    if (e.target.id === "profile-group") {
      state.group = e.target.value;
      state.draftGroup = e.target.value;
      save();
      render();
      openProfile();
    }
  });

  const onboarding = $("#onboarding");
  onboarding.addEventListener("change", (e) => {
    if (e.target.id === "onboarding-group") {
      state.draftGroup = e.target.value;
      renderOnboarding();
    }
  });
  onboarding.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act], [data-step]");
    if (!act) return;
    const kind = act.dataset.act;
    if (act.dataset.step !== undefined) {
      state.onboardingStep = Number(act.dataset.step);
      renderOnboarding();
      return;
    }
    if (kind === "next") {
      state.onboardingStep = 1;
      renderOnboarding();
      return;
    }
    if (kind === "back") {
      state.onboardingStep = Math.max(0, state.onboardingStep - 1);
      renderOnboarding();
      return;
    }
    if (kind === "finish") {
      state.group = state.draftGroup;
      closeOnboarding();
      render();
      return;
    }
  });
}

function hideLoader() {
  const loader = $("#loader");
  if (!loader) return;
  loader.style.transition = "opacity .28s ease";
  loader.style.opacity = "0";
  window.setTimeout(() => loader.remove(), 320);
}

function init() {
  load();
  applyQuery();
  applyTheme();

  $("#windows-switch").setAttribute("aria-pressed", state.windows ? "true" : "false");

  bindEvents();
  bindExtra();
  render();

  if (!state.onboarded) renderOnboarding();
  if (state.profileOpen) {
    state.profileOpen = false;
    openProfile();
  }

  $("#app").hidden = false;
  hideLoader();

  const brand = $("#brand");
  window.setTimeout(() => brand.classList.remove("is-playing"), 4200);

  if (state.settingsOpen) {
    state.settingsOpen = false;
    openSettings();
  }

  tickTimer = window.setInterval(tick, 1000);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
