const timeZone = 'Europe/Stockholm';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function localParts(date) {
  return Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

export function stockholmTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Ogiltigt datum eller klockslag.');
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let i = 0; i < 3; i++) {
    const local = localParts(new Date(timestamp));
    timestamp += target - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  }
  const local = localParts(new Date(timestamp));
  if (local.year !== year || local.month !== month || local.day !== day ||
      local.hour !== hour || local.minute !== minute) {
    throw new Error('Ogiltigt datum eller klockslag.');
  }
  return new Date(timestamp);
}

async function calendarRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error(`Calendar API: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function firstAvailable(calendarId, token, now) {
  const today = localParts(now);
  const firstDay = Date.UTC(today.year, today.month - 1, today.day);
  const lastDay = new Date(firstDay + 61 * 86400000).toISOString().slice(0, 10);
  const end = stockholmTime(`${lastDay}T00:00`);
  const result = await calendarRequest('https://www.googleapis.com/calendar/v3/freeBusy', token, {
    method: 'POST',
    body: JSON.stringify({ timeMin: now.toISOString(), timeMax: end.toISOString(), items: [{ id: calendarId }] })
  });
  const calendar = result.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
    throw new Error('Kunde inte kontrollera kalenderns lediga tider.');
  }
  const busy = calendar.busy.map(period => {
    const start = Date.parse(period.start);
    const endTime = Date.parse(period.end);
    if (!Number.isFinite(start) || !Number.isFinite(endTime) || endTime <= start) {
      throw new Error('Kalendern returnerade ett ogiltigt upptaget intervall.');
    }
    return { start, end: endTime };
  });
  for (let day = 0; day < 60; day++) {
    const date = new Date(firstDay + day * 86400000);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 1) continue;
    const dateString = date.toISOString().slice(0, 10);
    for (let hour = 11; hour < 16; hour++) {
      const start = stockholmTime(`${dateString}T${String(hour).padStart(2, '0')}:00`);
      const finish = start.getTime() + 3600000;
      if (start > now && !busy.some(period => start.getTime() < period.end && finish > period.start)) {
        return start;
      }
    }
  }
  throw new Error('Ingen ledig intern testtid hittades.');
}

export async function saveCallback({ calendarId, token, phone, name = '', requestId, testTime, now = new Date() }) {
  const eventId = requestId.replaceAll('-', '').toLowerCase();
  const eventUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;
  let start;
  if (testTime) {
    start = stockholmTime(testTime);
    if (start <= now || start.getTime() > now.getTime() + 366 * 86400000) {
      throw new Error('Testtiden måste ligga inom det kommande året.');
    }
  } else {
    start = await firstAvailable(calendarId, token, now);
  }
  const event = {
    id: eventId,
    summary: 'TEST – återuppringning Polo Cykel',
    description: `${name ? `Namn: ${name}\n` : ''}Telefon: ${phone}\nIngen servicetid är bokad. Ring kunden för att komma överens om tid.`,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: new Date(start.getTime() + 3600000).toISOString(), timeZone },
    transparency: 'transparent',
    extendedProperties: { private: { callbackRequestId: requestId } }
  };
  try {
    await calendarRequest(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, token, {
      method: 'POST', body: JSON.stringify(event)
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    const existing = await calendarRequest(eventUrl, token);
    if (existing.extendedProperties?.private?.callbackRequestId !== requestId) throw error;
  }
}
