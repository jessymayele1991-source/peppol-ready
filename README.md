# Peppol Ready

Peppol Ready helpt accountantskantoren de Peppol-gereedheid, compliance en
risico's van hun klantenportefeuille te bewaken.

De applicatie bestaat uit een PostgreSQL-database, een API (Express 5 met
Prisma) en een webapplicatie (React met Vite). Alles draait lokaal op je eigen
machine; Replit is niet nodig. Dezelfde code blijft ongewijzigd deploybaar op
Replit.

## Snel starten

Er zijn twee manieren. Kies er één.

| | `docker compose up` | `pnpm dev` |
|---|---|---|
| Voor | alles in één keer draaien, zonder lokale Node-installatie | ontwikkelen, met hot reload van de frontend |
| Nodig | Docker Desktop, Colima of OrbStack | Node.js 24, pnpm 10 en een PostgreSQL (bijvoorbeeld via Docker) |

### Route A — alles in Docker

```sh
docker compose up
```

De eerste keer wordt het image gebouwd; dat duurt enkele minuten. Daarna:

1. PostgreSQL start en wordt gezond gemeld.
2. De migraties worden toegepast, precies zoals in productie.
3. Is de database leeg, dan worden demogegevens geladen.
4. De API, de webapplicatie en Prisma Studio starten.

Open **http://localhost:5173** en meld je aan met een demo-account
(zie [Demo-accounts](#demo-accounts)).

Na een codewijziging: `docker compose up --build`.
Stoppen: `Ctrl+C`, of `docker compose down`.
Database volledig wissen: `docker compose down --volumes`.

### Route B — lokaal ontwikkelen met `pnpm dev`

**Eenmalig**

```sh
# 1. Node.js 24 en pnpm 10 (pnpm via corepack, die met Node meekomt)
corepack enable
corepack prepare pnpm@10.26.1 --activate

# 2. Afhankelijkheden
pnpm install

# 3. Lokale instellingen
cp .env.example .env
```

**Een database starten**

Met Docker (aanbevolen), dat alleen de database uit `docker-compose.yml` start:

```sh
pnpm db:up
```

Of gebruik een eigen PostgreSQL 16 en pas `DATABASE_URL` in `.env` aan.

**Starten**

```sh
pnpm dev
```

Dit past de migraties toe, laadt demogegevens als de database leeg is, en start
daarna de API en de webapplicatie naast elkaar. Open **http://localhost:5173**.

De frontend herlaadt automatisch bij wijzigingen. De API heeft geen watch-modus:
herstart `pnpm dev` na een wijziging in `artifacts/api-server`.

## Adressen

| Wat | Adres |
|---|---|
| Applicatie (aanmelden) | http://localhost:5173 |
| API via de applicatie | http://localhost:5173/api |
| API rechtstreeks, health check | http://localhost:8080/api/healthz |
| Prisma Studio | http://localhost:5555 |
| PostgreSQL | `localhost:5432` — gebruiker `peppol`, wachtwoord `peppol`, database `peppol_ready` |

Prisma Studio start vanzelf met `docker compose up`. Bij route B start je het
apart met `pnpm db:studio`.

Poort 5432 al in gebruik? Start de database op een andere poort met
`POSTGRES_PORT=5433 pnpm db:up` en pas `DATABASE_URL` in `.env` aan.

## Demo-accounts

Alle demo-accounts delen één wachtwoord.

| E-mailadres | Rol |
|---|---|
| `elise@northstar-accounting.be` | Eigenaar |
| `lucas@northstar-accounting.be` | Beheerder |
| `nora@northstar-accounting.be` | Medewerker |

Het wachtwoord hangt af van hoe je startte:

- **`docker compose up`**: `local-demo-password`, of de waarde van
  `SEED_PASSWORD` als je die in je shell zet.
- **`pnpm dev`** tegen een database op `localhost`: `peppol-ready-dev`, tenzij je
  `SEED_PASSWORD` in `.env` zet.

De seed draait alleen op een lege database. Opnieuw laden met een ander
wachtwoord: `pnpm db:seed` (overschrijft de demogegevens).

Je kunt ook zelf een account aanmaken via **Nog geen account? Registreren** onder het aanmeldformulier (http://localhost:5173/register). Je krijgt dan een eigen, lege werkruimte waarin je eigenaar bent.

In een nieuwe werkruimte voeg je klanten toe via **Klanten → Nieuwe klant** (http://localhost:5173/clients). Eigenaars en beheerders kunnen klanten ook archiveren en herstellen; medewerkers kunnen klanten en contactpersonen toevoegen en wijzigen; lezers zien alleen.

## Veelgebruikte commando's

| Commando | Doet |
|---|---|
| `pnpm dev` | migraties, seed bij lege database, API + web |
| `pnpm db:up` | alleen PostgreSQL starten via Docker |
| `pnpm db:deploy` | openstaande migraties toepassen |
| `pnpm db:seed` | demogegevens (opnieuw) laden |
| `pnpm db:studio` | Prisma Studio op poort 5555 |
| `pnpm typecheck` | TypeScript-controle van de hele workspace |
| `pnpm --filter @workspace/api-server run test` | testsuite |
| `pnpm run build` | typecheck en productiebuild van alle pakketten |

De databasetests draaien alleen als `TEST_DATABASE_URL` naar een gemigreerde
database wijst:

```sh
TEST_DATABASE_URL=postgresql://peppol:peppol@localhost:5432/peppol_ready \
  pnpm --filter @workspace/api-server run test
```

## Instellingen

`.env.example` beschrijft elke variabele. Lokaal is alleen `DATABASE_URL`
nodig; de rest heeft een werkende standaardwaarde.

- Variabelen uit je shell gaan altijd voor op `.env`.
- `docker compose up` leest `.env` niet; `docker-compose.yml` zet zijn eigen
  waarden.
- `.env` wordt nooit gecommit.

In productie gelden strengere regels: `SESSION_SECRET` is verplicht (minstens
32 willekeurige tekens, `openssl rand -base64 48`) en de seed weigert te draaien.

## Problemen oplossen

**`pnpm dev` stopt met `P1001: Can't reach database server`**
De database draait niet. Start hem met `pnpm db:up`, of controleer
`DATABASE_URL` in `.env`.

**De API start niet: `The database is not at the schema this build requires`**
Er zijn migraties die nog niet zijn toegepast. Voer `pnpm db:deploy` uit.

**`Refusing to seed: SEED_PASSWORD is required …`**
De database staat niet op `localhost`. Zet `SEED_PASSWORD` (minstens 12 tekens).

**Aanmelden lukt niet met het demowachtwoord**
De database werd eerder met een ander wachtwoord geseed. Kies
`pnpm db:seed` met het gewenste `SEED_PASSWORD`, of gebruik het wachtwoord van
de eerste keer.

**Windows**
Gebruik WSL 2. De scripts gaan uit van een POSIX-shell.

## Projectstructuur

```
artifacts/
  api-server/     Express API — auth, sessies, klanten, readiness
  peppol-flow/    React-webapplicatie; bevat ook prisma/ (schema, migraties, seed)
  mockup-sandbox/ Replit-designcanvas (lokaal niet nodig)
lib/
  api-spec/       OpenAPI-contract — bron van waarheid voor de API
  api-client-react/, api-zod/  gegenereerd uit het contract
  password/       wachtwoordhashing
docs/             architectuur
```

Architectuurbeslissingen staan in `replit.md` en `docs/`.
