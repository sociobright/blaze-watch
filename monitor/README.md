# The eruption alarm

Polls the AAVSO database and emails you the moment T CrB brightens past a threshold.
Pick **one** version.

## Option A — Google Apps Script (recommended, zero infra)

File: `apps-script/Code.gs`

1. Go to [script.google.com](https://script.google.com) → **New project** → paste the file.
2. Set `EMAIL_TO` in `CONFIG` to your address.
3. Run `installTrigger()` once and approve the permission prompt.
   It now checks every hour on Google's servers and emails only when triggered.
4. Run `sendTestEmail()` anytime to confirm delivery — it changes nothing.
5. After a real eruption (or a false alarm), run `resetFlags()` to re-arm.

## Option B — Python + cron

File: `python/tcrb_monitor.py` (standard library only, no `pip install` needed)

Set SMTP env vars (never hard-code secrets):
```
export TCRB_SMTP_USER='you@yourdomain'
export TCRB_SMTP_PASS='********'
export TCRB_EMAIL_FROM='you@yourdomain'
export TCRB_EMAIL_TO='you@example.com'
```
Add to crontab (hourly):
```
0 * * * *  /usr/bin/python3 /path/to/tcrb_monitor.py >> /path/to/tcrb.log 2>&1
```
State lives in `tcrb_state.json` beside the script; delete it to re-arm.

## How the trigger works

Filters AAVSO observations to naked-eye bands (V / Vis. / CV), ignores upper limits,
and fires when the brightest recent reading beats the threshold (default **mag 6**).
Quiescent flicker tops out near mag 9, so false positives are very unlikely. A looser
**pre-alert** (mag 8.5) catches the early rise. Thresholds are at the top of each file.
