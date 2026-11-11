# Polos Rullande Cykelverkstad

Sidan är en statisk webbplats med en AI-chatt i demonstrationssyfte. Chatten använder en Vercel Function och Googles Gemini via Vertex AI. Återuppringningar sparas i Firestore och skickas till Google Calendar som test. Ingen servicetid bokas.

## Aktivera chatten

1. Aktivera Vertex AI API och fakturering i Google Cloud-projektet. Ge tjänstkontot rollen Vertex AI User / Agent Platform User.
2. Skapa en JSON-nyckel för tjänstkontot. Om `iam.disableServiceAccountKeyCreation` blockerar skapandet krävs ett policyundantag för projektet; det sänker skyddet för tjänstkontonycklar i projektet.
3. Lägg hela JSON-innehållet som `GCP_SERVICE_ACCOUNT_KEY` i Vercel-projektets miljövariabler och gör en ny deployment. JSON-nyckeln är en långlivad hemlighet: dela den inte och lägg den aldrig i HTML eller Git.
4. För lokal utveckling: lägg `GCP_SERVICE_ACCOUNT_KEY` i `.env.local` och kör projektet med `vercel dev`. Att öppna HTML-filen direkt fungerar inte för AI-chatten eftersom serverfunktionen då inte körs.

Standardmodellen är `gemini-3-flash-preview` via det globala Vertex AI-endpointet. Den kan ändras med miljövariabeln `VERTEX_MODEL` till en modell som stöder globalt endpoint och tankenivån `LOW`. Google Cloud-krediter kan ha olika villkor; kontrollera att dina krediter gäller för tjänsten.

## Anpassa Polo

Ändra verksamhetens information, Polos ton och reglerna för svar i `lib/polo-knowledge.mjs`. Texten skickas som instruktioner vid varje anrop; modellen tränas inte om och lär sig inte automatiskt av samtalen. Ta bort eller ändra befintliga begränsningar när förutsättningarna ändras, till exempel när priser eller bokning är fastställda.

Den automatiska hälsningen finns i `index.html` och återges även i instruktionerna i `lib/polo-knowledge.mjs`, så ändra båda om hälsningen ska ändras. Spara filerna och pusha ändringarna till GitHub för att publicera dem via Vercel.

Samtalshistoriken hålls i webbläsaren medan sidan är öppen och de senaste meddelandena skickas med varje fråga. Konversationerna sparas inte av applikationen. Efter tio svar från Polo (utöver den automatiska hälsningen) fokuserar chatten på återuppringning och avslutas senast vid svar tretton. Formuläret kan fortfarande skickas efter avslutet. En omladdning startar en ny chatt.

## Återuppringning

Kunden får information om att systemet testas och att ingen servicetid bokas, och kan därefter skriva sitt telefonnummer och eventuellt namn i chatten. Det finns också ett valfritt formulär där kunden kan välja en testtid. Utan vald tid letar funktionen efter en ledig intern timme tisdag–lördag kl. 11–16 i kalenderns tidszon Europe/Stockholm.

1. Skapa en Firestore-databas i Native mode och dela kalendern med kalenderns tjänstkonto med rättighet att ändra händelser.
2. Ge samma tjänstkonto rätt att läsa och skriva Firestore-data och skriva Cloud Logging-loggar. Rollen Cloud Datastore User ger tillgång till projektets Firestore-data och Logs Writer tillåter loggskrivning.
3. Ange `CALENDAR_SERVICE_ACCOUNT_KEY` som hela JSON-nyckeln och `CALENDAR_ID` som kalender-ID i Vercels miljövariabler. Nyckeln är en hemlighet och får aldrig läggas i Git eller klientkod.
4. Konfigurera ett loggbaserat larm i Cloud Monitoring för loggen `polo-calendar` och `jsonPayload.event="calendar_callback_failed"`, med en verifierad e-postkanal till ägaren. Kontrollera faktiskt levererade larm innan lösningen tas i bruk.

Telefonnumret och eventuellt namn sparas först i Firestore-kollektionen `polo_callbacks`. Om kalendern inte kan uppdateras får kunden ändå en bekräftelse och posten finns kvar med `calendarCreated=false`; följ upp sådana poster manuellt i Firestore. Om även loggning eller larmleverans misslyckas måste posterna fortfarande kontrolleras manuellt. Om sparandet inte kan bekräftas ombeds kunden försöka igen eller ring/sms:a. Testhändelser är markerade som ledig tid och innehåller kontaktuppgifterna. Begränsa därför åtkomsten till både kalender och databas.
