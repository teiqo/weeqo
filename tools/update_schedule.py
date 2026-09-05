# -*- coding: utf-8 -*-
"""Пересборка data/schedule.json из PDF с сайта колледжа.

Запуск: python3 tools/update_schedule.py
Требует pdftotext (пакет poppler-utils).
Скрипт ничего не перезапишет, если разбор вышел подозрительно бедным:
тогда он выйдет с кодом 1 и старый JSON останется на месте.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

PDF_URL = (
    "https://sustec.ru/wp-content/uploads/2018/09/"
    "mso-26-27_raspisanie_1_semestr_2026g_2027g.pdf"
)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "schedule.json")

GROUP_RE = re.compile(r"[А-ЯЁ]{2}-\d{3}/[а-яё]")
BELL_RE = re.compile(r"^\s*([1-6])\s*$")
ROOM_RE = re.compile(r"\dк\s*-\s*(\d{1,3}[а-я]?)")
TEACHER_RE = re.compile(r"([А-ЯЁ][а-яё]+)\s+([А-ЯЁ])\.\s*([А-ЯЁ])\.")
EVEN_RE = re.compile(r"Четная\s+неделя", re.I)
ODD_RE = re.compile(r"Нечетная\s+неделя", re.I)
SELF_RE = re.compile(r"\(\s*самостоятельная\s+работа\s*\)", re.I)
NOISE = (
    "Подгруппа 1",
    "Подгруппа 2",
    "(лекция)",
    "Четная неделя:",
    "Нечетная неделя:",
    "Четная неделя",
    "Нечетная неделя",
)


def fetch_pdf(path):
    req = urllib.request.Request(PDF_URL, headers={"User-Agent": "Mozilla/5.0 (schedule-bot)"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) < 20000 or not data.startswith(b"%PDF"):
        raise RuntimeError("не похоже на PDF, байт: %d" % len(data))
    with open(path, "wb") as fh:
        fh.write(data)


def pdf_text(path):
    txt = path + ".txt"
    subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, txt], check=True)
    with open(txt, encoding="utf-8") as fh:
        return fh.read()


def clean_cell(text):
    """Из куска текста ячейки делает список занятий (обычно одно, два при чет/нечет)."""
    body = " ".join(text.split())
    if not body or set(body) <= set("- —–"):
        return []
    parts = []
    if EVEN_RE.search(body) and ODD_RE.search(body):
        odd_at = ODD_RE.search(body).start()
        parts.append(("even", body[:odd_at]))
        parts.append(("odd", body[odd_at:]))
    elif EVEN_RE.search(body):
        parts.append(("even", body))
    elif ODD_RE.search(body):
        parts.append(("odd", body))
    else:
        parts.append((None, body))

    out = []
    for parity, chunk in parts:
        piece = chunk
        extra = {}
        if parity:
            extra["parity"] = parity
        if SELF_RE.search(piece):
            extra["self"] = True
            piece = SELF_RE.sub(" ", piece)
        room = ""
        m = ROOM_RE.search(piece)
        if m:
            room = m.group(1)
        piece = ROOM_RE.sub(" ", piece)
        teacher = ""
        t = TEACHER_RE.search(piece)
        if t:
            teacher = "%s %s.%s." % (t.group(1).lower(), t.group(2).lower(), t.group(3).lower())
            piece = TEACHER_RE.sub(" ", piece)
        elif "вакансия" in piece.lower():
            teacher = "вакансия"
        for junk in NOISE:
            piece = piece.replace(junk, " ")
        piece = re.sub(r"\(\s*вакансия\s*\)|вакансия", " ", piece, flags=re.I)
        piece = re.sub(r"[-—–]{2,}", " ", piece)
        piece = re.sub(r"\s*,\s*$", " ", piece)
        subject = " ".join(piece.split()).strip(" ,.;-").lower()
        if len(subject) < 3:
            continue
        if len(subject) > 120:
            subject = subject[:120].rstrip() + "…"
        out.append((subject, teacher, room, extra))
    return out


def parse_page(page):
    """Одна страница -> {group_code: {day_id: [[n, subject, teacher, room, extra], ...]}}"""
    lines = page.split("\n")
    header_idx = None
    columns = []
    for idx, line in enumerate(lines):
        found = list(GROUP_RE.finditer(line))
        if len(found) >= 2:
            header_idx = idx
            columns = [(m.group(0), m.start()) for m in found]
            break
    if header_idx is None:
        return {}

    bounds = []
    for i, (code, start) in enumerate(columns):
        left = max(0, start - 4)
        right = columns[i + 1][1] - 4 if i + 1 < len(columns) else 10 ** 6
        bounds.append((code, left, right))
    bell_edge = bounds[0][1]

    result = {code: {} for code, _, _ in bounds}
    day_id = 0
    prev_bell = 99
    current = None  # (bell, {code: [text]})

    def flush():
        if not current:
            return
        bell, buckets = current
        for code, chunks in buckets.items():
            for subject, teacher, room, extra in clean_cell(" ".join(chunks)):
                result[code].setdefault(day_id, []).append([bell, subject, teacher, room, extra])

    for line in lines[header_idx + 1:]:
        head = line[:bell_edge]
        bell_hit = BELL_RE.match(head.strip()) if head.strip() else None
        if bell_hit:
            flush()
            bell = int(bell_hit.group(1))
            if bell <= prev_bell:
                day_id += 1
            prev_bell = bell
            if day_id > 6:
                break
            current = (bell, {code: [] for code, _, _ in bounds})
        if current:
            bell, buckets = current
            for code, left, right in bounds:
                buckets[code].append(line[left:right])
    flush()
    return result


def main():
    tmp = tempfile.mkdtemp(prefix="sched-")
    pdf = os.path.join(tmp, "schedule.pdf")
    fetch_pdf(pdf)
    text = pdf_text(pdf)

    merged = {}
    for page in text.split("\f"):
        for code, days in parse_page(page).items():
            slot = merged.setdefault(code, {})
            for day_id, items in days.items():
                slot.setdefault(day_id, [])
                for item in items:
                    if item not in slot[day_id]:
                        slot[day_id].append(item)

    groups = []
    total = 0
    for code in sorted(merged, key=lambda c: c.lower()):
        days = {}
        for day_id in sorted(merged[code]):
            if not 1 <= day_id <= 6:
                continue
            items = sorted(merged[code][day_id], key=lambda it: it[0])
            if items:
                days[str(day_id)] = items
                total += len(items)
        groups.append({"id": code.lower(), "name": code, "days": days})

    if len(groups) < 5 or total < 30:
        print("разбор слишком бедный: групп %d, занятий %d" % (len(groups), total), file=sys.stderr)
        return 1

    payload = {
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "source": PDF_URL,
        "groups": groups,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
    print("готово: групп %d, занятий %d" % (len(groups), total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
