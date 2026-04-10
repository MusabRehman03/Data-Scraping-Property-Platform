# APCIQ / Centris Data Scraping Automation

This project automates lead extraction from APCIQ/Centris (Matrix), uploads listing documents to Google Drive, and appends lead rows to Google Sheets.

It runs a **single shared login session** and processes categories sequentially:

- `Unifamilial`
- `Copropriete`
- `Plex`
- `Commercial`

## What the automation does

For each listing, the scraper:

1. Reads listing details from Matrix.
2. Downloads listing documents and uploads them to Google Drive.
3. Captures Matrix PDF and uploads it to Drive.
4. Extracts owner/contact details.
5. Appends a structured row to Google Sheets.

## Project structure

- `src/index.ts` — app entrypoint
- `src/workflows/mainWorkflow.ts` — one-login orchestrator across all categories
- `src/services/auth/` — APCIQ/Centris login + OTP fetch
- `src/services/scraper/` — category scrapers
- `src/services/integrations/` — Google Drive / Sheets clients
- `src/config/` — environment/config wiring
- `src/utils/` — helpers (delay, formatters, logger)
- `logs/` — execution logs generated at runtime
- `downloads/` — temporary local files used during upload flow

## Prerequisites

- Node.js (LTS recommended)
- npm
- APCIQ/Centris credentials
- Google Drive + Google Sheets access configured
- Twilio credentials (if OTP retrieval is required)

## Environment setup

1. Copy environment template:
	 - `.env.example` → `.env`
2. Fill required values in `.env`.

### Minimum required variables

- `APCIQ_USERNAME` (or `APCIQ_USER`)
- `APCIQ_PASSWORD`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (path to service account JSON)
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

### Optional variables

- `GOOGLE_SHEETS_TAB_NAME`
- `GOOGLE_DRIVE_SHARED_DRIVE_ID`
- OAuth fallback fields:
	- `GOOGLE_CLIENT_ID`
	- `GOOGLE_CLIENT_SECRET`
	- `GOOGLE_REFRESH_TOKEN`
- Twilio OTP fields:
	- `TWILIO_SID` (or `TWILIO_ACCOUNT_SID`)
	- `TWILIO_AUTH_TOKEN`
	- `TWILIO_PHONE` (or `TWILIO_PHONE_NUMBER`)

- Webshare proxy fields (optional but recommended when client asks for consistent IP):
	- `WEBSHARE_PROXY_SERVER` (example: `http://82.23.96.252:7478`)
	- or `WEBSHARE_PROXY_HOST` + `WEBSHARE_PROXY_PORT`
	- `WEBSHARE_PROXY_USERNAME`
	- `WEBSHARE_PROXY_PASSWORD`

To keep the same egress IP between runs, use a static proxy endpoint or sticky session settings in Webshare.

## Install

```bash
npm install
```

## Run scripts

### Development mode (ts-node)

```bash
npm run dev
```

### Build + production run

```bash
npm run build
npm start
```

### Run one scraper directly (local)

```bash
npx ts-node src/services/scraper/unifamilial.ts
npx ts-node src/services/scraper/copropriete.ts
npx ts-node src/services/scraper/plex.ts
npx ts-node src/services/scraper/commercial.ts
```

Each direct scraper entrypoint performs login first, then runs only that category.

## Containerized run (recommended on VPS)

This project now supports running inside Docker for isolation from other scripts/processes.

### One command (build + run)

```bash
npm run container
```

### Build image

```bash
npm run docker:build
```

### Run one scraping execution

```bash
npm run docker:run
```

### Run one specific scraper in Docker

```bash
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/unifamilial.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/copropriete.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/plex.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/commercial.js
```

### Run (alias)

```bash
npm run docker:up
```

### Stop / cleanup

```bash
npm run docker:down
```

### Container runtime notes

- Uses a Playwright-ready base image.
- Loads environment from `.env`.
- Persists runtime output using mounted folders:
	- `./logs` → `/app/logs`
	- `./downloads` → `/app/downloads`
- Runs the production entrypoint (`npm start`) in an isolated container.
- Uses plain Docker CLI scripts (no Docker Compose plugin required).
- For direct single-scraper container runs, build first with `npm run build && npm run docker:build`.

## Outputs

- Runtime logs are written under `logs/`
- Temporary download artifacts are written under `downloads/`
- Drive folders are created under year-based path (for example: `YYYY/EXPIRED/<CENTRIS_NUMBER>`)

## Troubleshooting

- **Google `invalid_grant`**: refresh token is invalid/expired/revoked; regenerate OAuth credentials.
- **Missing env errors**: verify all required `.env` values are present and non-empty.
- **OTP not found**: verify Twilio credentials and target phone value.
- **No listing rows exported**: confirm Sheet tab and spreadsheet access permissions.

## Additional guide

For a detailed setup/run walkthrough, see `guide.md`.
