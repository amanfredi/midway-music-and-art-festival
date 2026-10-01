const CONFIG = {
  calendarId: 'PASTE_CALENDAR_ID@group.calendar.google.com',
  sheetGid: 1089653622,
  timeZone: 'America/Chicago',
  windowStart: '2026-09-01',
  windowEnd: '2026-11-01',
  maxDeletesPerRun: 10,
  triggerMinutes: 10,
  runBudgetMs: 5 * 60 * 1000,
};

const COLUMNS = {
  key: 'id',
  title: 'Performer/event',
  date: 'date',
  start: 'Start time',
  end: 'end time',
  description: 'description',
  location: 'location',
  url: 'URL',
  ticketUrl: 'Ticket URL',
};

// Each synced event carries its sheet row's id in KEY_TAG. Events without it
// were added by hand and are never updated or deleted.
const KEY_TAG = 'mmafId';
const HASH_TAG = 'mmafHash';

function syncCalendar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    console.log('Previous sync still running; skipping this run.');
    return;
  }
  try {
    runSync_();
  } finally {
    lock.releaseLock();
  }
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncCalendar')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncCalendar').timeBased().everyMinutes(CONFIG.triggerMinutes).create();
  console.log(`syncCalendar will run every ${CONFIG.triggerMinutes} minutes.`);
}

function runSync_() {
  const startedAt = Date.now();
  const calendar = CalendarApp.getCalendarById(CONFIG.calendarId);
  if (!calendar) {
    throw new Error(`Calendar ${CONFIG.calendarId} not found, or this account cannot edit it.`);
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheets()
    .find((s) => s.getSheetId() === CONFIG.sheetGid);
  if (!sheet) throw new Error(`No tab with gid ${CONFIG.sheetGid} in this spreadsheet.`);

  const values = sheet.getDataRange().getDisplayValues();
  const col = columnIndexes_(values[0]);
  const windowStart = localDateTime_(CONFIG.windowStart, 0);
  const windowEnd = localDateTime_(CONFIG.windowEnd, 0);

  const existing = new Map();
  const orphans = [];
  calendar.getEvents(windowStart, windowEnd).forEach((event) => {
    const key = event.getTag(KEY_TAG);
    if (!key) return;
    if (existing.has(key)) orphans.push(event);
    else existing.set(key, event);
  });

  const seen = new Set();
  const problems = [];
  const counts = { created: 0, updated: 0, unchanged: 0, deleted: 0 };
  let finished = true;

  for (let i = 1; i < values.length; i++) {
    if (Date.now() - startedAt > CONFIG.runBudgetMs) {
      problems.push('Ran out of time before the last row; the next run continues.');
      finished = false;
      break;
    }
    const row = values[i];
    const title = row[col.title].trim();
    if (!title) continue;
    const label = `Row ${i + 1} (${title})`;
    const key = row[col.key].trim();
    if (!key) {
      problems.push(`${label}: no id`);
      continue;
    }
    if (seen.has(key)) {
      problems.push(`${label}: id "${key}" is used by an earlier row too`);
      continue;
    }
    seen.add(key);

    try {
      const desired = desiredEvent_(row, col);
      if (desired.start < windowStart || desired.end > windowEnd) {
        throw new Error(`falls outside ${CONFIG.windowStart}..${CONFIG.windowEnd}; check the date`);
      }
      const event = existing.get(key);
      if (!event) {
        const created = calendar.createEvent(desired.title, desired.start, desired.end, {
          description: desired.description,
          location: desired.location,
        });
        created.setTag(KEY_TAG, key);
        created.setTag(HASH_TAG, desired.hash);
        counts.created++;
      } else if (event.getTag(HASH_TAG) === desired.hash) {
        counts.unchanged++;
      } else {
        event.setTitle(desired.title);
        event.setTime(desired.start, desired.end);
        event.setDescription(desired.description);
        event.setLocation(desired.location);
        event.setTag(HASH_TAG, desired.hash);
        counts.updated++;
      }
    } catch (e) {
      problems.push(`${label}: ${e.message}`);
    }
  }

  // Rows after a timeout were never visited, so their events would look
  // orphaned. A blank or broken sheet read would orphan every event, so a
  // large deletion is reported instead of performed.
  if (finished) {
    existing.forEach((event, key) => {
      if (!seen.has(key)) orphans.push(event);
    });
    if (orphans.length > CONFIG.maxDeletesPerRun) {
      problems.push(
        `${orphans.length} calendar events no longer match a sheet row. Not deleting more than ` +
          `${CONFIG.maxDeletesPerRun} in one run; check the sheet, then delete them by hand or raise maxDeletesPerRun.`
      );
    } else {
      orphans.forEach((event) => {
        event.deleteEvent();
        counts.deleted++;
      });
    }
  }

  console.log(JSON.stringify(counts));
  // Throwing after the work is done makes Apps Script email the trigger's owner.
  if (problems.length) throw new Error(`Calendar sync finished with problems:\n${problems.join('\n')}`);
}

function columnIndexes_(header) {
  const trimmed = header.map((h) => h.trim());
  const indexes = {};
  Object.entries(COLUMNS).forEach(([key, name]) => {
    const index = trimmed.indexOf(name);
    if (index === -1) throw new Error(`Column "${name}" is missing from the header row.`);
    indexes[key] = index;
  });
  return indexes;
}

function desiredEvent_(row, col) {
  const date = parseDate_(row[col.date]);
  const startMinutes = parseTime_(row[col.start]);
  const endText = row[col.end].trim();
  let endMinutes = endText ? parseTime_(endText) : startMinutes + 60;
  if (endMinutes === startMinutes) throw new Error('end time equals start time');
  if (endMinutes < startMinutes) endMinutes += 24 * 60;

  const desired = {
    title: row[col.title].trim(),
    start: localDateTime_(date, startMinutes),
    end: localDateTime_(date, endMinutes),
    description: buildDescription_(row[col.description], row[col.url], row[col.ticketUrl]),
    location: row[col.location].trim(),
  };
  desired.hash = hash_([
    desired.title,
    desired.start.toISOString(),
    desired.end.toISOString(),
    desired.description,
    desired.location,
  ]);
  return desired;
}

function buildDescription_(description, url, ticketUrl) {
  const links = [];
  const moreInfo = normalizeUrl_(url);
  const tickets = normalizeUrl_(ticketUrl);
  if (moreInfo) links.push(`More Information: ${moreInfo}`);
  if (tickets) links.push(`Tickets: ${tickets}`);
  return [description.trim(), links.join('\n')].filter(Boolean).join('\n\n');
}

function normalizeUrl_(text) {
  const url = text.trim();
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function parseDate_(text) {
  const value = text.trim();
  let m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let parts;
  if (m) parts = [m[3], m[1], m[2]].map(Number);
  m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) parts = [m[1], m[2], m[3]].map(Number);
  if (!parts) throw new Error(`date "${text}" is not M/D/YYYY`);
  const [y, mo, d] = parts;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`date "${text}" does not exist`);
  }
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseTime_(text) {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/);
  if (!m) throw new Error(`time "${text}" is not like 7:30 PM or 19:30`);
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (m[3]) {
    if (hours < 1 || hours > 12) throw new Error(`time "${text}" has an hour outside 1-12`);
    hours = (hours % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hours > 23) {
    throw new Error(`time "${text}" has an hour outside 0-23`);
  }
  if (minutes > 59) throw new Error(`time "${text}" has minutes outside 0-59`);
  return hours * 60 + minutes;
}

// minutes may exceed a day, which rolls the date forward.
function localDateTime_(isoDate, minutes) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d + Math.floor(minutes / 1440)));
  const minuteOfDay = minutes % 1440;
  const stamp =
    `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(day.getUTCDate()).padStart(2, '0')} ` +
    `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
  return Utilities.parseDate(stamp, CONFIG.timeZone, 'yyyy-MM-dd HH:mm');
}

function hash_(parts) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(parts));
  return Utilities.base64Encode(digest);
}
