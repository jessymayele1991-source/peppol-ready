# Peppol Ready — product- en systeemarchitectuur

## Productgrenzen

Peppol Ready is een multi-tenant readiness-, compliance- en risicoplatform voor accountantskantoren. Het verwerkt geen facturen, transacties, OCR, bankgegevens, grootboek of btw-aangiften. Boekhoudpakketten zijn uitsluitend metadata en toekomstige integratiebronnen.

## Informatiearchitectuur

| Route | Module | Kernworkflow |
| --- | --- | --- |
| `/` | Dashboard | Portefeuille-KPI's, verdeling, risico's, voortgang en incidenten |
| `/clients` | Klanten | Zoeken, filteren, sorteren en pagineren |
| `/clients/:companyId` | Klantdossier | Profiel, contactpersonen, scans, taken, risico's en audittrail |
| `/readiness` | Readiness Center | Scanwachtrij, statusgroepen en scanhistorie — nog niet gebouwd (placeholder) |
| `/clients/:companyId` tab Gereedheid | Readiness Scan | Beoordelen, score verklaren, bewijs per controlepunt — gebouwd in fase 2B |
| `/actions` | Taken | Open, in behandeling en voltooide klantacties |
| `/compliance` | Compliance Center | Checklist, open punten, aanbevelingen en voortgang |
| `/incidents` | Risico's | Kritieke, actievereiste en gereed-signalen |
| `/reports` | Rapporten | Readiness-, risico- en managementrapporten |
| `/users` | Team | Medewerkers en rollen |
| `/settings` | Instellingen | Kantoor, taal, branding en voorkeuren |
| `/audit-log` | Auditlog | Onveranderlijke organisatieactiviteit |

## Rollen en rechten

| Mogelijkheid | Owner | Admin | Medewerker | Viewer |
| --- | --- | --- | --- | --- |
| Werkruimte beheren | Ja | Beperkt | Nee | Nee |
| Gebruikers en rollen beheren | Ja | Ja | Nee | Nee |
| Klanten en scans wijzigen | Ja | Ja | Ja | Nee |
| Taken beheren | Ja | Ja | Ja | Nee |
| Rapporten genereren | Ja | Ja | Ja | Alleen bekijken |
| Auditlog bekijken | Ja | Ja | Beperkt | Nee |

Alle serverqueries worden op `organizationId` begrensd. Actor, tenant, tijdstempels en auditrecords worden server-side afgeleid zodra authenticatie wordt toegevoegd.

## Domeinmodel

- `Organization` bezit memberships, bedrijven, taken, incidenten, rapporten en audit-events.
- `Membership` koppelt een gebruiker aan één organisatie en rol.
- `Company` is het klantdossier met KvK-, btw-, branche- en ERP-metadata.
- `ClientContact` bevat één of meer contactpersonen per klant.
- `ReadinessScore` is de canonieke beoordeling: één onveranderlijke rij per beoordelingsmoment, met score, status, bron, `engineVersion` en de beoordelaar (`completedById`).
- `ReadinessCheck` bewaart de uitkomst en bewijsnotitie per controlepunt en hangt aan een beoordeling (`scoreId`).
- `ReadinessScan` en `ReadinessCategory` zijn verwijderd in `20261002120000_readiness_consolidation`: ze zijn nooit gebruikt en vormden een tweede readinessmodel met een eigen statusvocabulaire.
- `Task` koppelt opvolgwerk optioneel aan een klant en medewerker.
- `Incident` koppelt compliance- of leveringsrisico's optioneel aan een klant.
- `Report` bewaart type, taal, periode, status en het uiteindelijke object-storagepad.
- `AuditEvent` is append-only en bewaart actor, gebeurtenis, entiteit en metadata.

## Readinessmodel

Er is één readinessmodel. `readiness_scores` is de canonieke beoordeling en `readiness_checks` bewaart per controlepunt de uitkomst en het bewijs. `PeppolStatus` (`READY`, `CONFIGURING`, `AT_RISK`, `NOT_REGISTERED`) is het enige statusvocabulaire; er is geen tweede categorie-enum.

De actieve engine weegt vijf factoren tot 100 punten: Peppol-registratie (30), ontvangstadres (20), Peppol-geschikte software (20), geldig certificaat (15) en een geslaagde testfactuur (15). Elke gefaalde factor levert een verklaarbaar risico met remediatie.

`engineVersion` legt vast welke regels een score hebben voortgebracht. Een historische beoordeling wordt nooit opnieuw geïnterpreteerd: wijzigen de factoren, gewichten of drempels, dan stijgt het versienummer en behouden oudere beoordelingen hun eigen versie.

Een beoordeling wordt opgeslagen als één `readiness_scores`-rij met vijf `readiness_checks`-rijen: per controlepunt de uitkomst en de bewijsnotitie van de medewerker. De beoordelaar staat in `completedById` en komt altijd uit de sessie. Bewijs staat uitsluitend in `readiness_checks.evidence` en komt nooit in het auditspoor.

`GET /companies/:companyId/readiness/latest` geeft de laatste beoordeling terug (204 als die niet bestaat) in exact dezelfde vorm als het antwoord op het opslaan, zodat het dossier na herladen hetzelfde toont.

Score en status worden gelezen uit de opgeslagen beoordeling, nooit opnieuw berekend. De precedentie is: laatste beoordeling, anders de kolommen op `companies` (voor een klant die nog niet beoordeeld is). Risico's komen uit de opgeslagen momentopname in `details.risks`; ontbreekt die of is ze onvolledig — zoals bij beoordelingen van voor deze consolidatie — dan worden ze afgeleid uit de opgeslagen antwoorden. Verouderingsrisico's (`ASSESSMENT_MISSING`, `ASSESSMENT_STALE`) en incidentrisico's (`OPEN_CRITICAL_INCIDENT`) hangen van het huidige moment af en worden wél bij elke uitvraag bepaald.

Een uitbreiding van de vragenlijst naar tien controlepunten is een openstaande beslissing voor de volgende fase, niet een bestaand ontwerp. Vier van de eerder beoogde punten (KvK-nummer, btw-nummer, e-mailadres, ERP-software) zijn stamdata op `Company`; of die meewegen in de score moet dan expliciet worden besloten.

## UX-wireframes

### Dashboard

1. Contextbalk met organisatie, globale zoekfunctie, taal en gebruiker.
2. Vijf KPI's met portefeuilleomvang, gereedheid, acties, hoog risico en gemiddelde score.
3. Verdeling, risicocategorieën en voortgang.
4. Actiewachtrij en recente compliancegebeurtenissen.
5. Compact klantenoverzicht als ingang naar dossiers.

### Klanten

1. Titelbalk met primaire actie.
2. Zoek-, status-, branche- en scorefilters.
3. Sorteerbare tabel met KvK, btw, contact, status, score en laatste scan.
4. Paginering en duidelijke lege/foutstatus.
5. Rij opent het klantdossier.

### Klantdossier / scan

1. Samenvatting en risicostatus.
2. Tab Gereedheid: vijf gewogen controlepunten beoordelen met een bewijsnotitie per vraag.
3. Verklaarbare score met status, per controlepunt gehaald of niet, en het bewijs erbij.
4. Risico's met aanbevolen remediatie; omzetten naar taken volgt in een latere fase.
5. Historie en auditactiviteit volgen in fase 2C.

### Taken, compliance en rapporten

- Taken gebruiken lijst- of bordweergave met eigenaar, prioriteit en vervaldatum.
- Compliance groepeert kritieke, actievereiste en gereed-signalen per klant.
- Rapporten tonen type, periode, taal, status en exportformaten; bestanden gaan naar object storage.

## Internationalisatie en toegankelijkheid

Nederlands is standaard. Alle zichtbare tekst en toegankelijkheidslabels komen uit locale-JSON. Taalvoorkeur wordt per gebruiker opgeslagen. Datums, getallen, percentages en valuta lopen via de gedeelde `Intl`-formatters. Nieuwe talen worden door locale-discovery toegevoegd zonder componentwijzigingen.

## Implementatievolgorde

1. Datamodel en migraties.
2. OpenAPI-contracten voor klanten en klantdetail.
3. Readiness scans en tien controlepunten.
4. Taken en compliance.
5. Rapportgeneratie en object storage.
6. Gebruikersbeheer, autorisatie en auditweergave.