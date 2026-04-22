var UNIFIED_CAL_ID = 'c_0537251faa40b34a31272711a6f62423885368638d451a8b0f5e1fcff75ee37c@group.calendar.google.com';
var GROUP_EMAIL    = 'internal@ewbgreateraustin.org';
var SOURCE_KEY     = 'sourceRef'; // extendedProperties.private key

// Entry point — runs hourly via trigger.
function syncCalendars() {
  var members = getGroupMembers();
  members.forEach(function(member) {
    try {
      syncMember(member);
    } catch (e) {
      console.error('Failed syncing ' + member.email + ': ' + e);
    }
  });
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
    location:    '',
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
