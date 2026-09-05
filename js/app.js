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
/* Две темы: базовая и акцентная со своим цветом. */
const PALETTES = ["default", "accent"];
const DEFAULT_ACCENT = "#0A84FF";

const PALETTE_COLORS = {
  default: { light: "#F5F5F7", dark: "#000000" },
  accent: { light: "#F5F5F7", dark: "#000000" },
};
const PALETTE_LABEL = {
  default: "базовая",
  accent: "акцентная",
};

/* Цвет текста поверх акцента: светлые оттенки требуют тёмного текста. */
function accentInk(hex) {
  const n = String(hex || "").replace("#", "");
  if (n.length !== 6) return "#ffffff";
  const ch = (i) => parseInt(n.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
  return lum > 0.5 ? "#101014" : "#ffffff";
}

/* Ведение мышью или пальцем по рулетке рисует точно такую же сцену,
           как колесо мыши: день + блок «следующих дней» с той же анимацией,
           поэтому после отпускания ничего не перерисовывается заново. */
function mixHex(hex, base, ratio) {
  const a = String(hex || "").replace("#", "");
  const b = String(base || "").replace("#", "");
  if (a.length !== 6 || b.length !== 6) return "#" + (a || b || "000000");
  const part = (i) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x * ratio + y * (1 - ratio))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${part(0)}${part(2)}${part(4)}`;
}

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
  accent: DEFAULT_ACCENT,
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
let scrubPendingRender = false;
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

// счёт учебных недель идёт от 1 сентября: неделя с 1 сентября — первая, и она считается чётной
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
  // сентябрь стартует с чётной недели
  return academicWeek(d) % 2 === 1 ? "even" : "odd";
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

function slotsForBase(d) {
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
        passed: cur - from,
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
    ? `<div class="live-card-timing"><span class="live-card-range">${s.from}–${s.to}<small id="live-passed">прошло ${fmtLeft(
        live.passed
      )}</small></span><span id="live-left">осталось ${fmtLeft(live.left)}</span></div>`
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
    <div class="live-card-glass">
      <div class="live-card-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      ${body}
    </div>
  </article>`;
}

function rowHtml(slot, live, dIso) {
  const isCurrent = live && live.kind === "current" && live.slot.n === slot.n && !slot.window;
  const isNext = live && live.kind === "next" && live.slot.n === slot.n && !slot.window;
  const cls = ["agenda-row"];
  if (isCurrent) cls.push("is-overlap");
  if (isNext) cls.push("is-next");
  if (slot.tag) cls.push("is-subgroup-row");
  if (slot.cancelled) cls.push("is-cancelled");
  if (slot.swapped) cls.push("is-swapped");

  const time = `<div class="agenda-row-time"><time>${slot.from}<span>${slot.to}</span></time></div>`;

  if (slot.window) {
    return `<div class="${cls.join(" ")}">${time}<div class="agenda-row-content">
      <strong>окно</strong>
      <span class="lesson-meta"><span class="lesson-advisory is-warning">пары нет</span></span>
      <small>${slot.n} пара · 1 ч 35 мин свободно</small>
    </div>${swapButtonHtml(dIso, slot.n)}</div>`;
  }

  const mark = isCurrent
    ? `<span class="lesson-origin-mark is-overlap">сейчас</span>`
    : isNext
      ? `<span class="lesson-origin-mark is-next">далее</span>`
      : "";

  const swapMark = slot.cancelled
    ? `<span class="lesson-origin-mark is-swap">отменена</span>`
    : slot.swapped
      ? `<span class="lesson-origin-mark is-swap">замена</span>`
      : "";

  return `<div class="${cls.join(" ")}">${time}<div class="agenda-row-content">
    <strong>${slot.subject}${swapMark}${mark}</strong>
    <span class="lesson-meta">${metaHtml(slot)}</span>
    <small>${slot.n} пара · 1 ч 35 мин</small>
  </div>${swapButtonHtml(dIso, slot.n)}</div>`;
}

/* Перерыв между парами: маленький чип, встроенный в линию-разделитель
   (в духе подложки аудитории, только на стыке строк). */
function breakChipHtml(gap) {
  return `<div class="agenda-break"><span class="agenda-break-chip">${gap >= 30 ? "большой перерыв" : "перерыв"} · <strong>${bellDuration(gap)}</strong></span></div>`;
}

/* Между соседними парами вставляем чип перерыва.
   Рядом с окном не ставим — строка окна сама про разрыв говорит. */
function withBreaksHtml(slots, live, dIso) {
  const out = [];
  let prev = null;
  slots.forEach((s) => {
    if (prev && !prev.window && !s.window) {
      const gap = mins(s.from) - mins(prev.to);
      if (gap > 0) out.push(breakChipHtml(gap));
    }
    out.push(rowHtml(s, live, dIso));
    prev = s;
  });
  return out.join("");
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
  const title = today ? "сегодня" : dateLabel(d);
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

function completedBlockHtml(slots, dIso) {
  if (!slots.length) return "";
  const open = completedOpen ? "true" : "false";
  return `<div class="completed-lessons t-acc" data-open="${open}">
    <button class="completed-lessons-toggle t-acc-head" type="button" aria-expanded="${open}" data-act="toggle-completed">
      <span class="completed-lessons-label">${ICON_CLOCK}${completedLabel(slots.length)}</span>
      <span class="completed-lessons-chevron t-acc-chevron">${ICON_CHEVRON}</span>
    </button>
    <div class="completed-lessons-panel t-acc-panel" aria-hidden="${completedOpen ? "false" : "true"}">
      <div class="completed-lessons-panel-inner t-acc-panel-inner">
        <div class="agenda-list is-completed">${slots
          .map((s) => rowHtml(s, null, dIso))
          .join("")}</div>
      </div>
    </div>
  </div>`;
}

function dayHtml(d, withLive, future) {
  const dIso = iso(d);
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
    const completedHost = today && withLive && !future ? completedBlockHtml(completed, dIso) : "";
    const list = visible.length
      ? `<div class="agenda-list">${withBreaksHtml(visible, live, dIso)}</div>`
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
          ? `<div class="agenda-list">${withBreaksHtml(rows, null, iso(d))}</div>`
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
    rows.push(breakChipHtml(gap));
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

  const outAnim = old.animate(
    [
      { opacity: from.opacity, transform: from.transform, filter: from.filter },
      { opacity: 0, transform: outX, filter: `blur(${blur})` },
    ],
    { duration: dur, easing: ease, fill: "forwards" }
  );
  const inAnim = next.animate(
    [
      { opacity: 0, transform: inX, filter: `blur(${blur})` },
      { opacity: 1, transform: "translate3d(0, 0, 0)", filter: "blur(0px)" },
    ],
    { duration: dur, easing: ease, fill: "both" }
  );

  /* Каскадные анимации строк длятся дольше смены подложки: раньше таймер
     обрывал их через dur, и при скролле/быстром листании пары моргали.
     Ждём полного каскада и трогаем только свои WAAPI-анимации. */
  const rowDur = cssTimeMs("--duration-fast", 320);
  const rowStep = cssTimeMs("--duration-stagger", 55);
  const total = Math.max(dur, rowDur + rowStep * 8);

  sceneTimer = window.setTimeout(() => {
    old.remove();
    next.classList.remove("is-entering");
    next.removeAttribute("data-direction");
    [outAnim, inAnim].forEach((a) => {
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
  }, total);
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
  const paletteHint = $("#palette-hint");
  if (paletteHint) paletteHint.textContent = PALETTE_LABEL[state.palette] || PALETTE_LABEL.default;
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
  /* во время вождения рулетки не рендерим из тика — иначе кадр рвётся */
  if (scrub && scrub.pointerDown) return;
  const live = liveState(state.selected);
  // подпись считаем тем же способом, что и при рендере — иначе блок завершённых пар мигал каждую секунду
  const sig = liveSignature();
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
  const passed = $("#live-passed");
  if (passed && live.kind === "current") passed.textContent = `прошло ${fmtLeft(live.passed)}`;
  if (bar) bar.style.transform = `scaleX(${live.progress.toFixed(3)})`;
}

/* ---------- тема и палитра ---------- */

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  // Тёмные варианты neutral/opaque больше не переключают тему сами.
  // Для белого режима используем отдельные светлые варианты этих же палитр.
  if (!PALETTES.includes(state.palette)) state.palette = "default";
  root.dataset.theme = state.theme;
  if (state.palette === "default") root.removeAttribute("data-weekly-palette");
  else root.dataset.weeklyPalette = state.palette;

  if (state.palette === "accent") {
    root.style.setProperty("--weekly-accent", state.accent);
    root.style.setProperty("--weekly-on-accent", accentInk(state.accent));
    root.style.setProperty(
      "--weekly-accent-readable",
      readableAccent(state.accent, state.theme),
    );
  } else {
    root.style.removeProperty("--weekly-accent");
    root.style.removeProperty("--weekly-on-accent");
    root.style.removeProperty("--weekly-accent-readable");
  }

  $("#theme-toggle").setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
  $("#dark-switch").setAttribute("aria-pressed", state.theme === "dark" ? "true" : "false");
  const darkRow = $("#dark-switch");
  if (darkRow) darkRow.disabled = false;
  const modes = $("#theme-modes");
  if (modes) {
    modes.querySelectorAll("button[data-mode]").forEach((btn) => {
      const on = btn.dataset.mode === state.palette;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  const accentRow = $("#accent-row");
  if (accentRow) accentRow.hidden = state.palette !== "accent";
  const accentInput = $("#accent-color");
  if (accentInput && accentInput.value.toLowerCase() !== state.accent.toLowerCase()) {
    accentInput.value = state.accent;
  }
  const accentHint = $("#accent-hint");
  if (accentHint) accentHint.textContent = state.accent.toUpperCase();

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const colors = PALETTE_COLORS[state.palette] || PALETTE_COLORS.default;
    let tint = state.theme === "light" ? colors.light : colors.dark;
    /* Акцентная тема красит и сам фон — строка статуса должна совпадать. */
    if (state.palette === "accent") {
      tint =
        state.theme === "light"
          ? mixHex(state.accent, "#ffffff", 0.2)
          : mixHex(state.accent, "#05050a", 0.18);
    }
    meta.setAttribute("content", tint);
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
        accent: state.accent,
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
    if (typeof data.accent === "string" && /^#[0-9a-f]{6}$/i.test(data.accent)) {
      state.accent = data.accent;
    }
    if (typeof data.windows === "boolean") state.windows = data.windows;
    if (["schedule", "bells"].includes(data.tab)) state.tab = data.tab;
    if (typeof data.light === "boolean") state.light = data.light;
    if (data.scope === "day" || data.scope === "week") state.scope = data.scope;
    /* Не проверяем GROUPS: на старте там только зашитая группа, остальные
       подъедут из data/schedule.json позже. Если группы в итоге нет —
       applySchedulePayload сам откатит на группу по умолчанию. */
    if (typeof data.group === "string") {
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
      if (options.preview) {
        /* Во время вождения по рулетке сцена следует за пилюлей сразу,
           но дёшево: без анимации смены и без блока «следующих дней» —
           их дорисует полный рендер при отпускании. */
        scrubPendingRender = false;
        quietMotion = true;
        setScene(
          dayHtml(state.selected, true) + futureDaysHtml(),
          options.animated ? scrubDir : null
        );
        quietMotion = false;
        liveKey = liveSignature();
      } else {
        setScene(dayHtml(state.selected, true) + futureDaysHtml(), scrubDir);
        liveKey = liveSignature();
      }
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
  /* Блюр сцены на зелёной (и любой) теме давал ореол-свечение вокруг зелёных
     карточек, которое резко проявлялось в момент начала перемещения по дням.
  /* Полностью убираем размытие сцены при скрабинге — сдвиг/масштаб остаются. */
  const blur = 0;
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
    /* Режим анимаций один для всех устройств: облегчённый вариант больше не включается. */
    if (scrub.lowFrameRate) {
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
      scrub.pointerDown ? 330 : 420,
      scrub.pointerDown ? 23 : 47
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
    /* Мышью ведём с анимацией смены дня, как при скролле колесиком;
       на тачскрине — дёшево, без анимации, чтобы не ронять кадры. */
    selectDate(addDays(weekStart(state.selected), index), null, {
      silent: true,
      preview: true,
      animated: previewAnimated(),
    });
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
  if (scrubPendingRender) {
    scrubPendingRender = false;
    render();
  } else {
    renderStrip();
  }
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
  /* На телефоне быстрый флик оставляет огромную скорость, из-за которой
     пружина проскакивает цель и линия сильно подпрыгивает. Гасим импульс
     при отпускании, чтобы овершут был маленьким и аккуратным. */
  scrub.velocity = Math.max(-480, Math.min(480, scrub.velocity * 0.35));
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
      pointerType: e.pointerType,
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
      /* Курсор цепляет любую нажатую ячейку а не только текущую. */
      grabOffset: e.clientX - (firstRect.left + firstRect.width / 2 + pressedPosition),
      targetIndex: selectedIndex,
      underIndex: selectedIndex,
      lastFrame: 0,
      frameInterval: 1000 / 60,
      slowFrameCount: 0,
      fastFrameCount: 0,
      lowFrameRate: false,
    };
    /* На тачскрине забираем указатель сразу: иначе при быстром старте
       браузер отбирал жест (pointercancel) и выбор дня «спадал» —
       приходилось сначала придержать палец, а потом вести. */
    if (e.pointerType !== "mouse") {
      try {
        strip.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    /* Долгое удержание больше не требуется: таймер остаётся только как
       страховка для случая, когда палец стоит на месте. */
    holdTimer = e.pointerType === "mouse" ? null : window.setTimeout(activateScrub, 45);
  });

  strip.addEventListener("pointermove", (e) => {
    if (!scrub || scrub.pointerId !== e.pointerId || !scrub.pointerDown) return;
    scrub.pointerX = e.clientX;
    const dx = e.clientX - scrub.startX;
    const dy = e.clientY - scrub.startY;
    if (!scrub.active) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      /* Быстрый рывок пальцем даёт крупный первый шаг сразу по обеим осям.
         Активируем скрабинг, как только горизонталь преобладает, и отменяем
      /* жест только при явно вертикальном свайпе — иначе выделение пропадало
         при быстром старте перетаскивания на телефоне. */
      const horizontal = absX > 2 && absX >= absY * 0.8;
      const vertical = absY > 14 && absY > absX * 1.8;
      if (horizontal) {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        activateScrub();
      } else if (vertical) {
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
  strip.addEventListener("pointercancel", () => {
    /* Если браузер отобрал жест п��среди ведения — доводим выбор до конца,
       а не сбрасываем его назад. */
    if (scrub && scrub.active) settleScrub();
    else endScrub();
  });
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

  const modes = $("#theme-modes");
  if (modes) {
    modes.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (!PALETTES.includes(mode) || mode === state.palette) return;
      state.palette = mode;
      applyTheme();
      renderHeader();
      save();
    });
  }

  const accentInput = $("#accent-color");
  if (accentInput) {
    const onAccent = (e) => {
      const value = e.target.value;
      if (!/^#[0-9a-f]{6}$/i.test(value)) return;
      state.accent = value;
      if (state.palette !== "accent") state.palette = "accent";
      applyTheme();
      renderHeader();
      save();
    };
    accentInput.addEventListener("input", onAccent);
    accentInput.addEventListener("change", onAccent);
  }

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

  /* Свайп по дням: палец тянет сцену за собой, а день меняется уже на
     отпускании ��� с обычной анимацией листания. Раньше день переключался
     прямо посреди жеста, и анимацию съедал активный скролл. */
  const scene = $("#scene");
  const swipeStage = $("#stage");
  let swipe = null;

  const setSwipeShift = (value) => {
    if (!swipeStage) return;
    swipeStage.style.setProperty("--swipe-x", `${value.toFixed(2)}px`);
  };

  const clearSwipe = (animated) => {
    if (!swipeStage) return;
    scene.classList.remove("is-swiping");
    if (animated) {
      scene.classList.add("is-swipe-return");
      swipeStage.style.setProperty("--swipe-x", "0px");
      window.setTimeout(() => {
        scene.classList.remove("is-swipe-return");
        swipeStage.style.removeProperty("--swipe-x");
      }, 220);
      return;
    }
    scene.classList.remove("is-swipe-return");
    swipeStage.style.removeProperty("--swipe-x");
  };

  scene.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        swipe = null;
        return;
      }
      const t = e.touches[0];
      const target = t.target;
      if (
        target &&
        target.closest &&
        target.closest("#strip, button, a, input, textarea, select, .weekly-replace-sheet")
      ) {
        swipe = null;
        return;
      }
      swipe = { x: t.clientX, y: t.clientY, dx: 0, axis: null };
    },
    { passive: true }
  );

  scene.addEventListener(
    "touchmove",
    (e) => {
      if (!swipe || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - swipe.x;
      const dy = t.clientY - swipe.y;
      if (!swipe.axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        swipe.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (swipe.axis === "x") {
          scene.classList.remove("is-swipe-return");
          scene.classList.add("is-swiping");
        }
      }
      if (swipe.axis !== "x") return;
      swipe.dx = dx;
      /* резинка: сцена идёт мягче пальца и не улетает за край */
      const eased = Math.sign(dx) * Math.min(Math.abs(dx) * 0.42, 52);
      setSwipeShift(eased);
    },
    { passive: true }
  );

  const endSwipe = (commit) => {
    if (!swipe) return;
    const dx = swipe.dx;
    const axis = swipe.axis;
    swipe = null;
    if (axis !== "x") {
      clearSwipe(false);
      return;
    }
    if (commit && Math.abs(dx) >= 40) {
      clearSwipe(false);
      shiftDay(dx < 0 ? 1 : -1);
      return;
    }
    clearSwipe(true);
  };

  scene.addEventListener("touchend", () => endSwipe(true), { passive: true });
  scene.addEventListener("touchcancel", () => endSwipe(false), { passive: true });

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
  /* На субботе неделя заканчивается — показываем понедельник следующей. */
  if (!out.length) out.push(dayHtml(addDays(ws, 7), false, true));
  /* Обёртка нужна, чтобы будущие дни проявлялись каскадом,
     а не возникали резко вместе со сменой сцены. */
  return `<div class="weekly-future-days">${out.join("")}</div>`;
}

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 13l4 4 10-10"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ICON_GIFT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h18M12 8v12M8.5 8a2.5 2.5 0 1 1 3.5-2.3A2.5 2.5 0 1 1 15.5 8z"/></svg>';
const ICON_SHIELD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-3 7.7-7 9.2-4-1.5-7-4.6-7-9.2V6z"/><path d="M9.3 11.8l2 2 3.4-3.9"/></svg>';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- профиль ---------- */

/* Вкладка внутри профиля: "main" — аккаунт и группа, "notifs" — тумблеры уведомлений. */
var profileTab = "main";
/* Список тумблеров на вкладке уведомлений раскрыт по умолчанию. */
var profileNotifsOpen = true;

function openProfile() {
  const backdrop = $("#profile-backdrop");
  const count = lessonCount(state.group);
  const prefs = loadNotifPrefs();
  const role = myRole();
  const canReview = role === "owner" || role === "editor";
  const pendingCount = Object.keys(pendingMap).length;

  /* После входа — карточка-«герой» с аватаркой, именем и бейджем роли. */
  let heroBlock = "";
  let accountBlock = "";
  if (tgSession) {
    const roleLabel = role === "owner" ? "владелец" : role === "editor" ? "редактор" : "студент";
    const avatarInner = tgSession.photo_url
      ? '<img src="' + escapeHtml(String(tgSession.photo_url)) + '" alt="">'
      : "<b>" + escapeHtml((tgDisplayName(tgSession) || "?").trim().charAt(0).toUpperCase() || "?") + "</b>";
    heroBlock = `
    <div class="weekly-profile-hero">
      <span class="weekly-profile-hero-avatar">${avatarInner}</span>
      <strong class="weekly-profile-hero-name">${escapeHtml(tgDisplayName(tgSession))}</strong>
      ${tgSession.username ? '<span class="weekly-profile-hero-username">@' + escapeHtml(String(tgSession.username)) + "</span>" : ""}
      <span class="weekly-profile-hero-role is-${role}">${ICON_SHIELD}<span>${roleLabel}</span></span>
      ${role === "user" ? '<small class="weekly-profile-hero-id">мой id: ' + escapeHtml(String(tgSession.id)) + " — назови его владельцу для прав редактора</small>" : ""}
      <div class="weekly-profile-hero-actions">
        <button type="button" class="weekly-profile-mini" data-act="tg-logout">выйти</button>
      </div>
    </div>`;
    accountBlock = canReview
      ? `<div class="weekly-profile-group"><button type="button" class="weekly-profile-manage" data-act="tg-manage"><span>заявки и редакторы</span>${pendingCount ? '<b class="weekly-profile-count">' + pendingCount + "</b>" : ""}${ICON_CHEVRON}</button></div>`
      : "";
  } else {
    accountBlock = `
      <div class="weekly-profile-group">
        <div class="weekly-profile-group-heading"><span>аккаунт telegram</span></div>
        <div class="weekly-profile-auth">
          <div class="weekly-profile-auth-widget" id="profile-tg-widget"></div>
          <small>${
            tgConfigured()
              ? "на телефоне откроется приложение telegram — подтверди вход и вернись сюда, вход дойдёт сам"
              : "вход через telegram не настроен"
          }</small>
        </div>
      </div>`;
  }

  const npref = (key, title, hint) => `
        <div class="weekly-settings-row">
          <span class="weekly-settings-row-main">
            <span class="weekly-settings-copy">
              <strong>${title}</strong>
              <span>${hint}</span>
            </span>
          </span>
          <button class="weekly-setting-switch" type="button" data-npref="${key}" aria-pressed="${prefs[key] ? "true" : "false"}" aria-label="${title}"><span aria-hidden="true"></span></button>
        </div>`;

  const isNotifs = profileTab === "notifs";

  const mainContent = `
      ${accountBlock}
      <div class="weekly-profile-group">
        <div class="weekly-profile-group-heading"><span>учебная группа</span></div>
        <div class="weekly-profile-select">
          <select id="profile-group">${groupOptions(state.group)}</select>
          ${ICON_CHEVRON}
        </div>
      </div>`;

  const notifsContent = `
      <div class="weekly-profile-group">
        <button class="weekly-settings-row weekly-profile-notifs-head" type="button" data-act="notifs-toggle" aria-expanded="${profileNotifsOpen ? "true" : "false"}">
          <span class="weekly-settings-row-main">
            <span class="weekly-settings-icon is-theme">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
            </span>
            <span class="weekly-settings-copy">
              <strong>настроить уведомления</strong>
              <span>что показывать и куда дублировать</span>
            </span>
          </span>
          ${ICON_CHEVRON}
        </button>
        <div class="weekly-profile-notifs-panel${profileNotifsOpen ? " is-open" : ""}">
          <div class="weekly-profile-notifs-panel-inner">
            ${npref("swaps", "замены и отмены", "в колокольчике и в telegram")}
            ${npref("schedule", "обновления расписания", "когда парсер присылает новое")}
            ${npref("pending", "заявки на проверку", "для владельца и редакторов")}
            ${npref("telegram", "дублировать в telegram", TELEGRAM_BOT_NAME ? "бот @" + TELEGRAM_BOT_NAME + " — сначала нажми у него /start" : "личные сообщения от бота")}
          </div>
        </div>
      </div>`;

  backdrop.innerHTML = `<div class="weekly-profile">
    <div class="weekly-profile-header">
      <button type="button" data-act="close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        назад
      </button>
      <h1>профиль</h1>
      <span></span>
    </div>
    ${heroBlock}
    ${
      isNotifs
        ? ""
        : `<div class="weekly-profile-identity">
      <div>
        <h2>${groupName()}</h2>
        <p>${count} ${plural(count, "пара", "пары", "пар")} в неделю</p>
      </div>
    </div>`
    }
    <div class="weekly-profile-tabs" role="tablist">
      <button type="button" data-ptab="main" role="tab" aria-selected="${isNotifs ? "false" : "true"}" class="${isNotifs ? "" : "is-active"}">профиль</button>
      <button type="button" data-ptab="notifs" role="tab" aria-selected="${isNotifs ? "true" : "false"}" class="${isNotifs ? "is-active" : ""}">уведомления</button>
    </div>
    <div class="weekly-profile-content">
      ${isNotifs ? notifsContent : mainContent}
    </div>
    <div class="weekly-profile-footer">
      <button type="button" data-act="close">готово</button>
    </div>
  </div>`;
  backdrop.hidden = false;
  state.profileOpen = true;
  if (!tgSession && tgConfigured()) mountTelegramWidget(document.getElementById("profile-tg-widget"));
}

function closeProfile() {
  const backdrop = $("#profile-backdrop");
  backdrop.hidden = true;
  backdrop.innerHTML = "";
  state.profileOpen = false;
  profileTab = "main";
  closeTgMemo();
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
        <p>как это работает? каждые 3 часа мы берём расписание с сайта sustec.ru машиностроительного колледжа и загружаем его сюда</p>
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
    const sw = e.target.closest("[data-npref]");
    if (sw) {
      toggleNotifPref(sw.dataset.npref, sw);
      return;
    }
    const ptab = e.target.closest("[data-ptab]");
    if (ptab) {
      profileTab = ptab.dataset.ptab === "notifs" ? "notifs" : "main";
      openProfile();
      return;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "close") closeProfile();
    else if (act.dataset.act === "notifs-toggle") {
      profileNotifsOpen = !profileNotifsOpen;
      act.setAttribute("aria-expanded", profileNotifsOpen ? "true" : "false");
      const panel = document.querySelector(".weekly-profile-notifs-panel");
      if (panel) panel.classList.toggle("is-open", profileNotifsOpen);
    } else if (act.dataset.act === "tg-logout") {
      tgLogout();
      openProfile();
    } else if (act.dataset.act === "tg-manage") {
      closeProfile();
      openTgSheet();
    }
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

/* ---------- замена пары ---------- */

/* var намеренно: эти значения нужны раннему рендеру до конца модуля */
var SWAP_KEY = "weekly:swaps:v1";
var swapMap = null;

function loadSwaps() {
  if (swapMap) return swapMap;
  swapMap = {};
  try {
    const raw = localStorage.getItem(SWAP_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === "object") swapMap = migrateSwaps(data);
      let stamped = false;
      for (const sk in swapMap) {
        const entry = swapMap[sk];
        if (entry && typeof entry === "object" && typeof entry.updatedAt !== "number") {
          entry.updatedAt = Date.now();
          stamped = true;
        }
      }
      if (stamped) localStorage.setItem(SWAP_KEY, JSON.stringify(swapMap));
    }
  } catch (e) {
    /* приватный режим */
  }
  return swapMap;
}

function saveSwaps() {
  try {
    localStorage.setItem(SWAP_KEY, JSON.stringify(loadSwaps()));
  } catch (e) {
    /* приватный режим */
  }
}

function swapKey(dIso, n) {
  return (state.group || DEFAULT_GROUP) + "|" + dIso + ":" + n;
}

function swapFor(dIso, n) {
  const entry = loadSwaps()[swapKey(dIso, n)];
  return entry && !entry.deleted ? entry : null;
}

function setSwap(dIso, n, value) {
  const map = loadSwaps();
  if (value) {
    value.updatedAt = Date.now();
    map[swapKey(dIso, n)] = value;
  } else if (sharedSwapsEnabled()) {
    /* В общем режиме удаление тоже должно разойтись по всем —
       оставляем надгробие со свежим штампом времени. */
    map[swapKey(dIso, n)] = { deleted: true, updatedAt: Date.now() };
  } else {
    delete map[swapKey(dIso, n)];
  }
  saveSwaps();
  publishSwapKey(swapKey(dIso, n));
}

/* Базовое расписание лежит в slotsForBase, а здесь накладываются замены. */
function slotsFor(d) {
  const list = slotsForBase(d);
  if (!list.length) return list;
  const map = loadSwaps();
  const dIso = iso(d);
  const prefix = (state.group || DEFAULT_GROUP) + "|" + dIso + ":";
  let hasAny = false;
  for (const key in map) {
    if (key.indexOf(prefix) === 0) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) return list;
  return list.map((slot) => {
    const sw = map[swapKey(dIso, slot.n)];
    if (!sw || sw.deleted) return slot;
    const next = Object.assign({}, slot);
    if (sw.cancelled) {
      next.cancelled = true;
      next.window = false;
      next.empty = false;
      if (!next.subject) next.subject = "пара отменена";
      return next;
    }
    if (sw.subject) {
      next.subject = sw.subject;
      next.window = false;
      next.empty = false;
    }
    if (sw.teacher !== undefined) next.teacher = sw.teacher;
    if (sw.room !== undefined) next.room = sw.room;
    next.swapped = true;
    return next;
  });
}

var ICON_SWAP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/></svg>';

function swapButtonHtml(dIso, n) {
  if (!dIso) return "";
  return (
    '<button class="lesson-swap-btn" type="button" data-act="swap" data-date="' +
    dIso +
    '" data-n="' +
    n +
    '" aria-label="замена пары" title="замена пары">' +
    ICON_SWAP +
    "</button>"
  );
}

function dateFromIso(dIso) {
  const parts = String(dIso).split("-");
  return startOfDay(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
}

function closeSwapSheet() {
  const backdrop = document.getElementById("swap-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  window.setTimeout(() => backdrop.remove(), 160);
}

/* Каталог предметов группы: предмет + самые частые преподаватель и аудитория. */
function subjectCatalog() {
  const stats = new Map();
  currentGroup().days.forEach((day) => {
    day.slots.forEach((s) => {
      if (!s.subject) return;
      if (!stats.has(s.subject)) {
        stats.set(s.subject, { subject: s.subject, teachers: new Map(), rooms: new Map() });
      }
      const entry = stats.get(s.subject);
      if (s.teacher) entry.teachers.set(s.teacher, (entry.teachers.get(s.teacher) || 0) + 1);
      if (s.room) entry.rooms.set(s.room, (entry.rooms.get(s.room) || 0) + 1);
    });
  });
  const top = (counts) => {
    let best = "";
    let hits = 0;
    counts.forEach((count, value) => {
      if (count > hits) {
        hits = count;
        best = value;
      }
    });
    return best;
  };
  return Array.from(stats.values())
    .map((entry) => ({
      subject: entry.subject,
      teacher: top(entry.teachers),
      room: top(entry.rooms),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject, "ru"));
}

function openSwapSheet(dIso, n) {
  closeSwapSheet();
  const d = dateFromIso(dIso);
  const slot = slotsFor(d).find((s) => s.n === n) || null;
  const sw = swapFor(dIso, n) || {};
  const subject = sw.subject || (slot && !slot.window ? slot.subject || "" : "");
  const teacher = sw.teacher !== undefined ? sw.teacher : (slot && slot.teacher) || "";
  const room = sw.room !== undefined ? sw.room : (slot && slot.room) || "";
  const timeText = slot ? slot.from + "–" + slot.to : "";
  const catalog = subjectCatalog();
  const known = catalog.find((item) => item.subject === subject) || null;
  const customSubject = subject && !known ? subject : "";

  const options = ['<option value="">не выбран</option>']
    .concat(
      catalog.map(
        (item) =>
          '<option value="' +
          escapeHtml(item.subject) +
          '" data-teacher="' +
          escapeHtml(item.teacher) +
          '" data-room="' +
          escapeHtml(item.room) +
          '"' +
          (known && known.subject === item.subject ? " selected" : "") +
          ">" +
          escapeHtml(item.subject) +
          (item.teacher ? " · " + escapeHtml(item.teacher) : "") +
          "</option>"
      )
    )
    .join("");

  const backdrop = document.createElement("div");
  backdrop.id = "swap-backdrop";
  backdrop.className = "weekly-replace-backdrop";
  backdrop.innerHTML =
    '<div class="weekly-replace-sheet" role="dialog" aria-label="замена пары">' +
    '<div class="weekly-replace-head"><strong>замена пары</strong><span>' +
    escapeHtml(n + " пара" + (timeText ? " · " + timeText : "") + " · " + dateLabel(d)) +
    "</span></div>" +
    '<label class="weekly-replace-field"><span>предмет из расписания</span>' +
    '<div class="weekly-replace-select"><select id="swap-subject">' +
    options +
    "</select></div></label>" +
    '<label class="weekly-replace-field"><span>или свой предмет</span>' +
    '<input id="swap-subject-custom" type="text" value="' +
    escapeHtml(customSubject) +
    '" placeholder="название предмета" /></label>' +
    '<label class="weekly-replace-field"><span>преподаватель</span>' +
    '<input id="swap-teacher" type="text" value="' +
    escapeHtml(teacher) +
    '" placeholder="фамилия" /></label>' +
    '<label class="weekly-replace-field"><span>аудитория</span>' +
    '<input id="swap-room" type="text" value="' +
    escapeHtml(room) +
    '" placeholder="номер" /></label>' +
    '<p class="weekly-replace-hint">выбрал предмет из списка — преподаватель и аудитория подставятся сами; вписал свой предмет — они сбросятся</p>' +
    '<div class="weekly-replace-actions">' +
    '<button class="is-primary" type="button" data-swap="save">' + swapPrimaryLabel() + "</button>" +
    '<button type="button" data-swap="cancel-lesson">отменить пару</button>' +
    '<button type="button" data-swap="reset">сбросить</button>' +
    '<button type="button" data-swap="close">закрыть</button>' +
    "</div>" + swapAccessHint() + "</div>";

  document.body.appendChild(backdrop);
  window.requestAnimationFrame(() => backdrop.classList.add("is-open"));

  const picker = backdrop.querySelector("#swap-subject");
  const custom = backdrop.querySelector("#swap-subject-custom");
  const teacherField = backdrop.querySelector("#swap-teacher");
  const roomField = backdrop.querySelector("#swap-room");
  /* Подставленное автоматически можно сбрасывать, вписанное руками — нет. */
  let autoFilled =
    Boolean(known) && teacher === (known.teacher || "") && room === (known.room || "");

  picker.addEventListener("change", () => {
    const option = picker.options[picker.selectedIndex];
    if (!picker.value || !option) return;
    custom.value = "";
    teacherField.value = option.dataset.teacher || "";
    roomField.value = option.dataset.room || "";
    autoFilled = true;
  });

  custom.addEventListener("input", () => {
    if (!custom.value.trim()) return;
    if (picker.value) picker.value = "";
    if (autoFilled) {
      teacherField.value = "";
      roomField.value = "";
      autoFilled = false;
    }
  });

  const commit = () => {
    closeSwapSheet();
    render();
  };

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeSwapSheet();
      return;
    }
    const btn = e.target.closest("button[data-swap]");
    if (!btn) return;
    const act = btn.dataset.swap;
    if (act === "close") {
      closeSwapSheet();
      return;
    }
    if (act === "reset") {
      setSwap(dIso, n, null);
      commit();
      return;
    }
    if (act === "cancel-lesson") {
      setSwap(dIso, n, { cancelled: true });
      commit();
      return;
    }
    const nextSubject = custom.value.trim() || picker.value.trim();
    const nextTeacher = teacherField.value.trim();
    const nextRoom = roomField.value.trim();
    if (!nextSubject && !nextTeacher && !nextRoom) {
      setSwap(dIso, n, null);
      commit();
      return;
    }
    setSwap(dIso, n, { subject: nextSubject, teacher: nextTeacher, room: nextRoom });
    commit();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSwapSheet();
    closeTgSheet();
    closeUpdatesSheet();
  }
});

(() => {
  const scene = document.getElementById("scene");
  if (!scene) return;
  scene.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-act="swap"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    openSwapSheet(btn.dataset.date, Number(btn.dataset.n));
  });
})();

/* ---------- автообновление расписания ----------
   data/schedule.json пересобирает GitHub Action каждые 3 часа из PDF
   на sustec.ru, а приложение с тем же шагом его перечитывает. */
var SCHEDULE_URL = "data/schedule.json";
var SCHEDULE_CACHE_KEY = "weekly:schedule-cache:v2";
var SCHEDULE_TTL = 3 * 60 * 60 * 1000;
var scheduleFetchedAt = 0;
var scheduleApply = null;

function previewAnimated() {
  /* Один и тот же сценарий анимаций на компьютере и на телефоне:
     без троттлинга и без облегчённого режима. */
  return Boolean(scrub);
}

function migrateSwaps(data) {
  const out = {};
  Object.keys(data).forEach((key) => {
    out[key.indexOf("|") === -1 ? "\u0442\u043c-303/\u0431|" + key : key] = data[key];
  });
  return out;
}

function scheduleModule() {
  if (scheduleApply) return Promise.resolve(scheduleApply);
  return import("./schedule.js").then((mod) => {
    scheduleApply = mod.applyRemoteGroups;
    return scheduleApply;
  });
}

function scheduleStamp(payload) {
  if (payload && payload.updatedAt) {
    notifyAboutScheduleStamp(payload.updatedAt);
    scheduleUpdatedAt = payload.updatedAt;
  }
  renderDataStamp();
  const el = $("#freshness");
  if (!el || !payload || !payload.updatedAt) return;
  const when = new Date(payload.updatedAt);
  if (Number.isNaN(when.getTime())) return;
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  el.textContent = "\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e \u0432 " + hh + ":" + mm;
}

function applySchedulePayload(payload) {
  return scheduleModule().then((apply) => {
    if (typeof apply !== "function") return false;
    if (!apply(payload)) return false;
    if (!GROUPS.some((g) => g.id === state.group)) {
      state.group = GROUPS.some((g) => g.id === DEFAULT_GROUP) ? DEFAULT_GROUP : (GROUPS[0] ? GROUPS[0].id : DEFAULT_GROUP);
      state.draftGroup = state.group;
      save();
    }
    scheduleStamp(payload);
    render();
    renderStrip();
    return true;
  });
}

function cachedSchedulePayload() {
  try {
    const raw = localStorage.getItem(SCHEDULE_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && Array.isArray(data.groups) ? data : null;
  } catch (e) {
    return null;
  }
}

function refreshSchedule(force) {
  if (!force && Date.now() - scheduleFetchedAt < SCHEDULE_TTL) return Promise.resolve(false);
  return fetch(SCHEDULE_URL + "?t=" + Date.now(), { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      /* Файл пришёл, но групп нет — парсер на GitHub ещё ни разу не записал данные. */
      if (payload && Array.isArray(payload.groups) && !payload.groups.length) return "empty";
      if (!payload || !Array.isArray(payload.groups)) return false;
      scheduleFetchedAt = Date.now();
      try {
        localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(payload));
      } catch (e) {
        /* приватный режим */
      }
      return applySchedulePayload(payload);
    })
    .catch(() => false);
}

/* Пока на сервере пусто, проверяем каждые 5 минут, а не раз в час. */
var scheduleRetryTimer = null;

function planScheduleRetry() {
  window.clearTimeout(scheduleRetryTimer);
  scheduleRetryTimer = null;
  if (GROUPS.length) return;
  scheduleRetryTimer = window.setTimeout(function () {
    refreshSchedule(true).then(planScheduleRetry);
  }, 5 * 60 * 1000);
}

(function startScheduleUpdates() {
  const cached = cachedSchedulePayload();
  if (cached) applySchedulePayload(cached);
  refreshSchedule(true).then(planScheduleRetry);
  window.setInterval(() => refreshSchedule(true), SCHEDULE_TTL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshSchedule(false);
  });
  window.addEventListener("online", () => refreshSchedule(true));
})();

/* Слишком светлый акцент на светлом фоне и слишком тёмный на тёмном
   не читаются, поэтому для текста и иконок берём подправленный оттенок */
function accentLuminance(hex) {
  const n = String(hex || "").replace("#", "");
  if (n.length !== 6) return 0.5;
  const ch = (i) => parseInt(n.slice(i, i + 2), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(2)) + 0.0722 * lin(ch(4));
}

function readableAccent(hex, theme) {
  const lum = accentLuminance(hex);
  if (theme === "light" && lum > 0.5) return mixHex(hex, "#101014", 0.46);
  if (theme !== "light" && lum < 0.12) return mixHex(hex, "#ffffff", 0.5);
  return hex;
}

/* ---------- общие замены через облако ---------- */

/* Чтобы замена, поставленная одним человеком, была видна всем на тот же день,
   сюда вставляется адрес общего хранилища. Два варианта:
   1) Firebase Realtime Database (сервис Google):
      "https://ТВОЙ-ПРОЕКТ-default-rtdb.РЕГИОН.firebasedatabase.app/weeqo-swaps.json"
   2) корзина Pantry (getpantry.cloud):
      "https://getpantry.cloud/apiv1/pantry/ТВОЙ-ID/basket/weeqo-swaps";
   Пустая строка = замены хранятся только на устройстве, как раньше.
   Проверить без правки кода можно параметром ?swaps-cloud=адрес. */
/* Конфиг переехал в js/config.js — правь там, этот файл больше не трогай.
   Читаем из window с запасными значениями на случай если config.js не загрузился. */
var SHARED_SWAPS_URL = window.SHARED_SWAPS_URL || "";
var FIREBASE_API_KEY = window.FIREBASE_API_KEY || "";
var TELEGRAM_BOT_NAME = window.TELEGRAM_BOT_NAME || "";
var TELEGRAM_BOT_TOKEN_SHA256 = window.TELEGRAM_BOT_TOKEN_SHA256 || "";
var sharedSync = { pushing: false, again: false, poll: null };

/* ---------- анонимный вход Firebase ----------
   Окон логина нет: приложение само молча получает временный токен через REST,
   а правила базы (".write": "auth != null") пускают запись только с ним.
   Токен живёт час, дальше тихо обновляется по refresh-токену. */
var fbAuth = { token: null, refresh: null, uid: null, expiresAt: 0, pending: null };

function firebaseAuthEnabled() {
  return (
    Boolean(FIREBASE_API_KEY) &&
    /\.(firebaseio\.com|firebasedatabase\.app)/.test(sharedSwapsUrl())
  );
}

function fbAuthLoad() {
  try {
    const raw = localStorage.getItem("weekly:fb-auth:v1");
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data.refresh === "string") fbAuth.refresh = data.refresh;
      if (data && typeof data.uid === "string") fbAuth.uid = data.uid;
    }
  } catch (e) {
    /* приватный режим */
  }
}

function fbAuthSave() {
  try {
    localStorage.setItem("weekly:fb-auth:v1", JSON.stringify({ refresh: fbAuth.refresh, uid: fbAuth.uid }));
  } catch (e) {
    /* приватный режим */
  }
}

async function fbAuthPost(url, body) {
  const resp = await fetch(url + "?key=" + FIREBASE_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error("firebase auth: " + resp.status);
  return resp.json();
}

async function ensureFbToken() {
  if (!firebaseAuthEnabled()) return null;
  /* Параллельные вызовы ждут один и тот же запрос. */
  if (fbAuth.pending) return fbAuth.pending;
  fbAuth.pending = (async () => {
    /* Запас 5 минут, чтобы токен не протух на середине записи. */
    if (fbAuth.token && Date.now() < fbAuth.expiresAt - 5 * 60 * 1000) {
      return fbAuth.token;
    }
    if (!fbAuth.refresh) fbAuthLoad();
    if (fbAuth.refresh) {
      try {
        const renewed = await fbAuthPost("https://securetoken.googleapis.com/v1/token", {
          grant_type: "refresh_token",
          refresh_token: fbAuth.refresh,
        });
        fbAuth.token = renewed.id_token;
        fbAuth.refresh = renewed.refresh_token;
        fbAuth.uid = renewed.user_id || fbAuth.uid;
        fbAuth.expiresAt = Date.now() + Number(renewed.expires_in) * 1000;
        fbAuthSave();
        return fbAuth.token;
      } catch (e) {
        fbAuth.refresh = null;
      }
    }
    const fresh = await fbAuthPost("https://identitytoolkit.googleapis.com/v1/accounts:signUp", {
      returnSecureToken: true,
    });
    fbAuth.token = fresh.idToken;
    fbAuth.refresh = fresh.refreshToken;
    fbAuth.uid = fresh.localId || null;
    fbAuth.expiresAt = Date.now() + Number(fresh.expiresIn) * 1000;
    fbAuthSave();
    return fbAuth.token;
  })();
  try {
    return await fbAuth.pending;
  } finally {
    fbAuth.pending = null;
  }
}

/* Тот же адрес базы, но с токеном. Без настроенного ключа возвращает как есть. */
async function sharedUrlWithAuth(url) {
  let token = null;
  try {
    token = await ensureFbToken();
  } catch (e) {
    /* auth недоступен офлайн не настроен) — пробуем без токена */
  }
  if (!token) return url;
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "auth=" + token;
}

function sharedSwapsUrl() {
  try {
    const forced = new URLSearchParams(window.location.search).get("swaps-cloud");
    if (forced) return forced;
  } catch (e) {}
  return SHARED_SWAPS_URL;
}

function sharedSwapsEnabled() {
  return Boolean(sharedSwapsUrl());
}

/* Записи по уже прошедшим дням выкидываем, чтобы корзина не разрасталась. */
function pruneSwapMap(map) {
  let changed = false;
  const horizon = Date.now() - 86400000;
  for (const key in map) {
    const datePart = (key.split("|")[1] || "").slice(0, 10);
    const end = new Date(datePart + "T23:59:59");
    if (!isNaN(end) && end.getTime() < horizon) {
      delete map[key];
      changed = true;
    }
  }
  return changed;
}

/* Склейка двух карт замен: у каждого ключа побеждает запись со свежим updatedAt. */
function mergeSwapMaps(base, incoming) {
  let changed = false;
  for (const key in incoming) {
    const inc = incoming[key];
    if (!inc || typeof inc !== "object") continue;
    const incT = typeof inc.updatedAt === "number" ? inc.updatedAt : 0;
    const cur = base[key];
    const curT = cur && typeof cur.updatedAt === "number" ? cur.updatedAt : 0;
    if (!cur || incT >= curT) {
      if (JSON.stringify(cur) !== JSON.stringify(inc)) {
        base[key] = inc;
        changed = true;
      }
    }
  }
  return changed;
}

/* ---------- вход через Telegram и роли ----------
   Виджет Telegram вызывает window.onTelegramAuth; подпись проверяем по
   sha256 токена бота (сам токен в коде не хранится!). Роль живёт в облаке:
   первый вошедший становится владельцем, владелец выдаёт редакторов.
   Права дополнительно режутся правилами базы (firebase-rules.json). */
var TG_SESSION_KEY = "weekly:tg-session:v1";
var tgSession = null;
var tgRoles = { owner: null, editors: {}, boundTg: null };
var pendingMap = {};
var tgRegisterState = "idle";

function tgConfigured() {
  return Boolean(TELEGRAM_BOT_NAME && TELEGRAM_BOT_TOKEN_SHA256);
}

function tgDisplayName(user) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || (user.username ? "@" + user.username : "участник");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function hmacSha256Hex(keyBytes, text) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Подпись виджета: строка "key=value" по алфавиту через \n, HMAC-SHA256 от sha256(токена). */
async function verifyTgAuth(payload) {
  try {
    if (!payload || !payload.id || !payload.hash || !payload.auth_date) return false;
    const keys = Object.keys(payload)
      .filter((k) => k !== "hash" && payload[k] !== undefined && payload[k] !== null && payload[k] !== "")
      .sort();
    const check = keys.map((k) => k + "=" + payload[k]).join("\n");
    const hex = await hmacSha256Hex(hexToBytes(TELEGRAM_BOT_TOKEN_SHA256), check);
    return hex === String(payload.hash).toLowerCase();
  } catch (e) {
    return false;
  }
}

function saveTgSession() {
  try {
    if (tgSession) localStorage.setItem(TG_SESSION_KEY, JSON.stringify(tgSession));
    else localStorage.removeItem(TG_SESSION_KEY);
  } catch (e) {
    /* приватный режим */
  }
}

/* Вход через приложение Telegram: после подтверждения виджет возвращает
   на data-auth-url с параметрами (?id=...&hash=...) — завершаем вход здесь. */
function checkTgAuthRedirect() {
  try {
    let raw = window.location.search;
    if (raw.indexOf("id=") === -1 && window.location.hash.indexOf("id=") !== -1)
      raw = "?" + window.location.hash.replace(/^#/, "");
    if (raw.indexOf("id=") === -1) return;
    const q = new URLSearchParams(raw);
    if (!q.get("id") || !q.get("hash") || !q.get("auth_date")) return;
    const payload = {};
    ["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"].forEach((k) => {
      const v = q.get(k);
      if (v !== null && v !== "") payload[k] = v;
    });
    payload.id = Number(payload.id);
    payload.auth_date = Number(payload.auth_date);
    verifyTgAuth(payload).then((ok) => {
      /* Чистим адресную строку в любом случае, чтобы параметры не висели в URL. */
      window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
      if (!ok) {
        toast("вход не подтвердился — попробуй ещё раз");
        return;
      }
      if (tgSession && String(tgSession.id) === String(payload.id)) return; /* уже вошли */
      tgSession = payload;
      tgRegisterState = "idle";
      saveTgSession();
      updateTgButton();
      if (state.profileOpen) openProfile();
      toast("привет, " + tgDisplayName(payload) + "!");
      tgSyncRoles().then(() => {
        pullSharedSwaps();
        if (loadNotifPrefs().telegram) syncTgSub();
      });
    });
  } catch (e) {
    /* кривые параметры — игнорируем */
  }
}

function loadTgSession() {
  try {
    const raw = localStorage.getItem(TG_SESSION_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.id || !data.hash || !data.auth_date) return;
    /* Сессия живёт 30 дней, потом попросим войти заново. */
    if (Math.abs(Date.now() / 1000 - Number(data.auth_date)) > 30 * 86400) return;
    tgSession = data;
    /* Фоново перепроверяем подпись — мало ли, кто-то правил localStorage. */
    verifyTgAuth(data).then((ok) => {
      if (!ok) tgLogout();
    });
  } catch (e) {
    /* приватный режим */
  }
}

function tgLogout() {
  tgSession = null;
  tgRoles = { owner: tgRoles.owner, editors: tgRoles.editors, boundTg: null };
  tgRegisterState = "idle";
  pendingMap = {};
  saveTgSession();
  updateTgButton();
}

window.onTelegramAuth = function (payload) {
  verifyTgAuth(payload).then((ok) => {
    if (!ok) {
      toast("вход не подтвердился — попробуй ещё раз");
      return;
    }
    tgSession = payload;
    tgRegisterState = "idle";
    saveTgSession();
    updateTgButton();
    renderTgSheetBody();
    if (state.profileOpen) openProfile();
    toast("привет, " + tgDisplayName(payload) + "!");
    tgSyncRoles().then(() => {
      pullSharedSwaps();
      if (loadNotifPrefs().telegram) syncTgSub();
    });
  });
};

function myRole() {
  if (!tgSession) return "anon";
  const tg = tgRoles.boundTg || String(tgSession.id);
  if (tgRoles.owner && tgRoles.owner === tg) return "owner";
  if (tgRoles.editors && tgRoles.editors[tg]) return "editor";
  return "user";
}

function swapPrimaryLabel() {
  const role = myRole();
  if (role === "owner" || role === "editor") return "опубликовать";
  if (role === "user") return "предложить";
  return "сохранить у себя";
}

function swapAccessHint() {
  if (!tgConfigured() || !sharedSwapsEnabled()) return "";
  const role = myRole();
  if (role === "anon") {
    return '<p class="weekly-replace-hint">сохранится только на этом устройстве. войди через Telegram (шестерёнка → аккаунт) — замена уйдёт редактору на проверку и станет общей</p>';
  }
  if (role === "user") {
    return '<p class="weekly-replace-hint">у тебя применится сразу, всем остальным — после проверки редактором</p>';
  }
  return "";
}

/* Регистрация: привязываем анонимный uid устройства к Telegram id (один раз),
   первый вошедший клеймит владельца. Права проверяются правилами базы. */
async function tgRegister() {
  if (tgRegisterState === "done" || tgRegisterState === "pending") return;
  tgRegisterState = "pending";
  try {
    const token = await ensureFbToken();
    if (!token || !fbAuth.uid) throw new Error("нет firebase-сессии");
    const mine = String(tgSession.id);
    const regUrl = await sharedUrlWithAuth(cloudRoot() + "/weeqo-users/" + fbAuth.uid + ".json");
    const regResp = await fetch(regUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    const bound = regResp.ok ? await regResp.json() : null;
    if (bound === null) {
      const put = await fetch(regUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mine),
      });
      if (!put.ok) throw new Error("регистрация отклонена: " + put.status);
      tgRoles.boundTg = mine;
    } else {
      /* На этом устройстве уже входили в другой Telegram — права по старой привязке. */
      tgRoles.boundTg = String(bound);
    }
    const ownerUrl = await sharedUrlWithAuth(cloudRoot() + "/weeqo-meta/owner.json");
    const ownerResp = await fetch(ownerUrl, { headers: { Accept: "application/json" }, cache: "no-store" });
    const owner = ownerResp.ok ? await ownerResp.json() : null;
    if (owner === null) {
      /* Правила пропускают только самую первую запись — гонка не страшна. */
      await fetch(ownerUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tgRoles.boundTg),
      });
    }
    tgRegisterState = "done";
  } catch (e) {
    tgRegisterState = "idle"; /* повторим в следующий тик опроса */
    throw e;
  }
}

async function tgSyncRoles() {
  if (!tgSession || !tgConfigured()) return;
  try {
    await tgRegister();
    const root = cloudRoot();
    const [ownerResp, editorsResp] = await Promise.all([
      fetch(await sharedUrlWithAuth(root + "/weeqo-meta/owner.json"), { headers: { Accept: "application/json" }, cache: "no-store" }),
      fetch(await sharedUrlWithAuth(root + "/weeqo-editors.json"), { headers: { Accept: "application/json" }, cache: "no-store" }),
    ]);
    if (ownerResp.ok) tgRoles.owner = await ownerResp.json();
    const editors = editorsResp.ok ? await editorsResp.json() : null;
    tgRoles.editors = editors && typeof editors === "object" ? editors : {};
    updateTgButton();
  } catch (e) {
    /* офлайн — роли останутся от прошлого тика */
  }
}

/* Корень базы без имени файла: из ".../weeqo-swaps.json" делаем "...". */
function cloudRoot() {
  return sharedSwapsUrl().replace(/\/[^/]*\.json.*$/, "");
}

/* В ключах замен есть "/" (группы вида "тм-303/б") и могут быть точки —
   Firebase такое в ключах не принимает поэтому кодируем. */
function encodeSwapKey(key) {
  return encodeURIComponent(key).replace(/\./g, "%2E");
}

function decodeSwapKey(enc) {
  try {
    return decodeURIComponent(enc);
  } catch (e) {
    return enc;
  }
}

function decodeSwapEntries(data) {
  const out = {};
  for (const enc in data) out[decodeSwapKey(enc)] = data[enc];
  return out;
}

/* Единая точка записи: PUT с телом или DELETE (body === null). true = база приняла. */
async function cloudWrite(path, body) {
  try {
    const url = await sharedUrlWithAuth(cloudRoot() + "/" + path + ".json");
    const resp = await fetch(
      url,
      body === null
        ? { method: "DELETE" }
        : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!resp.ok) console.warn("weeqo: база отклонила запись (" + resp.status + ") " + path);
    return resp.ok;
  } catch (e) {
    return false;
  }
}

/* Редактор/владелец: замена уходит сразу в опубликованные, по одной записи. */
async function pushSwapEntry(key, entry) {
  const payload = Object.assign({}, entry);
  delete payload.pendingSync;
  if (tgSession) {
    payload.by = String(tgSession.id);
    payload.byName = tgDisplayName(tgSession);
  }
  const ok = await cloudWrite("weeqo-swaps/" + encodeSwapKey(key), payload);
  if (ok) {
    if (entry.pendingSync) {
      delete entry.pendingSync;
      saveSwaps();
    }
  } else {
    entry.pendingSync = true;
    saveSwaps();
  }
  return ok;
}

/* Обычный участник: замена уходит заявкой на проверку. */
async function proposeSwapEntry(key, entry) {
  if (!tgSession) return false;
  const payload = Object.assign({}, entry, {
    by: String(tgSession.id),
    byName: tgDisplayName(tgSession),
  });
  delete payload.pendingSync;
  const ok = await cloudWrite("weeqo-pending/" + encodeSwapKey(key), payload);
  if (!ok) toast("не отправилось — проверь интернет");
  return ok;
}

/* Куда уходит замена после сохранения — зависит от роли. */
function publishSwapKey(key) {
  if (!sharedSwapsEnabled() || !tgConfigured()) return;
  const entry = loadSwaps()[key];
  if (!entry) return;
  const role = myRole();
  if (role === "owner" || role === "editor") {
    pushSwapEntry(key, entry);
  } else if (role === "user") {
    proposeSwapEntry(key, entry).then((ok) => {
      if (ok) toast("отправлено на проверку");
    });
  }
  /* anon: остаётся локально, подсказка уже есть в окне замены */
}

async function pullPending() {
  try {
    const resp = await fetch(await sharedUrlWithAuth(cloudRoot() + "/weeqo-pending.json"), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = resp.ok ? await resp.json() : null;
    pendingMap = data && typeof data === "object" ? data : {};
    notifyAboutPending();
  } catch (e) {
    /* офлайн */
  }
  updateTgButton();
  renderTgSheetBody();
}

async function approvePending(enc) {
  const entry = pendingMap[enc];
  if (!entry) return;
  const ok = await cloudWrite("weeqo-swaps/" + enc, entry);
  if (!ok) {
    toast("не получилось опубликовать");
    return;
  }
  await cloudWrite("weeqo-pending/" + enc, null);
  delete pendingMap[enc];
  /* Применяем локально сразу, не дожидаясь опроса. */
  const map = loadSwaps();
  const key = decodeSwapKey(enc);
  const cur = map[key];
  if (!cur || typeof cur.updatedAt !== "number" || cur.updatedAt <= entry.updatedAt) {
    map[key] = Object.assign({}, entry);
    saveSwaps();
  }
  updateTgButton();
  renderTgSheetBody();
  render();
  toast("замена опубликована");
}

async function rejectPending(enc) {
  const ok = await cloudWrite("weeqo-pending/" + enc, null);
  if (!ok) {
    toast("не получилось отклонить");
    return;
  }
  delete pendingMap[enc];
  updateTgButton();
  renderTgSheetBody();
}

async function grantEditor(tgId, name) {
  const ok = await cloudWrite("weeqo-editors/" + tgId, name || "редактор");
  if (!ok) {
    toast("не получилось выда��ь доступ");
    return;
  }
  toast("редактор добавлен");
  await tgSyncRoles();
  renderTgSheetBody();
}

async function revokeEditor(tgId) {
  const ok = await cloudWrite("weeqo-editors/" + tgId, null);
  if (!ok) {
    toast("не получилось убрать");
    return;
  }
  await tgSyncRoles();
  renderTgSheetBody();
}

/* ---------- тосты ---------- */
var toastTimer = null;
function toast(text) {
  let el = document.getElementById("weeqo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "weeqo-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-visible"), 2600);
}

async function pullSharedSwaps() {
  const url = sharedSwapsUrl();
  if (!url) return;
  /* Пока открыт редактор замены, сеть не дёргаем, чтобы не потерять ввод. */
  if (document.getElementById("swap-backdrop")) return;
  try {
    const resp = await fetch(await sharedUrlWithAuth(url), { headers: { Accept: "application/json" }, cache: "no-store" });
    let remote = {};
    if (resp.ok) {
      const data = await resp.json();
      if (data && typeof data === "object") remote = decodeSwapEntries(data);
    }
    notifyAboutRemoteSwaps(remote);
    const map = loadSwaps();
    const changedLocal = mergeSwapMaps(map, remote) || pruneSwapMap(map);
    if (changedLocal) {
      saveSwaps();
      if (!scrub && !document.getElementById("swap-backdrop")) render();
    }
    /* Редакторы дожимают записи, не ушедшие из-за офлайна. */
    if (myRole() === "owner" || myRole() === "editor") {
      for (const key in map) {
        if (map[key] && map[key].pendingSync) pushSwapEntry(key, map[key]);
      }
    }
  } catch (e) {
    /* офлайн — повторим в следующий тик */
  }
  if (tgConfigured() && tgSession) {
    await tgSyncRoles();
    if (myRole() === "owner" || myRole() === "editor") pullPending();
  }
}

/* ---------- окно Telegram: вход, заявки, редакторы ---------- */

function updateTgButton() {
  /* Вход живёт в профиле (шестерёнка → аккаунт); шестерёнка после входа
     становится аватаркой. */
  updateSettingsAvatar();
  renderAccountRow();
}

/* Аватар из Telegram вместо шестерёнки настроек. */
function updateSettingsAvatar() {
  const trigger = document.getElementById("settings-trigger");
  if (!trigger) return;
  const url = tgSession && tgSession.photo_url ? String(tgSession.photo_url) : "";
  let img = trigger.querySelector("img.weekly-trigger-avatar");
  if (url) {
    if (!img) {
      img = document.createElement("img");
      img.className = "weekly-trigger-avatar";
      img.alt = "";
      trigger.appendChild(img);
    }
    if (img.getAttribute("src") !== url) img.setAttribute("src", url);
    trigger.classList.add("is-avatar");
  } else {
    if (img) img.remove();
    trigger.classList.remove("is-avatar");
  }
}

/* Строка аккаунта в самом верху настроек. */
function renderAccountRow() {
  const title = document.getElementById("account-title");
  if (!title) return;
  const hint = document.getElementById("account-hint");
  const icon = document.getElementById("account-icon");
  if (tgSession) {
    title.textContent = tgDisplayName(tgSession);
    const role = myRole();
    const roleLabel = role === "owner" ? "владелец" : role === "editor" ? "редактор" : "студент";
    if (hint) hint.textContent = roleLabel + (tgSession.username ? " · @" + tgSession.username : "");
    if (icon && tgSession.photo_url)
      icon.innerHTML = '<img class="weekly-account-avatar" src="' + escapeHtml(String(tgSession.photo_url)) + '" alt="">';
  } else {
    title.textContent = "профиль";
    if (hint) hint.textContent = tgConfigured() ? "группа, уведомления, вход через telegram" : "группа и уведомления";
  }
}

function mountTelegramWidget(container) {
  if (!container) return;
  container.innerHTML = "";
  const script = document.createElement("script");
  script.src = "https://telegram.org/js/telegram-widget.js?22";
  script.setAttribute("data-telegram-login", TELEGRAM_BOT_NAME);
  script.setAttribute("data-size", "large");
  script.setAttribute("data-onauth", "onTelegramAuth");
  /* Возврат из приложения Telegram: виджет редиректит на страницу с параметрами
     входа (?id=...&hash=...), их при загрузке ловит checkTgAuthRedirect(). */
  script.setAttribute("data-auth-url", window.location.origin + window.location.pathname);
  script.async = true;
  container.appendChild(script);
}

function closeTgSheet() {
  const backdrop = document.getElementById("tg-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  window.setTimeout(() => backdrop.remove(), 160);
}

function pendingRowHtml(enc, entry, role) {
  const key = decodeSwapKey(enc);
  const m = key.match(/\|(\d{4}-\d{2}-\d{2}):(\d+)$/);
  let when = key;
  if (m) when = dateLabel(dateFromIso(m[1])) + " · " + m[2] + " пара";
  let what = "изменение";
  if (entry.deleted) what = "сброс замены";
  else if (entry.cancelled) what = "отмена пары";
  else {
    const parts = [entry.subject, entry.teacher, entry.room].filter(Boolean);
    if (parts.length) what = parts.join(" · ");
  }
  const who = entry.byName || "без имени";
  let actions =
    '<button class="is-primary" type="button" data-tg="approve" data-key="' + escapeHtml(enc) + '">принять</button>' +
    '<button type="button" data-tg="reject" data-key="' + escapeHtml(enc) + '">отклонить</button>';
  if (role === "owner" && entry.by && entry.by !== String(tgRoles.owner) && !tgRoles.editors[entry.by]) {
    actions +=
      '<button type="button" data-tg="grant" data-key="' + escapeHtml(enc) + '" data-tgid="' +
      escapeHtml(String(entry.by)) + '">+ редактор</button>';
  }
  return (
    '<div class="weekly-tg-row"><div class="weekly-tg-row-text"><strong>' + escapeHtml(what) + "</strong><span>" +
    escapeHtml(when) + " · предложил(а): " + escapeHtml(who) +
    '</span></div><div class="weekly-tg-row-actions">' + actions + "</div></div>"
  );
}

function renderTgSheetBody() {
  const body = document.getElementById("tg-sheet-body");
  if (!body) return;
  if (!tgSession) {
    body.innerHTML =
      '<div class="weekly-replace-head"><strong>вход через Telegram</strong><span>чтобы предлагать замены</span></div>' +
      '<div class="weekly-tg-widget" id="tg-widget-mount"></div>' +
      '<p class="weekly-replace-hint">кнопка работает только на опубликованном сайте — домен привязывается к боту через /setdomain у @BotFather. после входа твои замены уходят редактору на проверку.</p>' +
      '<div class="weekly-replace-actions"><button type="button" data-tg="close">закрыть</button></div>';
    mountTelegramWidget(body.querySelector("#tg-widget-mount"));
    return;
  }
  const role = myRole();
  const roleLabel = role === "owner" ? "владелец" : role === "editor" ? "редактор" : "студент";
  let html =
    '<div class="weekly-replace-head"><strong>' + escapeHtml(tgDisplayName(tgSession)) + "</strong><span>" + roleLabel + "</span></div>";
  if (role === "user")
    html +=
      '<p class="weekly-replace-hint">мой id: ' +
      escapeHtml(String(tgSession.id)) +
      " — назови его владельцу, чтобы получить права редактора</p>";
  if (role === "owner" || role === "editor") {
    const keys = Object.keys(pendingMap).sort((a, b) => (pendingMap[b].updatedAt || 0) - (pendingMap[a].updatedAt || 0));
    html += '<div class="weekly-tg-section"><span>заявки (' + keys.length + ")</span>";
    if (!keys.length) html += '<p class="weekly-replace-hint">пока пусто</p>';
    keys.forEach((enc) => {
      html += pendingRowHtml(enc, pendingMap[enc], role);
    });
    html += "</div>";
  }
  if (role === "owner") {
    const ids = Object.keys(tgRoles.editors);
    html += '<div class="weekly-tg-section"><span>редакторы</span>';
    if (!ids.length) html += '<p class="weekly-replace-hint">пока нет. добавь по id ниже или кнопкой «+ редактор» в любой заявке.</p>';
    ids.forEach((tg) => {
      html +=
        '<div class="weekly-tg-row"><div class="weekly-tg-row-text"><strong>' + escapeHtml(String(tgRoles.editors[tg])) +
        '</strong></div><div class="weekly-tg-row-actions"><button type="button" data-tg="revoke" data-tgid="' +
        escapeHtml(tg) + '">убрать</button></div></div>';
    });
    html +=
      '<div class="weekly-tg-add"><input type="text" inputmode="numeric" id="tg-add-editor-id" placeholder="id редактора" autocomplete="off">' +
      '<button type="button" data-tg="add-editor">добавить</button></div>' +
      '<p class="weekly-replace-hint">id виден в окне входа у человека (строка «мой id»). редактор проверяет заявки, а его замены уходят всем сразу.</p>';
    html += "</div>";
  }
  html +=
    '<div class="weekly-replace-actions"><button type="button" data-tg="logout">выйти</button>' +
    '<button type="button" data-tg="close">закрыть</button></div>';
  body.innerHTML = html;
}

function openTgSheet() {
  closeTgSheet();
  if (!tgConfigured()) {
    toast("вход через Telegram не настроен");
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.id = "tg-backdrop";
  backdrop.className = "weekly-replace-backdrop";
  backdrop.innerHTML =
    '<div class="weekly-replace-sheet weekly-tg-sheet" role="dialog" aria-label="Telegram"><div id="tg-sheet-body"></div></div>';
  document.body.appendChild(backdrop);
  window.requestAnimationFrame(() => backdrop.classList.add("is-open"));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeTgSheet();
      return;
    }
    const el = e.target.closest("[data-tg]");
    if (!el) return;
    const act = el.dataset.tg;
    if (act === "close") closeTgSheet();
    else if (act === "logout") {
      tgLogout();
      closeTgSheet();
      render();
    } else if (act === "approve") approvePending(el.dataset.key);
    else if (act === "reject") rejectPending(el.dataset.key);
    else if (act === "grant") {
      const entry = pendingMap[el.dataset.key] || {};
      grantEditor(el.dataset.tgid, entry.byName);
    } else if (act === "revoke") revokeEditor(el.dataset.tgid);
    else if (act === "add-editor") {
      const inp = document.getElementById("tg-add-editor-id");
      const id = inp ? inp.value.trim() : "";
      if (!/^\d{3,32}$/.test(id)) {
        toast("нужен числовой id — он есть в окне входа у человека");
        return;
      }
      grantEditor(id, "редактор " + id);
    }
  });
  renderTgSheetBody();
  if (myRole() === "owner" || myRole() === "editor") pullPending();
}

/* ---------- уведомления (колокольчик в шапке) ----------
   Лента в localStorage: кто-то опубликовал замену/отмену, обновилось базовое
   расписание, редактору пришла новая заявка. Бейдж = непрочитанные. */
var NOTIF_KEY = "weekly:notifs:v1";
var NOTIF_SEEN_SWAPS_KEY = "weekly:notif-seen-swaps:v1";
var NOTIF_SEEN_SCHEDULE_KEY = "weekly:notif-seen-schedule:v1";
var NOTIF_SEEN_PENDING_KEY = "weekly:notif-seen-pending:v1";
var notifList = null;

/* Настройки уведомлений: что показывать в колокольчике и дублировать в Telegram. */
var NOTIF_PREFS_KEY = "weekly:notif-prefs:v1";
var notifPrefs = null;

function loadNotifPrefs() {
  if (notifPrefs) return notifPrefs;
  notifPrefs = { swaps: true, schedule: true, pending: true, telegram: false };
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === "object")
        for (const k in notifPrefs) if (typeof data[k] === "boolean") notifPrefs[k] = data[k];
    }
  } catch (e) {}
  return notifPrefs;
}

function saveNotifPrefs() {
  try {
    localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(notifPrefs));
  } catch (e) {}
}

/* Переключатель категории уведомлений в профиле. */
function toggleNotifPref(key, el) {
  const p = loadNotifPrefs();
  if (key === "telegram" && !p.telegram && !tgSession) {
    toast("сначала войди через Telegram — кнопка тут же, в профиле");
    return;
  }
  if (key === "telegram" && !p.telegram) {
    /* Памятка перед включением: бот не может написать первым,
       пока человек не нажал у него /start. */
    showTgMemo(() => {
      p.telegram = true;
      saveNotifPrefs();
      if (el) el.setAttribute("aria-pressed", "true");
      syncTgSub().then((ok) => {
        if (p.telegram) toast(ok ? "бот пришлёт уведомления лично" : "не получилось — проверь интернет");
      });
    });
    return;
  }
  p[key] = !p[key];
  saveNotifPrefs();
  if (el) el.setAttribute("aria-pressed", p[key] ? "true" : "false");
  if (key === "telegram") syncTgSub();
  else if (p.telegram) syncTgSub();
}

/* Памятка про /start при включении дублирования в Telegram. */
function showTgMemo(onConfirm) {
  closeTgMemo();
  const bot = TELEGRAM_BOT_NAME ? "@" + TELEGRAM_BOT_NAME : "этому боту";
  const wrap = document.createElement("div");
  wrap.className = "weekly-tg-memo-backdrop";
  wrap.id = "tg-memo";
  wrap.innerHTML =
    '<div class="weekly-tg-memo" role="dialog" aria-label="памятка про телеграм-бота">' +
    '<span class="weekly-tg-memo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.9 4.6c.3-1.1-.8-2-1.9-1.6L2.6 10.4c-1 .4-.9 1.7.1 2l4.2 1.4 1.6 5c.3.9 1.4 1.1 2 .4l2.2-2.6 4 3c.7.5 1.8.1 2-.8l2.6-14.6z"/><path d="M7 14.5 18 6"/></svg></span>' +
    "<strong>сначала напиши " + escapeHtml(bot) + " /start</strong>" +
    "<p>телеграм не разрешает боту писать первым. открой " + escapeHtml(bot) + ' и нажми «старт» — иначе уведомления до тебя не дойдут.</p>' +
    '<div class="weekly-tg-memo-actions">' +
    (TELEGRAM_BOT_NAME ? '<a href="https://t.me/' + escapeHtml(TELEGRAM_BOT_NAME) + '" target="_blank" rel="noopener noreferrer">открыть бота</a>' : "") +
    '<button type="button" class="is-primary">понятно</button>' +
    "</div></div>";
  document.body.appendChild(wrap);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) {
      closeTgMemo();
      return;
    }
    if (e.target.closest("button.is-primary")) {
      closeTgMemo();
      if (onConfirm) onConfirm();
    }
  });
}

function closeTgMemo() {
  const el = document.getElementById("tg-memo");
  if (el) el.remove();
}

/* Подписка на личные уведомления в Telegram: запись уходит в weeqo-tg-subs,
   а рассылает бот через GitHub Action (tools/notify_telegram.py). Перед
   включением человек жмёт /start у бота — иначе TG не даёт написать первым. */
async function syncTgSub() {
  if (!tgSession || !sharedSwapsEnabled() || !tgConfigured()) return false;
  const prefs = loadNotifPrefs();
  const path = "weeqo-tg-subs/" + tgSession.id;
  if (!prefs.telegram) return cloudWrite(path, null);
  const role = myRole();
  return cloudWrite(path, {
    name: tgDisplayName(tgSession),
    swaps: !!prefs.swaps,
    schedule: !!prefs.schedule,
    pending: !!(prefs.pending && (role === "owner" || role === "editor")),
    updatedAt: Date.now(),
  });
}

function loadNotifs() {
  if (notifList) return;
  notifList = [];
  try {
    var raw = localStorage.getItem(NOTIF_KEY);
    if (raw) {
      var data = JSON.parse(raw);
      if (Array.isArray(data))
        notifList = data.filter(function (n) { return n && typeof n.text === "string" && typeof n.at === "number"; });
    }
  } catch (e) {
    notifList = [];
  }
}

function saveNotifs() {
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(notifList || []));
  } catch (e) {
    /* приватный режим */
  }
}

function pushNotif(text, kind) {
  const prefs = loadNotifPrefs();
  if (kind && prefs[kind] === false) return;
  loadNotifs();
  notifList.unshift({ text: text, at: Date.now(), read: false });
  if (notifList.length > 50) notifList.length = 50;
  saveNotifs();
  updateBellButton();
}

function updateBellButton() {
  var btn = document.getElementById("bell-btn");
  if (!btn) return;
  loadNotifs();
  var unread = 0;
  for (var i = 0; i < notifList.length; i++) if (!notifList[i].read) unread++;
  var badge = document.getElementById("bell-badge");
  if (badge) {
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
  }
}

/* Текстовое описание записи замены для ленты. */
function describeSwapForNotif(key, entry) {
  var m = key.match(/\|(\d{4}-\d{2}-\d{2}):(\d+)$/);
  var when = m ? dateLabel(dateFromIso(m[1])) + " · " + m[2] + " пара" : key;
  var what = "замена";
  if (entry.deleted) what = "сброс замены";
  else if (entry.cancelled) what = "отмена пары";
  var parts = [entry.subject, entry.teacher, entry.room].filter(Boolean);
  var who = entry.byName ? " · " + entry.byName : "";
  return what + " · " + when + (parts.length ? ": " + parts.join(" · ") : "") + who;
}

/* Свежие записи из облака -> лента. Первый прогон только запоминает состояние. */
function notifyAboutRemoteSwaps(remote) {
  if (!remote || typeof remote !== "object") return;
  var seen = null;
  var firstRun = false;
  try {
    var raw = localStorage.getItem(NOTIF_SEEN_SWAPS_KEY);
    seen = raw ? JSON.parse(raw) : null;
  } catch (e) {
    seen = null;
  }
  if (!seen || typeof seen !== "object") {
    seen = {};
    firstRun = true;
  }
  var myId = tgSession ? String(tgSession.id) : null;
  var gprefix = (state.group || DEFAULT_GROUP) + "|";
  var changed = false;
  for (var key in remote) {
    var entry = remote[key];
    if (!entry || typeof entry !== "object") continue;
    var t = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
    if (!t) continue;
    var prev = typeof seen[key] === "number" ? seen[key] : 0;
    if (t <= prev) continue;
    seen[key] = t;
    changed = true;
    if (!firstRun && key.indexOf(gprefix) === 0 && (!myId || String(entry.by || "") !== myId)) {
      pushNotif(describeSwapForNotif(key, entry), "swaps");
    }
  }
  if (changed) {
    try {
      localStorage.setItem(NOTIF_SEEN_SWAPS_KEY, JSON.stringify(seen));
    } catch (e) {}
  }
}

/* Новые заявки -> лента владельца/редактора. */
function notifyAboutPending() {
  var role = myRole();
  if (role !== "owner" && role !== "editor") return;
  var seen = null;
  var firstRun = false;
  try {
    var raw = localStorage.getItem(NOTIF_SEEN_PENDING_KEY);
    seen = raw ? JSON.parse(raw) : null;
  } catch (e) {
    seen = null;
  }
  if (!seen || typeof seen !== "object") {
    seen = {};
    firstRun = true;
  }
  var nowMap = {};
  Object.keys(pendingMap).forEach(function (enc) {
    nowMap[enc] = (pendingMap[enc] && pendingMap[enc].updatedAt) || 0;
  });
  if (!firstRun) {
    Object.keys(nowMap).forEach(function (enc) {
      if (!(enc in seen)) pushNotif("заявка · " + describeSwapForNotif(decodeSwapKey(enc), pendingMap[enc] || {}), "pending");
    });
  }
  try {
    localStorage.setItem(NOTIF_SEEN_PENDING_KEY, JSON.stringify(nowMap));
  } catch (e) {}
}

/* Смена штампа данных -> «обновились пары». */
function notifyAboutScheduleStamp(updatedAt) {
  if (!updatedAt) return;
  try {
    var prev = localStorage.getItem(NOTIF_SEEN_SCHEDULE_KEY);
    if (prev && prev !== updatedAt) pushNotif("обновились пары — базовое расписание обновлено", "schedule");
    localStorage.setItem(NOTIF_SEEN_SCHEDULE_KEY, updatedAt);
  } catch (e) {}
}

function closeBellSheet() {
  var backdrop = document.getElementById("bell-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  window.setTimeout(function () { backdrop.remove(); }, 160);
}

function renderBellBody() {
  var body = document.getElementById("bell-sheet-body");
  if (!body) return;
  loadNotifs();
  var html = '<div class="weekly-replace-head"><strong>уведомления</strong><span>замены и обновления</span></div>';
  if (!notifList.length) {
    html +=
      '<p class="weekly-replace-hint weekly-updates-empty">пока тихо. как только кто-то опубликует замену, отменит пару или обновится расписание — здесь появится запись.</p>';
  } else {
    html += '<div class="weekly-tg-section">';
    notifList.forEach(function (n) {
      html +=
        '<div class="weekly-tg-row"><div class="weekly-tg-row-text"><strong>' +
        escapeHtml(n.text) +
        "</strong><span>" +
        escapeHtml(fmtDateTime(n.at)) +
        "</span></div></div>";
    });
    html += "</div>";
  }
  html +=
    '<div class="weekly-replace-actions">' +
    (notifList.length ? '<button type="button" data-bell="clear">очистить</button>' : "") +
    '<button type="button" data-bell="close">закрыть</button></div>';
  body.innerHTML = html;
}

function openBellSheet() {
  closeBellSheet();
  var backdrop = document.createElement("div");
  backdrop.id = "bell-backdrop";
  backdrop.className = "weekly-replace-backdrop";
  backdrop.innerHTML =
    '<div class="weekly-replace-sheet weekly-tg-sheet" role="dialog" aria-label="уведомления"><div id="bell-sheet-body"></div></div>';
  document.body.appendChild(backdrop);
  window.requestAnimationFrame(function () { backdrop.classList.add("is-open"); });
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) {
      closeBellSheet();
      return;
    }
    var el = e.target.closest("[data-bell]");
    if (!el) return;
    if (el.dataset.bell === "close") closeBellSheet();
    else if (el.dataset.bell === "clear") {
      notifList = [];
      saveNotifs();
      updateBellButton();
      renderBellBody();
    }
  });
  /* Открытие = всё прочитано. */
  loadNotifs();
  notifList.forEach(function (n) { n.read = true; });
  saveNotifs();
  updateBellButton();
  renderBellBody();
}

/* ---------- журнал обновлений расписания («?» внизу настроек) ---------- */
var scheduleUpdatedAt = null;

/* Компактный штамп данных в шапке под бейджем чётности: число и время. */
function fmtStamp(isoValue) {
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderDataStamp() {
  const el = $("#data-stamp");
  if (!el) return;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const when = scheduleUpdatedAt ? fmtStamp(scheduleUpdatedAt) : "";
  if (!when) {
    /* Данных ещё нет: показываем, что приложение их ищет (или «офлайн»). */
    el.textContent = offline ? "офлайн" : "ищем данные…";
    el.hidden = false;
    return;
  }
  el.hidden = false;
  el.textContent = offline ? "офлайн · " + when : "обн. " + when;
}

function fmtDateTime(isoValue) {
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function closeUpdatesSheet() {
  const backdrop = document.getElementById("updates-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("is-open");
  window.setTimeout(() => backdrop.remove(), 160);
}

function updatesRowHtml(entry) {
  const when = fmtDateTime(entry.at);
  const details = Array.isArray(entry.details) ? entry.details : [];
  return (
    '<div class="weekly-tg-row"><div class="weekly-tg-row-text"><strong>' +
    escapeHtml((entry.group || "?") + (entry.summary ? " · " + entry.summary : "")) +
    "</strong><span>" + escapeHtml(when) + "</span>" +
    details.map((d) => "<span>" + escapeHtml(d) + "</span>").join("") +
    "</div></div>"
  );
}

function renderUpdatesBody(data) {
  const body = document.getElementById("updates-sheet-body");
  if (!body) return;
  const stamp = scheduleUpdatedAt
    ? "данные обновлены: " + fmtDateTime(scheduleUpdatedAt)
    : "данные ещё не загружались";
  let html =
    '<div class="weekly-replace-head"><strong>обновления расписания</strong><span>' +
    escapeHtml(stamp) + "</span></div>";
  const entries = data && Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    html +=
      '<p class="weekly-replace-hint weekly-updates-empty">изменений пока не было. как только парсер найдёт отличия в PDF колледжа, они появятся здесь — по каждой группе отдельно.</p>';
  } else {
    html += '<div class="weekly-tg-section"><span>изменения по всем группам (' + entries.length + ")</span>";
    entries.forEach((entry) => {
      html += updatesRowHtml(entry);
    });
    html += "</div>";
  }
  html += '<div class="weekly-replace-actions"><button type="button" data-updates="close">закрыть</button></div>';
  body.innerHTML = html;
}

function openUpdatesSheet() {
  closeUpdatesSheet();
  const backdrop = document.createElement("div");
  backdrop.id = "updates-backdrop";
  backdrop.className = "weekly-replace-backdrop";
  backdrop.innerHTML =
    '<div class="weekly-replace-sheet weekly-tg-sheet" role="dialog" aria-label="обновления расписания"><div id="updates-sheet-body"></div></div>';
  document.body.appendChild(backdrop);
  window.requestAnimationFrame(() => backdrop.classList.add("is-open"));
  backdrop.addEventListener("click", (e) => {
    /* Клики по этому окну не должны закрывать настройки под ним —
       у поповера закрытие по клику вне его, стопаем всплытие. */
    e.stopPropagation();
    if (e.target === backdrop || e.target.closest('[data-updates="close"]')) closeUpdatesSheet();
  });
  renderUpdatesBody(null);
  fetch("data/changelog.json?t=" + Date.now(), { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then(renderUpdatesBody)
    .catch(() => renderUpdatesBody(null));
}

/* Ручное обновление из настроек: перечитывает расписание и замены. */
var refreshInFlight = false;

function manualRefresh(btn) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  btn.disabled = true;
  const icon = btn.querySelector(".weekly-settings-icon svg") || btn.querySelector("svg");
  if (icon) icon.classList.add("is-spinning");
  /* Замены тянем параллельно, у них своя защита от ошибок сети. */
  Promise.resolve(pullSharedSwaps()).catch(() => {});
  refreshSchedule(true)
    .then((result) => {
      if (result === true) toast("данные обновлены");
      else if (result === "empty") toast("на сервере пока пусто — парсер ещё не отработал");
      else toast("не удалось обновить — проверь интернет");
    })
    .catch(() => toast("не удалось обновить — проверь интернет"))
    .finally(() => {
      refreshInFlight = false;
      btn.disabled = false;
      if (icon) icon.classList.remove("is-spinning");
    });
}

(function initUpdates() {
  const btn = document.getElementById("go-updates");
  if (btn) btn.addEventListener("click", openUpdatesSheet);
  const headRefreshBtn = document.getElementById("refresh-btn");
  if (headRefreshBtn) headRefreshBtn.addEventListener("click", () => manualRefresh(headRefreshBtn));
  window.addEventListener("online", renderDataStamp);
  window.addEventListener("offline", renderDataStamp);
  renderDataStamp();
})();

(function initTg() {
  loadTgSession();
  checkTgAuthRedirect();
  updateTgButton();
})();

(function initBell() {
  const btn = document.getElementById("bell-btn");
  if (btn) btn.addEventListener("click", openBellSheet);
  updateBellButton();
})();

(function initAccountRow() {
  const acc = document.getElementById("go-account");
  if (acc)
    acc.addEventListener("click", () => {
      closeSettings();
      openProfile();
    });
  renderAccountRow();
})();

(function startSharedSwaps() {
  if (!sharedSwapsEnabled()) return;
  window.setTimeout(pullSharedSwaps, 1200);
  sharedSync.poll = window.setInterval(pullSharedSwaps, 45000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pullSharedSwaps();
  });
})();
