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
    if (!Array.isArray(history) || history.length < 1 || history.length > maxMessages ||
        history.some((message, index) =>
          !message || message.role !== (index % 2 === 0 ? 'user' : 'model') ||
          typeof message.text !== 'string' || !message.text.trim() ||
          message.text.length > (message.role === 'user' ? 500 : 2000)) ||
        history[history.length - 1].role !== 'user') {
      return error('Meddelandet har ett ogiltigt format.', 400);
    }

    try {
      const { project, client } = getCredentials();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('Google returnerade ingen åtkomsttoken.');
      const response = await fetch(
        `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: poloInstructions }] },
            contents: history.map(({ role, text }) => ({ role, parts: [{ text }] })),
            generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'LOW' } }
          }),
          signal: AbortSignal.timeout(25000)
        }
      );

      if (!response.ok) {
        console.error('Gemini-anropet misslyckades:', response.status);
        return error('Polo kunde inte svara just nu. Försök igen om en stund.', 502);
      }

      const result = await response.json();
      const reply = result.candidates?.[0]?.content?.parts
        ?.filter(part => typeof part.text === 'string' && !part.thought)
        .map(part => part.text).join('').trim();
      if (!reply || reply.length > 2000) {
        console.error('Gemini returnerade inget användbart svar.');
        return error('Polo kunde inte svara just nu. Försök igen om en stund.', 502);
      }

      return Response.json({ reply });
    } catch (cause) {
      console.error('Gemini-anropet misslyckades:', cause.name);
      return error('Polo kunde inte nås just nu. Försök igen om en stund.', 502);
    }
  }
};
