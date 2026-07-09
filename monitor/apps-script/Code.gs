/**
 * T CrB (Blaze Star) eruption monitor — Google Apps Script version
 * ------------------------------------------------------------------
 * Polls the AAVSO International Database for recent T Coronae Borealis
 * observations and emails you the moment it brightens past a threshold.
 * Runs on Google's servers on a time trigger — nothing to keep open.
 *
 * SETUP (5 min):
 *  1. script.google.com  ->  New project  ->  paste this file.
 *  2. Edit CONFIG below (at minimum, EMAIL_TO).
 *  3. Run installTrigger() once. Approve the permission prompt
 *     (it needs "send email as you" + "connect to external service").
 *  4. Done. It now checks every 12h and stays silent unless something happens.
 *     Use checkTCrB() to run a manual test; resetFlags() after a false alarm
 *     or after the event to re-arm.
 */

var CONFIG = {
  EMAIL_TO:     'you@example.com',   // <-- where alerts go
  TRIGGER_MAG:  6.0,   // brighter (smaller) than this = confirmed eruption alert
  PREALERT_MAG: 8.5,   // brighter than this (but not yet 6.0) = early "heads up"
                       // quiescent flicker tops out ~9.2, so 8.5 is already unusual
  LOOKBACK_DAYS: 3,    // how far back to pull observations each run
  BANDS: ['V', 'Vis.', 'CV']  // naked-eye-equivalent bands only (I/R/B sit brighter at rest)
};

function checkTCrB() {
  var jdNow   = Date.now() / 86400000 + 2440587.5;
  var jdStart = jdNow - CONFIG.LOOKBACK_DAYS;
  var url = 'https://www.aavso.org/vsx/index.php?view=api.delim&ident=T+CrB'
          + '&fromjd=' + jdStart.toFixed(5) + '&tojd=' + jdNow.toFixed(5) + '&delimiter=,';

  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true,
                                      headers: { 'User-Agent': 'tcrb-monitor/1.0' } });
  if (resp.getResponseCode() !== 200) {
    Logger.log('AAVSO fetch failed: HTTP ' + resp.getResponseCode());
    return;
  }

  var rows = Utilities.parseCsv(resp.getContentText());
  if (!rows || rows.length < 2) { Logger.log('No rows returned.'); return; }

  var h = rows[0];
  var iJD = h.indexOf('JD'), iMag = h.indexOf('mag'),
      iBand = h.indexOf('band'), iFT = h.indexOf('fainterThan'),
      iObs = h.indexOf('obsName');

  var brightest = null, countBright = 0;
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (row.length <= iFT) continue;
    if (String(row[iFT]).trim() === '1') continue;                 // skip upper limits
    if (CONFIG.BANDS.indexOf(String(row[iBand]).trim()) === -1) continue;
    var mag = parseFloat(row[iMag]);
    if (isNaN(mag)) continue;
    var jd = parseFloat(row[iJD]);
    if (mag < CONFIG.TRIGGER_MAG) countBright++;
    if (brightest === null || mag < brightest.mag) {
      brightest = { mag: mag, jd: jd, band: String(row[iBand]).trim(),
                    obs: (iObs > -1 ? String(row[iObs]).trim() : '') };
    }
  }

  if (!brightest) { Logger.log('No usable V/Vis observations in window.'); return; }

  var utc = new Date((brightest.jd - 2440587.5) * 86400000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  Logger.log('Brightest ' + CONFIG.BANDS.join('/') + ' in last ' + CONFIG.LOOKBACK_DAYS
             + 'd: mag ' + brightest.mag + ' (' + brightest.band + ') at ' + utc);

  var props = PropertiesService.getScriptProperties();

  if (brightest.mag < CONFIG.TRIGGER_MAG) {
    if (props.getProperty('alerted') !== '1') {
      sendMail('🌟 T CrB HAS ERUPTED — Blaze Star is naked-eye now',
        'The Blaze Star (T Coronae Borealis) has gone nova.\n\n'
        + 'Brightest reading: magnitude ' + brightest.mag + ' (' + brightest.band + ')\n'
        + 'Observed: ' + utc + (brightest.obs ? ' by ' + brightest.obs : '') + '\n'
        + 'Corroborating bright obs in window: ' + countBright + '\n\n'
        + 'GO LOOK NOW. It is in Corona Borealis, right next to Alphecca (the Northern Crown).\n'
        + 'Naked-eye window is only a few days.\n\n'
        + 'Light curve: https://apps.aavso.org/webobs/results/?star=T+CrB\n'
        + 'AAVSO alerts: https://www.aavso.org/observation-notification\n');
      props.setProperties({ alerted: '1', prealerted: '1' });
    }
  } else if (brightest.mag < CONFIG.PREALERT_MAG) {
    if (props.getProperty('prealerted') !== '1' && props.getProperty('alerted') !== '1') {
      sendMail('⚠️ T CrB brightening — possible early rise (mag ' + brightest.mag + ')',
        'T CrB is brighter than its normal quiescent range.\n\n'
        + 'Brightest reading: magnitude ' + brightest.mag + ' (' + brightest.band + ')\n'
        + 'Observed: ' + utc + '\n\n'
        + 'This may be the start of the rise, or normal flicker. Watch closely / verify:\n'
        + 'https://apps.aavso.org/webobs/results/?star=T+CrB\n');
      props.setProperty('prealerted', '1');
    }
  }
}

function sendMail(subject, body) {
  MailApp.sendEmail({ to: CONFIG.EMAIL_TO, subject: subject, body: body });
}

/** Run ONCE to install the recurring 12-hour check. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkTCrB') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkTCrB').timeBased().everyHours(12).create();
  Logger.log('Installed: checkTCrB runs every 12 hours.');
}

/** Clear alert flags — use after a false alarm or after the event to re-arm. */
function resetFlags() {
  PropertiesService.getScriptProperties().deleteProperty('alerted');
  PropertiesService.getScriptProperties().deleteProperty('prealerted');
  Logger.log('Flags reset.');
}
