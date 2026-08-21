// ** CONSTANTS ** //


// Sync Events
var UNIFIED_CAL_ID     = 'c_0537251faa40b34a31272711a6f62423885368638d451a8b0f5e1fcff75ee37c@group.calendar.google.com';
var GROUP_EMAIL        = 'internal@ewbgreateraustin.org';
// Sync Birthdays
var BIRTHDAY_SHEET_ID  = '1UAdrItjXXKI5Iv-8pH3Zx1A63_lQvpFdew166J5WlKw';
var BIRTHDAY_TAB_NAME  = 'Master List';


// ** MAIN SCRIPT LOGIC ** //


// Entry point — runs daily via trigger (~3am).
function sync() {
  var members = getGroupMembers(); // Get all EWBGA members in our Google Workspace
  members.forEach(function(member) {
    try {
      syncMember(member);
    } catch (e) {
      console.error('Failed syncing events for ' + member.email + ': ' + e);
    }
  });
   try {
      syncBirthdays();
   } catch (e) {
      console.error('Failed syncing birthdays: ' + e)
   }
  
}

function syncMember(member) {
  
  // Form params for Events query
  // Fetch 30 days back through 60 days forward.
  // Cancelled events will come back in responses, but once we've passed the time window, they will no longer appear
  var params    = { singleEvents: true, maxResults: 500 }; // Leave maxResults high in case many events are created in the window and deleted for whatever reason (we want to catch and delete all of them)
  var now = new Date();
  var start = new Date(now); start.setDate(start.getDate() - 30);
  var end   = new Date(now); end.setDate(end.getDate() + 60);
  params.timeMin = start.toISOString();
  params.timeMax = end.toISOString();
  params.orderBy = 'startTime';
  params.showDeleted = true;

  var pageToken;

  do {
    if (pageToken) params.pageToken = pageToken; // Continue fetching events while pageToken comes back (pointer to the next page for more events)
    var resp;
    try {
      resp = Calendar.Events.list(member.email, params);
    } catch (e) {
      throw e;
    }

    (resp.items || [])
      // Since multiple internal members can be invited to the same event, filter for events for which the member is the organizer
      // That way, the event only appears once on the calendar
      .filter(event => event.organizer.self)
      .forEach(function(event) {
      console.log(`${event.start.dateTime} - ${event.organizer.email} - ${event.summary} - ${event.status}`)
      if (event.status === 'cancelled') {
        removeCancelledEvent(member.email, event.id);
        return;
      }
      upsertEvent(event, member.email);
    });

    pageToken = resp.nextPageToken;

  } while (pageToken);
}

function syncBirthdays() {
  var sheet = SpreadsheetApp.openById(BIRTHDAY_SHEET_ID).getSheetByName(BIRTHDAY_TAB_NAME);
  if (!sheet) {
    console.error('syncBirthdays: tab "' + BIRTHDAY_TAB_NAME + '" not found in spreadsheet');
    return;
  }
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameCol = headers.indexOf('Concatenated Name');
  var bdayCol = headers.indexOf('Birthday');

  if (nameCol === -1 || bdayCol === -1) {
    console.error('syncBirthdays: required columns not found');
    return;
  }

  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var name    = String(data[i][nameCol]).trim();
    var bdayVal = data[i][bdayCol];
    if (!name || bdayVal === '' || bdayVal == null) continue;

    // Sheets returns a Date object for date-formatted cells, a string otherwise.
    var month, day;
    if (bdayVal instanceof Date) {
      month = bdayVal.getMonth() + 1;
      day   = bdayVal.getDate();
    } else {
      var parts = String(bdayVal).trim().split('-');
      if (parts.length < 2) continue;
      month = parseInt(parts[0], 10);
      day   = parseInt(parts[1], 10);
    }
    if (isNaN(month) || isNaN(day)) continue;

    count++;
    console.log(`Birthday found for ${name} as ${month}-${day}`)
    insertBirthdayEvent(name, month, day);
  }

  console.log('syncBirthdays: processed ' + count + ' birthdays');
}


// ** UTILITY FUNCTIONS (EVENTS) ** //


function getGroupMembers() {
  var members   = [];
  var pageToken;
  // GROUP_EMAIL is a Google Group containing all members internal to the EWBGA Google Workspace
  // i.e. fundraising@, finance@, president@, etc.
  var resp = AdminDirectory.Members.list(GROUP_EMAIL, {
    pageToken:  pageToken,
    maxResults: 200
  });
  (resp.members || []).forEach(function(m) { members.push(m); });
  return members;
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
    // Remove events from the unified calendar
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
  return msg.indexOf('404') !== -1 || msg.indexOf('410') !== -1 ||
         msg.toLowerCase().indexOf('not found') !== -1 ||
         msg.toLowerCase().indexOf('resource has been deleted') !== -1;
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
  private_['sourceRef'] = ref;
  if (src.recurringEventId) {
    private_['parentRef'] = userEmail + ':' + src.recurringEventId;
  }
  return {
    summary:     src.summary || '(No title)',
    description: '[' + userEmail + ']', // Will not take src.description because it could contain sensitive info (i.e. Zoom meeting link can appear in it)
    start:       src.start,
    end:         src.end,
    location:    userEmail === 'operations@ewbgreateraustin.org' ? (src.location || '') : '', // Only include locations for public events, which are usually created by the Operations team
    status:      src.status,
    extendedProperties: { private: private_ }
  };
}


// ** UTILITY FUNCTIONS (BIRTHDAYS) ** //


// Each year's occurrence gets a unique year-specific ID so past birthdays are retained
// permanently on the calendar as a historical record.
function insertBirthdayEvent(name, month, day) {
  var today = new Date();
  var bday  = new Date(today.getFullYear(), month - 1, day);
  if (bday < today) bday.setFullYear(today.getFullYear() + 1);

  var ref   = 'birthday:' + name + ':' + bday.getFullYear();
  var id    = makeEventId(ref);

  var tz        = Session.getScriptTimeZone();
  var startDate = Utilities.formatDate(bday, tz, 'yyyy-MM-dd');
  var endDay    = new Date(bday); endDay.setDate(endDay.getDate() + 1);
  var endDate   = Utilities.formatDate(endDay, tz, 'yyyy-MM-dd');

  var payload = {
    id:      id,
    summary: '🎂 ' + name + "'s birthday!",
    start:   { date: startDate },
    end:     { date: endDate },
    extendedProperties: { private: { sourceRef: ref } }
  };

  if (unifiedEventExists(id)) {
    Calendar.Events.update(payload, UNIFIED_CAL_ID, id);
  } else {
    Calendar.Events.insert(payload, UNIFIED_CAL_ID);
  }
}


// ** DEBUG FUNCTIONS ** //


// Run once manually to install the daily trigger.
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sync') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sync').timeBased().everyDays(1).atHour(3).create();
  console.log('Daily trigger installed (runs ~3am).');
}

// Wipes all synced events from the unified calendar and clears sync tokens.
// Run this, then run sync() for a clean full re-sync.
function reset() {
  var pageToken;
  var toDelete = [];
  do {
    var resp = Calendar.Events.list(UNIFIED_CAL_ID, {
      pageToken:   pageToken,
      showDeleted: false // Can leave this as false, doesn't matter here if they were already deleted from the calendar
    });
    (resp.items || []).forEach(function(e) {
      var priv = e.extendedProperties && e.extendedProperties.private;
      if (priv && (priv['sourceRef'] || priv['srcICalUID'] || priv['ownerEmail'])) {
        toDelete.push(e.id);
      }
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  toDelete.forEach(function(id) {
    try { 
      Calendar.Events.remove(UNIFIED_CAL_ID, id); 
    } catch (e) {
      console.error('Failed calendar reset: ' + e)
    }
  });

  console.log('Reset complete. Deleted ' + toDelete.length + ' events. Run sync next.');
}
