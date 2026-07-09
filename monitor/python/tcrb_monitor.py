#!/usr/bin/env python3
"""
T CrB (Blaze Star) eruption monitor — Python / cron version
-----------------------------------------------------------
Polls the AAVSO International Database and emails you when T Coronae Borealis
brightens past a threshold. Designed to run from cron every 12 hours.

Cron (every 12h, minute 0):
    0 */12 * * *  /usr/bin/python3 /path/to/tcrb_monitor.py >> /path/to/tcrb.log 2>&1

Email is sent via SMTP. Set these environment variables (e.g. in the cron line
or a sourced env file) — never hard-code secrets in this file:
    TCRB_SMTP_HOST   (default: smtp.titan.email)
    TCRB_SMTP_PORT   (default: 465, SSL)
    TCRB_SMTP_USER   your mailbox login
    TCRB_SMTP_PASS   your mailbox password / app password
    TCRB_EMAIL_FROM  from address
    TCRB_EMAIL_TO    where alerts go
"""

import csv, io, json, os, ssl, smtplib, sys, urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage

# ---- CONFIG ----
TRIGGER_MAG  = 6.0          # brighter than this = confirmed eruption
PREALERT_MAG = 8.5          # brighter than this (not yet 6.0) = early heads-up
LOOKBACK_DAYS = 3
BANDS = {"V", "Vis.", "CV"} # naked-eye-equivalent bands only
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tcrb_state.json")


def jd_now():
    return datetime.now(timezone.utc).timestamp() / 86400.0 + 2440587.5

def jd_to_utc(jd):
    ts = (jd - 2440587.5) * 86400.0
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {"alerted": False, "prealerted": False}

def save_state(s):
    with open(STATE_FILE, "w") as f:
        json.dump(s, f)

def send_mail(subject, body):
    host = os.environ.get("TCRB_SMTP_HOST", "smtp.titan.email")
    port = int(os.environ.get("TCRB_SMTP_PORT", "465"))
    user = os.environ["TCRB_SMTP_USER"]
    pw   = os.environ["TCRB_SMTP_PASS"]
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("TCRB_EMAIL_FROM", user)
    msg["To"] = os.environ["TCRB_EMAIL_TO"]
    msg.set_content(body)
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=ctx) as s:
        s.login(user, pw)
        s.send_message(msg)

def fetch_observations():
    now = jd_now()
    start = now - LOOKBACK_DAYS
    url = ("https://www.aavso.org/vsx/index.php?view=api.delim&ident=T+CrB"
           f"&fromjd={start:.5f}&tojd={now:.5f}&delimiter=,")
    req = urllib.request.Request(url, headers={"User-Agent": "tcrb-monitor/1.0"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    return list(csv.DictReader(io.StringIO(raw)))

def main():
    try:
        rows = fetch_observations()
    except Exception as e:
        print(f"[{datetime.now(timezone.utc)}] fetch error: {e!r}", file=sys.stderr)
        return

    brightest, count_bright = None, 0
    for r in rows:
        try:
            if str(r.get("fainterThan", "0")).strip() == "1":
                continue
            if (r.get("band") or "").strip() not in BANDS:
                continue
            mag = float(r["mag"]); jd = float(r["JD"])
        except Exception:
            continue
        if mag < TRIGGER_MAG:
            count_bright += 1
        if brightest is None or mag < brightest[0]:
            brightest = (mag, jd, (r.get("band") or "").strip(), (r.get("obsName") or "").strip())

    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    if not brightest:
        print(f"[{stamp}] no usable V/Vis observations in window")
        return

    mag, jd, band, obs = brightest
    utc = jd_to_utc(jd)
    print(f"[{stamp}] brightest {'/'.join(sorted(BANDS))} (last {LOOKBACK_DAYS}d): "
          f"mag {mag} ({band}) at {utc}")

    state = load_state()

    if mag < TRIGGER_MAG:
        if not state.get("alerted"):
            send_mail(
                "T CrB HAS ERUPTED — Blaze Star is naked-eye now",
                f"The Blaze Star (T Coronae Borealis) has gone nova.\n\n"
                f"Brightest reading: magnitude {mag} ({band})\n"
                f"Observed: {utc}" + (f" by {obs}" if obs else "") + "\n"
                f"Corroborating bright obs in window: {count_bright}\n\n"
                f"GO LOOK NOW. From Cyprus at ~10pm it is nearly overhead — face south, look up,\n"
                f"in Corona Borealis next to Alphecca. Naked-eye window is only a few days.\n\n"
                f"Light curve: https://apps.aavso.org/webobs/results/?star=T+CrB\n"
            )
            state.update(alerted=True, prealerted=True)
            save_state(state)
            print(f"[{stamp}] ERUPTION alert sent")
    elif mag < PREALERT_MAG:
        if not state.get("prealerted") and not state.get("alerted"):
            send_mail(
                f"T CrB brightening — possible early rise (mag {mag})",
                f"T CrB is brighter than its normal quiescent range.\n\n"
                f"Brightest reading: magnitude {mag} ({band})\n"
                f"Observed: {utc}\n\n"
                f"May be the start of the rise, or normal flicker. Verify:\n"
                f"https://apps.aavso.org/webobs/results/?star=T+CrB\n"
            )
            state["prealerted"] = True
            save_state(state)
            print(f"[{stamp}] pre-alert sent")

if __name__ == "__main__":
    main()
