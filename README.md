# Polos Rullande Cykelverkstad

Sidan är en statisk webbplats med en AI-chatt i demonstrationssyfte. Chatten använder en Vercel Function och Googles Gemini via Vertex AI i ett Google Cloud-projekt. Den gör inga bokningar.

## Aktivera chatten

1. Aktivera Vertex AI API och fakturering i Google Cloud-projektet. Ge tjänstkontot rollen Vertex AI User / Agent Platform User.
2. Skapa en JSON-nyckel för tjänstkontot. Om `iam.disableServiceAccountKeyCreation` blockerar skapandet krävs ett policyundantag för projektet; det sänker skyddet för tjänstkontonycklar i projektet.
3. Lägg hela JSON-innehållet som `GCP_SERVICE_ACCOUNT_KEY` i Vercel-projektets miljövariabler och gör en ny deployment. JSON-nyckeln är en långlivad hemlighet: dela den inte och lägg den aldrig i HTML eller Git.
4. För lokal utveckling: lägg `GCP_SERVICE_ACCOUNT_KEY` i `.env.local` och kör projektet med `vercel dev`. Att öppna HTML-filen direkt fungerar inte för AI-chatten eftersom serverfunktionen då inte körs.

Standardmodellen är `gemini-3-flash-preview` via det globala Vertex AI-endpointet. Den kan ändras med miljövariabeln `VERTEX_MODEL` till en modell som stöder globalt endpoint och tankenivån `LOW`. Google Cloud-krediter kan ha olika villkor; kontrollera att dina krediter gäller för tjänsten.

Ändra informationen och tonen som Polo utgår från i `lib/polo-knowledge.mjs`. Samtalshistoriken hålls i webbläsaren medan sidan är öppen och skickas med varje fråga; inga bokningar eller konversationer sparas av applikationen.
