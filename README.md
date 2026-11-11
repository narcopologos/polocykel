# Polos Rullande Cykelverkstad

Sidan är en statisk webbplats med en AI-chatt i demonstrationssyfte. Chatten använder en Vercel Function och Googles Gemini via Vertex AI express mode. Den gör inga bokningar.

## Aktivera chatten

1. Skapa en API-nyckel för [Vertex AI express mode](https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview) i ditt Google Cloud-konto.
2. Lägg till nyckeln som `VERTEX_API_KEY` i Vercel-projektets miljövariabler och gör en ny deployment. Lägg aldrig nyckeln i HTML-filen eller i Git.
3. För lokal utveckling: lägg `VERTEX_API_KEY` i `.env.local` och kör projektet med `vercel dev`. Att öppna HTML-filen direkt fungerar inte för AI-chatten eftersom serverfunktionen då inte körs.

Standardmodellen är `gemini-3-flash-preview`. Den kan ändras med miljövariabeln `VERTEX_MODEL` till en modell som stöds av Vertex AI express mode och tankenivån `LOW`. Google Cloud-krediter kan ha olika villkor; kontrollera att dina krediter gäller för tjänsten.

Ändra informationen och tonen som Polo utgår från i `lib/polo-knowledge.mjs`. Samtalshistoriken hålls i webbläsaren medan sidan är öppen och skickas med varje fråga; inga bokningar eller konversationer sparas av applikationen.
