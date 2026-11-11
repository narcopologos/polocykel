import { JWT } from 'google-auth-library';
import { saveCallback, stockholmTime } from '../lib/calendar.mjs';
import { saveRequest, markCalendarCreated, logCalendarFailure } from '../lib/callback-storage.mjs';

let credentials;

export default {
  async fetch(request) {
    if (request.method !== 'POST') return Response.json({ error: 'Metoden stöds inte.' }, { status: 405 });
    if (!process.env.CALENDAR_SERVICE_ACCOUNT_KEY || !process.env.CALENDAR_ID) {
      console.error('Återuppringning är inte konfigurerad.');
      return Response.json({ error: 'Vi kunde inte spara ditt nummer. Ring eller sms:a 0738-99 79 33 istället.' }, { status: 503 });
    }
    let body;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 4096) {
        return Response.json({ error: 'Förfrågan är för stor.' }, { status: 413 });
      }
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Kunde inte läsa förfrågan.' }, { status: 400 });
    }
    const { phone, requestId, testTime, name = '' } = body || {};
    if (typeof phone !== 'string' || !/^\+?[0-9 ()-]{7,25}$/.test(phone) ||
        phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15 ||
        typeof name !== 'string' || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) ||
        typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
        (testTime !== '' && (typeof testTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(testTime)))) {
      return Response.json({ error: 'Kontrollera namn, telefonnummer och eventuell testtid.' }, { status: 400 });
    }
    try {
      if (testTime) {
        const selected = stockholmTime(testTime);
        const now = Date.now();
        if (selected.getTime() <= now || selected.getTime() > now + 366 * 86400000) {
          throw new Error('Ogiltig testtid.');
        }
      }
    } catch {
      return Response.json({ error: 'Välj ett giltigt framtida datum inom ett år, eller lämna testtiden tom.' }, { status: 400 });
    }
    let token;
    let project;
    try {
      if (!credentials) {
        const key = JSON.parse(process.env.CALENDAR_SERVICE_ACCOUNT_KEY);
        if (key.type !== 'service_account' || !key.project_id || !key.client_email || !key.private_key) {
          throw new Error('Ogiltig kalendernyckel.');
        }
        credentials = {
          project: key.project_id,
          client: new JWT({
            email: key.client_email, key: key.private_key,
            scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/calendar']
          })
        };
      }
      project = credentials.project;
      ({ token } = await credentials.client.getAccessToken());
      if (!token) throw new Error('Google returnerade ingen åtkomsttoken.');
      var saved = await saveRequest({ project, token, requestId, phone: phone.trim(), name: name.trim(), testTime });
    } catch (error) {
      console.error('Kunde inte spara återuppringning:', error.status || error.name);
      return Response.json({ error: 'Vi kunde inte bekräfta att ditt nummer sparades. Försök igen eller ring/sms:a 0738-99 79 33.' }, { status: 502 });
    }
    if (!saved.fields?.calendarCreated?.booleanValue) {
      try {
        await saveCallback({ calendarId: process.env.CALENDAR_ID, token, phone: phone.trim(), name: name.trim(), requestId, testTime });
        await markCalendarCreated({ project, token, requestId });
      } catch (error) {
        console.error('Kalenderförfrågan misslyckades:', error.status || error.name);
        try {
          await logCalendarFailure({ project, token, requestId });
        } catch (logError) {
          console.error('Kunde inte skicka kalenderlarm till Cloud Logging:', logError.status || logError.name);
        }
      }
    }
    return Response.json({ ok: true });
  }
};
