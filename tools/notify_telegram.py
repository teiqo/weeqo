#!/usr/bin/env python3
"""
Рассылка уведомлений weeqo в Telegram.

Запускается GitHub Action'ом (.github/workflows/notify-telegram.yml) каждые 15 минут.
Секреты репозитория (Settings -> Secrets and variables -> Actions):
  TELEGRAM_BOT_TOKEN — токен бота от @BotFather (тот же, чей хэш в js/config.js)
  FIREBASE_API_KEY   — Web API Key проекта Firebase

Что делает:
  1) анонимно входит в Firebase (как это делает само приложение);
  2) читает weeqo-tg-subs — кто включил «дублировать в Telegram» в настройках;
  3) смотрит свежие записи в weeqo-swaps и штамп data/schedule.json;
  4) шлёт личные сообщения тем, у кого включены соответствующие категории;
  5) запоминает прогресс в data/notify-state.json (коммитит workflow).

Важно: Telegram не даёт боту писать первым — человек должен один раз
нажать /start у бота, иначе отправка вернёт 403 и подписка будет снята.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_JS = os.path.join(ROOT, "js", "config.js")
STATE_FILE = os.path.join(ROOT, "data", "notify-state.json")
SCHEDULE_FILE = os.path.join(ROOT, "data", "schedule.json")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
API_KEY = os.environ.get("FIREBASE_API_KEY", "").strip()


def log(*args):
    print("[notify]", *args, flush=True)


def read_config():
    """Достаёт SHARED_SWAPS_URL из js/config.js, чтобы не дублировать адрес."""
    try:
        with open(CONFIG_JS, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("var SHARED_SWAPS_URL"):
                    return line.split('"')[1]
    except Exception as e:
        log("не смог прочитать config.js:", e)
    return ""


def http_json(url, payload=None, timeout=30):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fb_anonymous_token(api_key):
    """Тот же анонимный вход, что в js/app.js (accounts:signUp)."""
    ans = http_json(
        "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + api_key,
        {"returnSecureToken": True},
    )
    return ans["idToken"]


def fb_get(root, path, token):
    sep = "&" if "?" in path else "?"
    url = "%s/%s.json%sauth=%s" % (root, path, sep, token)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data if isinstance(data, dict) else {}
    except urllib.error.HTTPError as e:
        log("firebase GET", path, "->", e.code)
        return {}
    except Exception as e:
        log("firebase GET", path, "->", e)
        return {}


def tg_send(chat_id, text):
    url = "https://api.telegram.org/bot%s/sendMessage" % BOT_TOKEN
    try:
        http_json(url, {"chat_id": chat_id, "text": text})
        return True
    except urllib.error.HTTPError as e:
        # 403 — человек не нажимал /start или заблокировал бота
        log("tg ->", chat_id, "HTTP", e.code)
        return e.code != 403
    except Exception as e:
        log("tg ->", chat_id, e)
        return True  # сетевые ошибки не считаем отпиской


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_FILE)


MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def describe_swap(enc_key, entry):
    import urllib.parse
    key = urllib.parse.unquote(enc_key)
    group, _, rest = key.partition("|")
    when = rest
    try:
        d_iso, _, n = rest.partition(":")
        y, m, d = int(d_iso[:4]), int(d_iso[5:7]), int(d_iso[8:10])
        import datetime
        wd = WEEKDAYS[datetime.date(y, m, d).weekday()]
        when = "%s, %d %s · %s пара" % (wd, d, MONTHS[m - 1], n)
    except Exception:
        pass
    if entry.get("deleted"):
        what = "сброс замены"
    elif entry.get("cancelled"):
        what = "отмена пары"
    else:
        what = "замена"
    parts = [p for p in (entry.get("subject"), entry.get("teacher"), entry.get("room")) if p]
    line = "🔔 %s: %s · %s" % (what, group, when)
    if parts:
        line += " — " + " · ".join(str(p) for p in parts)
    if entry.get("byName"):
        line += " (от %s)" % entry["byName"]
    return line


def main():
    if not BOT_TOKEN or not API_KEY:
        log("нет TELEGRAM_BOT_TOKEN или FIREBASE_API_KEY — пропуск (локальный запуск?)")
        return 0

    swaps_url = read_config()
    if not swaps_url:
        log("SHARED_SWAPS_URL пуст — пропуск")
        return 0
    root = swaps_url[: swaps_url.rfind("/")]  # без "/weeqo-swaps"

    token = fb_anonymous_token(API_KEY)
    subs = fb_get(root, "weeqo-tg-subs", token)
    if not subs:
        log("подписчиков нет — выходим")
        save_state(load_state())
        return 0

    swaps = fb_get(root, "weeqo-swaps", token)
    state = load_state()
    seen_swaps = state.get("swaps") or {}
    seen_schedule = state.get("schedule") or ""

    # --- свежие замены (updatedAt вырос с прошлого запуска) ---
    fresh = []
    now_ms = int(time.time() * 1000)
    for enc, entry in swaps.items():
        if not isinstance(entry, dict):
            continue
        t = entry.get("updatedAt") or 0
        if t <= (seen_swaps.get(enc) or 0):
            continue
        seen_swaps[enc] = t
        # первый запуск — только запоминаем, чтобы не заспамить
        if not state.get("swaps"):
            continue
        if now_ms - t > 6 * 3600 * 1000:
            continue  # старое — вдруг базу залили заново
        fresh.append((t, describe_swap(enc, entry)))
    fresh.sort()

    # --- обновление базового расписания ---
    schedule_line = None
    try:
        with open(SCHEDULE_FILE, encoding="utf-8") as f:
            stamp = (json.load(f).get("updatedAt") or "").strip()
        if stamp and stamp != seen_schedule:
            if seen_schedule:  # не спамим при самом первом запуске
                schedule_line = "📅 обновились пары — базовое расписание на сайте свежее"
            seen_schedule = stamp
    except Exception as e:
        log("schedule.json:", e)

    # --- рассылка ---
    dead = []
    sent = 0
    for tg_id, pref in subs.items():
        if not isinstance(pref, dict):
            continue
        ok = True
        if pref.get("swaps", True):
            for _, line in fresh:
                ok = tg_send(tg_id, line) and ok
                sent += 1
        if schedule_line and pref.get("schedule", True):
            ok = tg_send(tg_id, schedule_line) and ok
            sent += 1
        if not ok:
            dead.append(tg_id)

    # подписки с 403 (не нажали /start) убираем, чтобы не дёргать API зря
    for tg_id in dead:
        subs.pop(tg_id, None)
        log("подписка снята (бот не может написать):", tg_id)

    state["swaps"] = seen_swaps
    state["schedule"] = seen_schedule
    save_state(state)
    log("готово: замен %d, расписание %s, сообщений %d" % (len(fresh), "да" if schedule_line else "нет", sent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
