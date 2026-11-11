import { poloInstructions } from '../lib/polo-knowledge.mjs';
import { JWT } from 'google-auth-library';

const maxMessages = 12;
const maxRequestBytes = 24 * 1024;
const model = process.env.VERTEX_MODEL || 'gemini-3-flash-preview';
let credentials;

function getCredentials() {
  if (credentials) return credentials;
  const key = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
  if (key.type !== 'service_account' || typeof key.project_id !== 'string' ||
      typeof key.client_email !== 'string' || typeof key.private_key !== 'string' ||
      !key.project_id || !key.client_email || !key.private_key) {
    throw new Error('Ogiltig tjänstkontonyckel.');
  }
  credentials = {
    project: key.project_id,
    client: new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
  };
  return credentials;
}

function error(message, status) {
  return Response.json({ error: message }, { status });
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return error('Metoden stöds inte.', 405);
    }

    if (!process.env.GCP_SERVICE_ACCOUNT_KEY) {
      console.error('GCP_SERVICE_ACCOUNT_KEY saknas.');
      return error('Chatten är inte konfigurerad ännu.', 503);
    }

    let body;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > maxRequestBytes) {
        return error('Meddelandet är för långt.', 413);
      }
      body = JSON.parse(text);
    } catch {
      return error('Kunde inte läsa meddelandet.', 400);
    }

    const history = body?.messages;
    const responseCount = body?.responseCount ?? 0;
    const callbackReceived = body?.callbackReceived ?? false;
    const callbackDisclosureShown = body?.callbackDisclosureShown ?? false;
    if (!Array.isArray(history) || history.length < 1 || history.length > maxMessages ||
        !Number.isInteger(responseCount) || responseCount < 0 || responseCount > 12 ||
        typeof callbackReceived !== 'boolean' || typeof callbackDisclosureShown !== 'boolean' ||
        history.some((message, index) =>
          !message || message.role !== (index % 2 === 0 ? 'user' : 'model') ||
          typeof message.text !== 'string' || !message.text.trim() ||
          message.text.length > (message.role === 'user' ? 500 : 2000)) ||
        history[history.length - 1].role !== 'user') {
      return error('Meddelandet har ett ogiltigt format.', 400);
    }

    let stage = 'läsning av tjänstkontonyckel';
    try {
      const { project, client } = getCredentials();
      stage = 'Google-autentisering';
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('Google returnerade ingen åtkomsttoken.');
      stage = 'Gemini-anrop';
      const response = await fetch(
        `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: poloInstructions +
              (callbackDisclosureShown
                ? '\nKunden har fått informationen om testbokning. Om kunden nu skriver sitt eget nummer för återuppringning, använd spara_ateruppringning.'
                : '\nInformationen om testbokning har ännu inte visats. Använd visa_ateruppringning innan kunden lämnar sina uppgifter.') +
              (responseCount >= 10
              ? (callbackReceived
                ? '\nKunden har redan skickat en begäran om återuppringning. Fråga inte efter kontaktuppgifterna igen.'
                : '\nSamtalet närmar sig sitt slut. Styr vänligt mot återuppringning och be kunden skriva sitt telefonnummer och eventuellt namn i chatten.')
              : '') }] },
            contents: history.map(({ role, text }) => ({ role, parts: [{ text }] })),
            tools: [{
              functionDeclarations: [
                {
                  name: 'visa_ateruppringning',
                  description: 'Visa information om återuppringning. Sparar inget och bokar ingen tid.',
                  parameters: { type: 'OBJECT', properties: {} }
                },
                {
                  name: 'spara_ateruppringning',
                  description: 'Begär återuppringning när kunden själv skriver sitt telefonnummer efter att informationen om testbokningen har visats. Använd bara uppgifter från kunden, aldrig påhittade.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      phone: { type: 'STRING', description: 'Kundens eget telefonnummer, som det står i kundens senaste meddelande.' },
                      name: { type: 'STRING', description: 'Kundens eget namn om kunden själv har angett det, annars tomt.' }
                    },
                    required: ['phone']
                  }
                }
              ]
            }],
            generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'LOW' } }
          }),
          signal: AbortSignal.timeout(25000)
        }
      );

      if (!response.ok) {
        console.error('Gemini-anropet misslyckades:', response.status);
        return error('Polo kunde inte svara just nu. Försök igen om en stund.', 502);
      }

      stage = 'läsning av Gemini-svar';
      const result = await response.json();
      const parts = result.candidates?.[0]?.content?.parts;
      const callbackCall = parts?.find(part => part.functionCall?.name === 'spara_ateruppringning')?.functionCall;
      const lastMessage = history[history.length - 1].text;
      const phoneCandidates = lastMessage.match(/\+?\d[\d ()-]{5,23}\d/g) || [];
      const needsDisclosure = !callbackDisclosureShown && (callbackCall || phoneCandidates.length > 0);
      const showCallback = Boolean(needsDisclosure || parts?.some(part => part.functionCall?.name === 'visa_ateruppringning'));
      let callback;
      if (callbackCall && callbackDisclosureShown && !callbackReceived) {
        const phone = callbackCall.args?.phone;
        const name = callbackCall.args?.name ?? '';
        if (typeof phone !== 'string' || !/^\+?[0-9 ()-]{7,25}$/.test(phone) ||
            phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15 ||
            !phoneCandidates.some(candidate => candidate.replace(/\D/g, '') === phone.replace(/\D/g, ''))) {
          console.error('Gemini returnerade ett ogiltigt telefonnummer.');
          return error('Jag kunde inte läsa telefonnumret. Skriv det gärna igen.', 502);
        }
        const validName = typeof name === 'string' && name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) &&
          (!name.trim() || history.some(message => message.role === 'user' &&
            message.text.toLocaleLowerCase('sv-SE').includes(name.trim().toLocaleLowerCase('sv-SE'))));
        if (!validName) console.error('Gemini returnerade ett namn som inte kunde verifieras.');
        callback = { phone: phone.trim(), name: validName ? name.trim() : '' };
      }
      const reply = needsDisclosure
        ? 'Jag hjälper gärna till! Läs gärna informationen nedan och skriv sedan ditt nummer igen om du vill bli uppringd.'
        : callbackDisclosureShown && !callbackReceived && phoneCandidates.length && !callback
          ? 'Jag kunde inte ta emot numret just nu. Skriv det gärna igen eller ring/sms:a 0738-99 79 33.'
        : parts
        ?.filter(part => typeof part.text === 'string' && !part.thought)
        .map(part => part.text).join('').trim() ||
        (callback ? 'Ett ögonblick medan jag tar emot din förfrågan.' :
          showCallback ? 'Självklart! Du kan skriva ditt nummer här så ringer vi upp.' : '');
      if (!reply || reply.length > 2000) {
        console.error('Gemini returnerade inget användbart svar.');
        return error('Polo kunde inte svara just nu. Försök igen om en stund.', 502);
      }

      return Response.json({ reply, showCallback, callback });
    } catch (cause) {
      console.error('Polo misslyckades vid', stage, ':', cause?.name);
      return error('Polo kunde inte nås just nu. Försök igen om en stund.', 502);
    }
  }
};
