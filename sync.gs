var UNIFIED_CAL_ID     = 'c_0537251faa40b34a31272711a6f62423885368638d451a8b0f5e1fcff75ee37c@group.calendar.google.com';
var GROUP_EMAIL        = 'internal@ewbgreateraustin.org';
var SOURCE_KEY         = 'sourceRef'; // extendedProperties.private key
var BIRTHDAY_SHEET_ID  = '1UAdrItjXXKI5Iv-8pH3Zx1A63_lQvpFdew166J5WlKw';
var BIRTHDAY_TAB_NAME  = 'Birthday';
var BIRTHDAY_NAMES_KEY = 'birthdayNames'; // ScriptProperties key for cleanup tracking

// Entry point — runs daily via trigger (~3am).
function syncCalendars() {
  var members = getGroupMembers();
  members.forEach(function(member) {
    try {
      syncMember(member);
    } catch (e) {
      console.error('Failed syncing ' + member.email + ': ' + e);
    }
  });
  syncBirthdays();
}

function syncMember(member) {
  var props     = PropertiesService.getScriptProperties();
  var tokenKey  = 'syncToken_' + member.email;
  var syncToken = props.getProperty(tokenKey);
  var params    = { singleEvents: true, maxResults: 500 };

  if (syncToken) {
    params.syncToken = syncToken;
  } else {
    // First run: fetch 30 days back through 60 days forward.
    var now = new Date();
    var start = new Date(now); start.setDate(start.getDate() - 30);
    var end   = new Date(now); end.setDate(end.getDate() + 60);
    params.timeMin = start.toISOString();
    params.timeMax = end.toISOString();
    params.orderBy = 'startTime';
  }

  var pageToken;

  do {
    if (pageToken) params.pageToken = pageToken;

    var resp;
    try {
      resp = Calendar.Events.list(member.email, params);
    } catch (e) {
      // Sync token expired — clear it and skip this run; next run will full-sync.
      if (e.message && e.message.indexOf('410') !== -1) {
        props.deleteProperty(tokenKey);
      }
      throw e;
    }

    (resp.items || []).forEach(function(event) {
      if (event.status === 'cancelled') {
        removeCancelledEvent(member.email, event.id);
        return;
      }
      // Skip events this member didn't create — the organizer's sync run handles them.
      if (!event.organizer || event.organizer.self !== true) return;
      upsertEvent(event, member.email);
    });

    pageToken = resp.nextPageToken;

    if (!pageToken && resp.nextSyncToken) {
      props.setProperty(tokenKey, resp.nextSyncToken);
    }
  } while (pageToken);
}

// Insert or update an event in the unified calendar using a deterministic
// ID derived from "userEmail:sourceEventId". This avoids the unreliable
// extendedProperty search and guarantees at-most-one unified event per source.
function upsertEvent(srcEvent, userEmail) {
  var ref     = userEmail + ':' + srcEvent.id;
  var id      = makeEventId(ref);
  var payload = buildPayload(srcEvent, userEmail, ref);
  payload.id  = id;

  if (unifiedEventExists(id)) {
    Calendar.Events.update(payload, UNIFIED_CAL_ID, id);
  } else {
    Calendar.Events.insert(payload, UNIFIED_CAL_ID);
  }
}

function removeCancelledEvent(userEmail, srcEventId) {
  var id = makeEventId(userEmail + ':' + srcEventId);
  try {
    Calendar.Events.remove(UNIFIED_CAL_ID, id);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

function unifiedEventExists(id) {
  try {
    Calendar.Events.get(UNIFIED_CAL_ID, id);
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

function isNotFound(e) {
  var msg = (e && e.message) ? e.message : '';
  return msg.indexOf('404') !== -1 || msg.toLowerCase().indexOf('not found') !== -1;
}

// Calendar event IDs allow base32hex chars (a-v + 0-9); hex is a valid subset.
function makeEventId(ref) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, ref);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

function buildPayload(src, userEmail, ref) {
  var private_ = {};
  private_[SOURCE_KEY] = ref;
  return {
    summary:     src.summary || '(No title)',
    description: '[' + userEmail + ']' + (src.description ? '\n\n' + src.description : ''),
    start:       src.start,
    end:         src.end,
    location:    userEmail === 'operations@ewbgreateraustin.org' ? (src.location || '') : '',
    status:      src.status,
    extendedProperties: { private: private_ }
  };
}

function getGroupMembers() {
  var members   = [];
  var pageToken;
  do {
    var resp = AdminDirectory.Members.list(GROUP_EMAIL, {
      pageToken:  pageToken,
      maxResults: 200
    });
    (resp.members || []).forEach(function(m) { members.push(m); });
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return members;
}

// Wipes all synced events from the unified calendar and clears sync tokens.
// Run this, then run syncCalendars() for a clean full re-sync.
function resetSync() {
  var pageToken;
  var toDelete = [];
  do {
    var resp = Calendar.Events.list(UNIFIED_CAL_ID, {
      maxResults:  500,
      pageToken:   pageToken,
      showDeleted: false
    });
    (resp.items || []).forEach(function(e) {
      var priv = e.extendedProperties && e.extendedProperties.private;
      if (priv && (priv[SOURCE_KEY] || priv['srcICalUID'] || priv['ownerEmail'])) {
        toDelete.push(e.id);
      }
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  toDelete.forEach(function(id) {
    try { Calendar.Events.remove(UNIFIED_CAL_ID, id); } catch (e) {}
  });

  var props = PropertiesService.getScriptProperties();
  props.getKeys().forEach(function(k) {
    if (k.indexOf('syncToken_') === 0) props.deleteProperty(k);
  });

  console.log('Reset complete. Deleted ' + toDelete.length + ' events. Run syncCalendars next.');
}

function syncBirthdays() {
  var sheet = SpreadsheetApp.openById(BIRTHDAY_SHEET_ID).getSheetByName(BIRTHDAY_TAB_NAME);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameCol = headers.indexOf('Concatenated Name');
  var bdayCol = headers.indexOf('Birthday');

  if (nameCol === -1 || bdayCol === -1) {
    console.error('syncBirthdays: required columns not found');
    return;
  }

  var props         = PropertiesService.getScriptProperties();
  var previousNames = JSON.parse(props.getProperty(BIRTHDAY_NAMES_KEY) || '[]');
  var currentNames  = [];

  for (var i = 1; i < data.length; i++) {
    var name    = String(data[i][nameCol]).trim();
    var bdayRaw = String(data[i][bdayCol]).trim();
    if (!name || !bdayRaw) continue;

    var parts = bdayRaw.split('-');
    if (parts.length < 2) continue;
    var month = parseInt(parts[0], 10);
    var day   = parseInt(parts[1], 10);
    if (isNaN(month) || isNaN(day)) continue;

    currentNames.push(name);
    upsertBirthdayEvent(name, month, day);
  }

  // Remove events for people no longer in the sheet.
  previousNames.forEach(function(name) {
    if (currentNames.indexOf(name) === -1) {
      var id = makeEventId('birthday:' + name);
      try {
        Calendar.Events.remove(UNIFIED_CAL_ID, id);
      } catch (e) {
        if (!isNotFound(e)) console.error('Failed removing birthday for ' + name + ': ' + e);
      }
    }
  });

  props.setProperty(BIRTHDAY_NAMES_KEY, JSON.stringify(currentNames));
}

// Only ever creates/updates the single next occurrence rather than a recurring event.
// This way, removing a member from the sheet removes their birthday from the calendar
// on the next sync — no orphaned future recurrences to clean up.
function upsertBirthdayEvent(name, month, day) {
  var id    = makeEventId('birthday:' + name);
  var today = new Date();
  var bday  = new Date(today.getFullYear(), month - 1, day);
  if (bday < today) bday.setFullYear(today.getFullYear() + 1);

  var tz        = Session.getScriptTimeZone();
  var startDate = Utilities.formatDate(bday, tz, 'yyyy-MM-dd');
  var endDay    = new Date(bday); endDay.setDate(endDay.getDate() + 1);
  var endDate   = Utilities.formatDate(endDay, tz, 'yyyy-MM-dd');

  var payload = {
    id:      id,
    summary: '🎂 ' + name + "'s birthday!",
    start:   { date: startDate },
    end:     { date: endDate },
    colorId: '5', // banana (yellow) — matches native birthday calendar
    extendedProperties: { private: { sourceRef: 'birthday:' + name } }
  };

  if (unifiedEventExists(id)) {
    Calendar.Events.update(payload, UNIFIED_CAL_ID, id);
  } else {
    Calendar.Events.insert(payload, UNIFIED_CAL_ID);
  }
}

// Run once manually to install the daily trigger.
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncCalendars') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncCalendars').timeBased().everyDays(1).atHour(3).create();
  console.log('Daily trigger installed (runs ~3am).');
}
