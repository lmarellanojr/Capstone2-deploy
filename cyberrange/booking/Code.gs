/**
 * MMDC Cyber Range test booking — Google Apps Script backend.
 *
 * Paste into Extensions → Apps Script of a Google Sheet, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * The "Bookings" tab is created on the first request.
 *
 * To cancel a booking by hand, change its Status cell to "cancelled".
 */

const SHEET_NAME = 'Bookings';

// Who gets an email for every booking and cancellation. Separate several
// addresses with commas. Leave empty to send to the Google account that
// owns this script.
// Link to the booking page, included in the tester's confirmation email.
// Leave empty to leave the link out.
const BOOKING_PAGE_URL = 'https://book.cyberlaboratory.online';

const NOTIFY_EMAIL = 'lr.sjflorentino@mmdc.mcl.edu.ph, lr.ljmendoza@mmdc.mcl.edu.ph, lr.larellano@mmdc.mcl.edu.ph, lr.mpunzalan@mmdc.mcl.edu.ph';

// Must match DOMAINS in index.html (same ids).
const DOMAINS = {
  d1: 'https://cyberrange.bubble-express.win/login',
  d2: 'https://cyberrange.hanzi-super.pw/login?callbackUrl=%2Fscenario%2F01',
  d3: 'https://cyberrange.cyberlaboratory.online/login',
  d4: 'https://cyberrange.cyberonline.space/login?callbackUrl=%2Fdashboard',
};

const HEADERS = ['Booked at', 'Domain', 'Range URL', 'Slot', 'Date', 'Start', 'End',
  'Name', 'Email', 'Student/Employee ID', 'Section', 'Notes', 'Status', 'Cancel code', 'Legacy account setup status', 'Organizer notice sent', 'Legacy account notice status'];

// Only these addresses may book.
const ALLOWED_EMAIL_DOMAIN = '@mmdc.mcl.edu.ph';

// Slot ids look like 2026-10-19_0900-1100
const SLOT_RE = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})-(\d{2})(\d{2})$/;

function doGet() {
  const bookings = rows_().filter(b => b.status === 'booked').map(b => ({
    domainId: b.domainId,
    slotId: b.slotId,
    name: shortName_(b.name),
    section: b.section,
  }));
  return json_({ ok: true, bookings });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }
  let result;
  try {
    if (body.action === 'book') result = book_(body);
    else if (body.action === 'cancel') result = cancel_(body);
    else result = { ok: false, error: 'bad_request' };
  } finally {
    lock.releaseLock();
  }
  // Email after releasing the lock so a slow send doesn't hold up other bookings.
  const notice = result._notice;
  delete result._notice;
  if (notice) {
    try {
      lock.waitLock(10000);
      if (notify_(notice) && notice.kind === 'New booking') {
        setOrganizerNoticeSent_(notice.row, true);
      }
    } catch (err) {
      console.error('Booking notification deferred: ' + err);
    } finally {
      try { lock.releaseLock(); } catch (err) {}
    }
  }
  if (notice && notice.kind === 'New booking') confirm_(notice.row, result.token);
  return json_(result);
}

// Each time slot has one spot per domain. domainId "auto" takes the first open one.
function book_(b) {
  let domainId = String(b.domainId || '');
  const slotId = String(b.slotId || '');
  const m = slotId.match(SLOT_RE);
  if ((domainId !== 'auto' && !DOMAINS[domainId]) || !m) return { ok: false, error: 'bad_request' };

  const name = clean_(b.name, 80);
  const email = clean_(b.email, 120).toLowerCase();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'missing_fields' };
  if (ALLOWED_EMAIL_DOMAIN && !email.endsWith(ALLOWED_EMAIL_DOMAIN)) return { ok: false, error: 'email_domain' };

  const active = rows_().filter(r => r.status === 'booked');
  if (active.filter(r => r.email.toLowerCase() === email).length >= 4) return { ok: false, error: 'booking_limit' };
  const taken = d => active.some(r => r.domainId === d && r.slotId === slotId);
  const hasDomain = d => active.some(r => r.domainId === d && r.email.toLowerCase() === email);
  if (active.some(r => r.slotId === slotId && r.email.toLowerCase() === email)) return { ok: false, error: 'duplicate_time' };

  if (domainId === 'auto') {
    const ids = Object.keys(DOMAINS);
    const pick = ids.find(d => !taken(d) && !hasDomain(d));
    if (!pick) return { ok: false, error: ids.every(taken) ? 'full' : 'duplicate' };
    domainId = pick;
  } else {
    if (taken(domainId)) return { ok: false, error: 'taken' };
    if (hasDomain(domainId)) return { ok: false, error: 'duplicate' };
  }

  const token = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  const row = {
    domainId, url: DOMAINS[domainId], slotId, date: m[1], start: m[2] + ':' + m[3], end: m[4] + ':' + m[5],
    name, email, sid: clean_(b.sid, 40), section: clean_(b.section, 60), notes: clean_(b.notes, 400),
  };
  sheet_().appendRow([
    new Date().toISOString(), row.domainId, row.url, row.slotId, row.date, row.start, row.end,
    row.name, row.email, row.sid, row.section, row.notes, 'booked', token, '', '', '',
  ]);
  row.sheetRow = sheet_().getLastRow();
  row.token = token;
  return { ok: true, token, domainId, _notice: { kind: 'New booking', row } };
}

function cancel_(b) {
  const token = String(b.token || '').trim().toUpperCase();
  const hit = rows_().find(r => r.status === 'booked' && r.domainId === b.domainId &&
    r.slotId === b.slotId && r.token.toUpperCase() === token);
  if (!token || !hit) return { ok: false, error: 'not_found' };
  sheet_().getRange(hit.row, HEADERS.indexOf('Status') + 1).setValue('cancelled');
  return { ok: true, _notice: { kind: 'Cancelled', row: hit } };
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@'); // keep dates/times as text
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  } else if (sh.getMaxColumns() < HEADERS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  }
  const currentHeaders = sh.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (JSON.stringify(currentHeaders) !== JSON.stringify(HEADERS)) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  }
  return sh;
}

function rows_() {
  const sh = sheet_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, HEADERS.length).getDisplayValues().map((r, i) => ({
    row: i + 2, bookedAt: r[0], domainId: r[1], url: r[2], slotId: r[3], date: r[4], start: r[5], end: r[6],
    name: r[7], email: r[8], sid: r[9], section: r[10], notes: r[11],
    status: String(r[12]).trim().toLowerCase(), token: r[13],
    organizerNoticeSent: String(r[15] || '').trim().toLowerCase() === 'yes',
  }));
}

function setOrganizerNoticeSent_(r, sent) {
  const row = r.sheetRow || r.row;
  if (row) sheet_().getRange(row, HEADERS.indexOf('Organizer notice sent') + 1).setValue(sent ? 'yes' : '');
}

// Run once after deploying an older version that installed the account
// reconciliation trigger. Replace it with an email-only retry for organizer
// notices that could not be delivered during the original booking request.
function installOrganizerNoticeRetry() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['reconcilePendingProvisioning', 'retryPendingOrganizerNotices'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('retryPendingOrganizerNotices').timeBased().everyMinutes(5).create();
}

// Re-send only unsent organizer notices; never provisions accounts or repeats
// tester confirmations. The script lock prevents a retry racing a live booking.
function retryPendingOrganizerNotices() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    rows_().filter(r => r.status === 'booked' && !r.organizerNoticeSent).forEach(r => {
      if (notify_({ kind: 'New booking', row: r })) setOrganizerNoticeSent_(r, true);
    });
  } catch (err) {
    console.error('Organizer notice retry deferred: ' + err);
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

// Emails the organizers. A failed email never fails the booking itself.
function notify_(n) {
  const r = n.row;
  const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return false;
  const booked = n.kind === 'New booking';
  const host = host_(r.url);
  const domain = domainLabel_(r.domainId) + ' · ' + host;
  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const rows = [
    ['Tester', r.email],
    ['Session', when_(r)],
    ['Assigned domain', domain],
    ['Login URL', r.url],
    ['Account setup', booked
      ? 'Domain owner will create the student account and trigger a separate credential email.'
      : 'Reservation cancelled; no account setup is needed.'],
    ['Cancellation code', r.token || '-'],
    ['Notes', r.notes || '-'],
  ];
  const next = booked
    ? organizerAction_(r)
    : 'This seat on ' + domainLabel_(r.domainId) + ' is open again. No action is needed.';

  const text = [
    (booked ? 'NEW BOOKING' : 'BOOKING CANCELLED'),
    '',
    rows.map(x => pad_(x[0] + ':', 19) + x[1]).join('\n'),
    '',
    (booked ? 'Action required: ' : '') + next,
    '',
    'Booking sheet: ' + sheetUrl,
  ].join('\n');

  const html = layout_({
    badge: booked ? ['New booking', '#1a7f37', '#dafbe1'] : ['Cancelled', '#cf222e', '#ffebe9'],
    title: booked ? 'New session booked' : 'Session cancelled',
    intro: booked
      ? esc_(r.email) + ' reserved a seat on the cyber range.'
      : esc_(r.email) + ' cancelled their reservation.',
    rows,
    callout: booked ? ['Action required', next] : ['Seat released', next],
    button: ['Open booking sheet', sheetUrl],
    footer: 'Sent automatically by the MMDC Cyber Range booking system. Reply to this email to contact the tester.',
  });

  try {
    MailApp.sendEmail({
      to,
      subject: (booked ? 'New booking: ' : 'Cancelled: ') + r.email + ' · ' + whenShort_(r) + ' · ' + domainLabel_(r.domainId),
      body: text,
      htmlBody: html,
      name: 'MMDC Cyber Range Booking',
      replyTo: r.email,
    });
    return true;
  } catch (err) {
    console.error('Notification email failed: ' + err);
    return false;
  }
}

// Confirmation to the tester. The domain owner creates the account after booking.
function confirm_(r, token) {
  const rows = [
    ['Date', dateLong_(r)],
    ['Time', timeRange_(r) + ' (Philippine Time)'],
    ['Assigned domain', r.url],
    ['Cancellation code', token],
    ['Booked with', r.email],
  ];
  const cancelText = BOOKING_PAGE_URL
    ? 'To cancel, open ' + BOOKING_PAGE_URL + ' in the same browser you booked with, or reply to this email with your cancellation code.'
    : 'To cancel, reply to this email with your cancellation code.';

  const text = [
    'Good day,',
    '',
    'Thank you so much for booking a session to test our capstone project, the MMDC Cyber Range. ' +
      'Your time and feedback mean a lot to us and will help us improve the range before our final defense.',
    '',
    'Your testing session is confirmed:',
    '',
    rows.map(x => pad_(x[0] + ':', 19) + x[1]).join('\n'),
    '',
    'Add to Google Calendar: ' + gcalUrl_(r, token),
    'Using Outlook or Apple Calendar? Open the attached invite.ics file.',
    '',
    'WHAT HAPPENS NEXT',
    '1. ' + testerAccountStep_(),
    '2. Sign in to your assigned domain at your reserved time.',
    '',
    'Because of limited resources, the cyber range runs on four separate domains, and testers are spread across them.',
    '',
    cancelText,
    '',
    'We truly appreciate your support and look forward to your session.',
    '',
    'With gratitude,',
    'Capstone Group 2',
    'Section A4102, Mapúa Malayan Digital College',
  ].join('\n');

  const html = layout_({
    badge: ['Confirmed', '#1a7f37', '#dafbe1'],
    title: 'Thank you for booking a testing session',
    intro: 'Good day,<br><br>Thank you so much for booking a session to test our capstone project, the <strong>MMDC Cyber Range</strong>. ' +
      'Your time and feedback mean a lot to us and will help us improve the range before our final defense.<br><br>Your session is confirmed:',
    thanks: 'We truly appreciate your support and look forward to your session.',
    rows,
    calendar: gcalUrl_(r, token),
    steps: [
      esc_(testerAccountStep_()),
      'Sign in to your assigned domain at your reserved time.',
    ],
    note: 'Because of limited resources, the cyber range runs on four separate domains, and testers are spread across them.',
    callout: ['Need to cancel?', cancelText],
    sign: ['Capstone Group 2', 'Section A4102, Mapúa Malayan Digital College'],
    footer: 'This is an automated confirmation from Capstone Group 2. Reply to this email if you have questions. Authorized testing only.',
  });

  try {
    MailApp.sendEmail({
      to: r.email,
      subject: 'Booking confirmed: MMDC Cyber Range testing session, ' + whenShort_(r),
      body: text,
      htmlBody: html,
      attachments: [Utilities.newBlob(ics_(r, token), 'text/calendar', 'invite.ics')],
      name: 'Capstone Group 2 · MMDC Cyber Range',
      replyTo: NOTIFY_EMAIL || Session.getEffectiveUser().getEmail(),
    });
  } catch (err) {
    console.error('Confirmation email failed: ' + err);
  }
}

// Shared email layout: plain, light, table-based so it renders the same in Gmail and Outlook.
function layout_(o) {
  const font = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;';
  const line = i => (i ? 'border-top:1px solid #d8dee4;' : '');
  const rows = (o.rows || []).map((x, i) =>
    '<tr><td style="padding:10px 16px;' + line(i) + 'color:#59636e;font-size:13px;width:150px;vertical-align:top;">' + esc_(x[0]) + '</td>' +
    '<td style="padding:10px 16px;' + line(i) + 'color:#1f2328;font-size:14px;font-weight:600;word-break:break-word;">' + esc_(x[1]) + '</td></tr>').join('');
  const calendar = o.calendar ? '<p style="margin:16px 0 0;"><a href="' + esc_(o.calendar) + '" style="display:inline-block;padding:8px 16px;background:#1f883d;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Add to Google Calendar</a></p>' +
    '<p style="margin:8px 0 0;font-size:12px;color:#59636e;">Using Outlook or Apple Calendar? Open the attached <strong>invite.ics</strong> file.</p>' : '';
  const steps = o.steps ? '<p style="margin:24px 0 8px;font-size:14px;font-weight:600;color:#1f2328;">What happens next</p>' +
    '<ol style="margin:0;padding-left:20px;color:#1f2328;font-size:14px;line-height:1.6;">' + o.steps.map(s => '<li style="margin-bottom:4px;">' + s + '</li>').join('') + '</ol>' : '';
  const note = o.note ? '<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#59636e;">' + esc_(o.note) + '</p>' : '';
  const callout = o.callout ? '<div style="margin:24px 0 0;padding:12px 16px;border:1px solid #d1d9e0;border-left:3px solid #0969da;border-radius:6px;background:#f6f8fa;">' +
    '<p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1f2328;">' + esc_(o.callout[0]) + '</p>' +
    '<p style="margin:0;font-size:13px;line-height:1.5;color:#1f2328;">' + linkify_(esc_(o.callout[1])) + '</p></div>' : '';
  const button = o.button ? '<p style="margin:24px 0 0;"><a href="' + esc_(o.button[1]) + '" style="display:inline-block;padding:8px 16px;background:#1f883d;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">' + esc_(o.button[0]) + '</a></p>' : '';
  const thanks = o.thanks ? '<p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:#1f2328;">' + esc_(o.thanks) + '</p>' : '';
  const sign = o.sign ? '<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#1f2328;">With gratitude,<br><strong>' + esc_(o.sign[0]) + '</strong><br><span style="color:#59636e;">' + esc_(o.sign[1]) + '</span></p>' : '';
  const badge = '<span style="display:inline-block;padding:2px 10px;border-radius:2em;font-size:12px;font-weight:600;color:' + o.badge[1] + ';background:' + o.badge[2] + ';">' + esc_(o.badge[0]) + '</span>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f6f8fa;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;' + font + '"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;' + font + '">' +
    '<tr><td style="padding:0 4px 12px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#59636e;">MMDC Cyber Range · User testing</td></tr>' +
    '<tr><td style="background:#ffffff;border:1px solid #d1d9e0;border-radius:8px;padding:24px;">' +
      badge +
      '<h1 style="margin:12px 0 8px;font-size:20px;line-height:1.3;font-weight:600;color:#1f2328;">' + esc_(o.title) + '</h1>' +
      '<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#1f2328;">' + o.intro + '</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d1d9e0;border-radius:6px;border-collapse:separate;overflow:hidden;">' +
        rows +
      '</table>' + calendar + steps + note + callout + button + thanks + sign +
    '</td></tr>' +
    '<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:#59636e;">' + esc_(o.footer) + '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

// Calendar event for a booking. Slot times are PHT (UTC+8); "24:00" rolls over to the next day.
const EVENT_TITLE = 'MMDC Cyber Range testing session (Capstone Group 2)';

function utcStamp_(r, hm) {
  const [y, mo, d] = r.date.split('-').map(Number);
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 8, m)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function eventDetails_(token) {
  return 'Thank you for helping test our capstone project. A domain owner will create your account after booking. When it is ready, you will receive a separate email with your username and temporary password.\n\n' +
    'Cancellation code: ' + token + (BOOKING_PAGE_URL ? '\nManage your booking: ' + BOOKING_PAGE_URL : '');
}

function organizerAction_(r) {
  return 'Before the session, open Admin → Users and create an enabled Student account for ' + r.email +
    ' using a temporary password. The range will email the username and temporary password automatically when you create the account.';
}

function testerAccountStep_() {
  return 'A domain owner will create your account after booking. When it is ready, you will receive a separate email with your username and temporary password. Change the password when you first sign in.';
}

function gcalUrl_(r, token) {
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(EVENT_TITLE) +
    '&dates=' + utcStamp_(r, r.start) + '/' + utcStamp_(r, r.end) +
    '&details=' + encodeURIComponent(eventDetails_(token)) +
    '&ctz=Asia/Manila';
}

function ics_(r, token) {
  const text = v => String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  // Lines longer than 75 characters are folded, as the iCalendar format requires.
  const fold = line => line.length <= 75 ? line : line.match(/.{1,74}/g).join('\r\n ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Capstone Group 2//MMDC Cyber Range Booking//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + token + '@book.cyberlaboratory.online',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
    'DTSTART:' + utcStamp_(r, r.start),
    'DTEND:' + utcStamp_(r, r.end),
    'SUMMARY:' + text(EVENT_TITLE),
    'DESCRIPTION:' + text(eventDetails_(token)),
    BOOKING_PAGE_URL ? 'URL:' + BOOKING_PAGE_URL : '',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + text(EVENT_TITLE), 'TRIGGER:-PT30M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).map(fold).join('\r\n') + '\r\n';
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function linkify_(s) { return s.replace(/(https:\/\/[^\s<]+?)([.,]?(?:\s|$))/g, '<a href="$1" style="color:#0969da;">$1</a>$2'); }
function pad_(s, n) { return s + ' '.repeat(Math.max(1, n - s.length)); }
function host_(url) { return String(url || '').replace(/^https?:\/\//, '').split('/')[0]; }
function domainLabel_(id) { return 'Domain ' + String(id).replace(/^d/, ''); }

// Run this once from the Apps Script editor to grant email permission and
// preview both emails in your own inbox.
function testNotification() {
  const me = Session.getEffectiveUser().getEmail();
  const row = { domainId: 'd1', url: DOMAINS.d1, date: '2026-10-14', start: '09:00', end: '11:00',
    name: 'test', email: me, notes: 'Test notification', token: 'TEST1234' };
  notify_({ kind: 'New booking', row });
  confirm_(row, 'TEST1234');
}

// "Mon, Oct 19, 2026, 9:00 AM – 11:00 AM PHT" ("24:00" reads as 12:00 AM).
function when_(r) {
  const [y, mo, d] = r.date.split('-').map(Number);
  const day = new Date(y, mo - 1, d);
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  const t = hm => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 && h < 24 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + String(m).padStart(2, '0') + ' ' + ap; };
  return dayName + ', ' + mon + ' ' + d + ', ' + y + ', ' + t(r.start) + ' – ' + t(r.end) + ' PHT';
}

// "Wednesday, October 14, 2026"
function dateLong_(r) {
  const [y, mo, d] = r.date.split('-').map(Number);
  const day = new Date(y, mo - 1, d);
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day.getDay()] + ', ' +
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mo - 1] + ' ' + d + ', ' + y;
}
// "9:00 AM – 11:00 AM"
function timeRange_(r) { return when_(r).split(', ').slice(3).join(', ').replace(' PHT', ''); }
// "Wed, Oct 14, 9:00 AM – 11:00 AM PHT" (no year, for subject lines)
function whenShort_(r) { const p = when_(r).split(', '); return p[0] + ', ' + p[1] + ', ' + p.slice(3).join(', '); }

// "Juan Dela Cruz" -> "Juan D." so full names and emails stay in the sheet only.
function shortName_(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts[0];
}

// Trim, cap length, and drop leading characters a spreadsheet would read as a formula.
function clean_(v, max) {
  return String(v == null ? '' : v).trim().replace(/^[=+\-@\t\r]+/, '').slice(0, max);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
