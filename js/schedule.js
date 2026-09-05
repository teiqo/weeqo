// расписание нескольких групп (распознано с фото сводной таблицы)
// parity: "even" (чётная) | "odd" (нечётная); self — самостоятельная работа

export const BELLS = [
  { n: 1, week: "8:30–10:05", sat: "8:30–10:05" },
  { n: 2, week: "10:15–11:50", sat: "10:15–11:50" },
  { n: 3, week: "12:30–14:05", sat: "12:10–13:45" },
  { n: 4, week: "14:15–15:50", sat: "13:55–15:30" },
  { n: 5, week: "16:00–17:35", sat: "15:40–17:10" },
  { n: 6, week: "17:45–19:20", sat: "17:45–19:20" },
];

const TIMES = {
  1: { week: ["08:30", "10:05"], sat: ["08:30", "10:05"] },
  2: { week: ["10:15", "11:50"], sat: ["10:15", "11:50"] },
  3: { week: ["12:30", "14:05"], sat: ["12:10", "13:45"] },
  4: { week: ["14:15", "15:50"], sat: ["13:55", "15:30"] },
  5: { week: ["16:00", "17:35"], sat: ["15:40", "17:10"] },
  6: { week: ["17:45", "19:20"], sat: ["17:45", "19:20"] },
};

const DAY_META = [
  { id: 1, short: "пн", name: "понедельник" },
  { id: 2, short: "вт", name: "вторник" },
  { id: 3, short: "ср", name: "среда" },
  { id: 4, short: "чт", name: "четверг" },
  { id: 5, short: "пт", name: "пятница" },
  { id: 6, short: "сб", name: "суббота" },
  { id: 0, short: "вс", name: "воскресенье" },
];

const RAW = {
  "тм-303/б": {
    1: [
      [4, "иностранный язык", "клушева а.а.", "308а"],
      [5, "мдк 01.01", "дубровина т.б.", "319"],
    ],
    2: [
      [3, "мдк 02.01", "ченцов с.а.", "104"],
      [4, "мдк 02.01", "ченцов с.а.", "104"],
    ],
    3: [
      [1, "мдк 06.01", "ченцов с.а.", "104"],
      [2, "мдк 02.01", "ченцов с.а.", "104"],
    ],
    4: [
      [3, "мдк 06.01", "ченцов с.а.", "104", { parity: "odd" }],
      [4, "компьютерная графика", "останин а.с.", "308"],
      [5, "мдк 01.01", "дубровина т.б.", "319"],
      [6, "компьютерная графика", "останин а.с.", "307"],
    ],
    5: [
      [2, "физическая культура", "гусев н.н.", "101"],
      [3, "мдк 06.01", "ченцов с.а.", "104"],
      [4, "компьютерная графика", "останин а.с.", "307"],
    ],
    6: [
      [1, "иностранный язык", "клушева а.а.", "308а"],
      [2, "физическая культура", "гусев н.н.", "101"],
      [3, "компьютерная графика", "останин а.с.", "307"],
      [4, "мдк 01.01", "дубровина т.б.", "319", { parity: "even" }],
    ],
  },
};

// окна проставляются автоматически: от первой пары до последней занятой
function buildDays(rawDays) {
  return DAY_META.map((meta) => {
    const items = (rawDays[meta.id] || []).slice().sort((a, b) => a[0] - b[0]);
    const sat = meta.id === 6;
    const last = items.length ? items[items.length - 1][0] : 0;
    const slots = [];
    for (let n = 1; n <= last; n += 1) {
      const times = sat ? TIMES[n].sat : TIMES[n].week;
      if (!times) continue;
      const hits = items.filter((it) => it[0] === n);
      if (!hits.length) {
        slots.push({ n, from: times[0], to: times[1], empty: true });
        continue;
      }
      hits.forEach((it) => {
        const extra = it[4] || {};
        slots.push({
          n,
          from: times[0],
          to: times[1],
          subject: it[1],
          teacher: it[2] || undefined,
          room: it[3] || undefined,
          self: extra.self ? true : undefined,
          parity: extra.parity || undefined,
        });
      });
    }
    return { id: meta.id, short: meta.short, name: meta.name, slots };
  });
}

export const GROUPS = Object.keys(RAW).map((id) => ({
  id,
  name: id,
  days: buildDays(RAW[id]),
}));

export const DEFAULT_GROUP = "тм-303/б";

export function groupById(id) {
  return GROUPS.find((g) => g.id === id) || GROUPS[0];
}

export function lessonCount(id) {
  return groupById(id).days.reduce(
    (sum, day) => sum + day.slots.filter((s) => !s.empty).length,
    0
  );
}

/* Расписание с сайта колледжа: data/schedule.json замещает встроенные группы. */
function rawFromRemote(days) {
  const raw = {};
  Object.keys(days || {}).forEach((key) => {
    const dayId = Number(key);
    if (!dayId) return;
    const items = Array.isArray(days[key]) ? days[key] : [];
    const list = [];
    items.forEach((it) => {
      if (!Array.isArray(it) || it.length < 2) return;
      const n = Number(it[0]);
      if (!n || n < 1 || n > 6) return;
      const subject = String(it[1] || "").trim();
      if (!subject) return;
      const extra = it[4] && typeof it[4] === "object" ? it[4] : {};
      list.push([n, subject, it[2] || "", it[3] || "", extra]);
    });
    if (list.length) raw[dayId] = list;
  });
  return raw;
}

function lessonsIn(group) {
  return group.days.reduce((sum, day) => sum + day.slots.filter((s) => !s.empty).length, 0);
}

export function applyRemoteGroups(payload) {
  if (!payload || !Array.isArray(payload.groups) || !payload.groups.length) return 0;
  const builtIn = new Map(GROUPS.map((g) => [g.id, g]));
  const next = [];
  const seen = new Set();
  payload.groups.forEach((item) => {
    if (!item || !item.id) return;
    const id = String(item.id).trim().toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const group = {
      id,
      name: String(item.name || item.id).trim(),
      days: buildDays(rawFromRemote(item.days)),
    };
    const local = builtIn.get(id);
    /* Если разбор PDF для группы пустой, оставляем проверенные данные сборки. */
    next.push(local && !lessonsIn(group) && lessonsIn(local) ? local : group);
  });
  GROUPS.forEach((group) => {
    if (!seen.has(group.id)) next.push(group);
  });
  if (!next.length) return 0;
  next.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  GROUPS.length = 0;
  next.forEach((group) => GROUPS.push(group));
  return GROUPS.length;
}
