# Peppol Ready — product- en systeemarchitectuur

## Productgrenzen

Peppol Ready is een multi-tenant readiness-, compliance- en risicoplatform voor accountantskantoren. Het verwerkt geen facturen, transacties, OCR, bankgegevens, grootboek of btw-aangiften. Boekhoudpakketten zijn uitsluitend metadata en toekomstige integratiebronnen.

## Informatiearchitectuur

| Route | Module | Kernworkflow |
| --- | --- | --- |
| `/` | Dashboard | Portefeuille-KPI's, verdeling, risico's, voortgang en incidenten |
| `/clients` | Klanten | Zoeken, filteren, sorteren en pagineren |
| `/clients/:companyId` | Klantdossier | Profiel, contactpersonen, scans, taken, risico's en audittrail |
| `/readiness` | Readiness Center | Scanwachtrij, statusgroepen en scanhistorie |
| `/readiness/:companyId` | Readiness Scan | Tien controlepunten beoordelen en score verklaren |
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
- `ReadinessScan` is een onveranderlijk scanmoment met score en categorie.
- `ReadinessCheck` bewaart de uitkomst en bewijsnotitie per controlepunt.
- `ReadinessScore` blijft tijdens de migratie bestaan als historische compatibiliteitslaag voor het huidige dashboard.
- `Task` koppelt opvolgwerk optioneel aan een klant en medewerker.
- `Incident` koppelt compliance- of leveringsrisico's optioneel aan een klant.
- `Report` bewaart type, taal, periode, status en het uiteindelijke object-storagepad.
- `AuditEvent` is append-only en bewaart actor, gebeurtenis, entiteit en metadata.

## Readinessmodel

De doelchecklist bevat tien gelijkwaardig verklaarbare controlepunten:

1. KvK-nummer ingevuld
2. Btw-nummer aanwezig
3. E-mailadres aanwezig
4. ERP-software bekend
5. UBL-ondersteuning
6. Peppol-ID geregistreerd
7. Facturen digitaal
8. Leveranciers digitaal
9. Ontvangt e-facturen
10. Verstuurt e-facturen

De categorieën zijn `NOT_STARTED`, `BASIC`, `ADVANCED`, `READY` en `FULLY_COMPLIANT`. De bestaande vijf-factor-engine blijft actief tot de tien controles via contract-first API's en migratie van historische scores zijn ingevoerd.

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
2. Checklist met tien controlepunten, bewijs en toelichting.
3. Verklaarbare score met categorie.
4. Aanbevolen acties die als taak kunnen worden aangemaakt.
5. Historie en auditactiviteit.

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