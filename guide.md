# Setup and Run Guide

This guide walks you through full setup and day-to-day execution of the APCIQ/Centris scraping scripts.

## 1) Quick architecture

Execution flow:

1. `src/index.ts` starts the app.
2. `src/workflows/mainWorkflow.ts` creates one shared login session.
3. Scrapers run sequentially:
   - `src/services/scraper/unifamilial.ts`
   - `src/services/scraper/copropriete.ts`
   - `src/services/scraper/plex.ts`
   - `src/services/scraper/commercial.ts`
4. Data and docs are exported to Google Sheets + Google Drive.

## 2) Prerequisites

- Node.js (LTS recommended)
- npm
- APCIQ/Centris credentials
- Google APIs enabled and credentials prepared
- Twilio setup (only if OTP polling is needed)

## 3) Install dependencies

```bash
npm install
```

## 4) Configure environment

Create `.env` from template:

```bash
cp .env.example .env
```

Fill at least these required variables by using nano or other options:

# Example environment variables
- `APCIQ_USERNAME`
- `APCIQ_PASSWORD`
- `TWILIO_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE`

# Google integrations
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_TAB_NAME`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_DRIVE_SHARED_DRIVE_ID`

# Optional: Webshare proxy (for consistent client-facing IP)
- `WEBSHARE_PROXY_SERVER` (example: `http://82.23.96.252:7478`)
- or `WEBSHARE_PROXY_HOST` + `WEBSHARE_PROXY_PORT`
- `WEBSHARE_PROXY_USERNAME`
- `WEBSHARE_PROXY_PASSWORD`

If your client requires the same IP every run, configure a static endpoint or sticky session in Webshare.

# For OAuth2 Playground credentials
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

## 5) Run the automation

### Option A: Development run

```bash
npm run dev
```

### Option B: Build and run (production style)

```bash
npm run build
npm start
```

### Option C: Run one category directly

```bash
npx ts-node src/services/scraper/unifamilial.ts
npx ts-node src/services/scraper/copropriete.ts
npx ts-node src/services/scraper/plex.ts
npx ts-node src/services/scraper/commercial.ts
```

Each direct scraper entrypoint performs login first, then runs only that category.

## 6) Optional: Run one category inside Docker

Build artifacts and image first:

```bash
npm run build
npm run docker:build
```

Then run one specific category in isolation:

```bash
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/unifamilial.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/copropriete.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/plex.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/commercial.js
```

## 7) Where to check outputs

- Console: milestone progress per listing
- `logs/`: execution log files
- `downloads/`: temporary files used during upload process
- Google Drive: listing document folders and Matrix PDFs
- Google Sheets: appended lead rows

## 8) Common failure cases

### `invalid_grant` from Google APIs

Cause: OAuth refresh token is invalid, expired, revoked, or mismatched.

Fix:
- Regenerate refresh token with correct OAuth client
- Confirm `.env` has matching `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

### Missing credentials error

Cause: required `.env` variables are missing.

Fix:
- Recheck all required fields
- Confirm file path in `GOOGLE_SERVICE_ACCOUNT_JSON` is valid

### OTP retrieval timeout

Cause: SMS not received or Twilio configuration mismatch.

Fix:
- Validate Twilio credentials
- Verify phone number format and account access

### No rows in Google Sheets

Cause: wrong sheet ID/tab name or insufficient permissions.

Fix:
- Confirm `GOOGLE_SHEETS_SPREADSHEET_ID`
- Confirm `GOOGLE_SHEETS_TAB_NAME`

## 9) Operational notes

- Keep only one long scraper run at a time to avoid session conflicts.
- Logs are your primary source for run diagnostics.
- If automation is interrupted, rerun from the standard entry (`npm run dev` or `npm start` or `npm run container` for containerized execution via docker).

## 10) Containerized execution (VPS-safe mode)

To avoid interference with other scripts on the VPS, run this scraper in a dedicated container.

### One command (recommended)

```bash
npm run container
```

### Build container image

```bash
npm run docker:build
```

### Run all categories at once (full workflow)

This runs `dist/index.js` inside the container (shared login + sequential run of all categories).

```bash
npm run docker:run
```

### Run (alias)

```bash
npm run docker:up
```

### Run one single category at a time (inside container)

Build first (if not already built):

```bash
npm run build
npm run docker:build
```

Then run only one category:

```bash
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/unifamilial.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/copropriete.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/plex.js
docker run --rm --env-file .env -v "$(pwd)/logs:/app/logs" -v "$(pwd)/downloads:/app/downloads" --shm-size=2g apciq-centris-scraper node dist/services/scraper/commercial.js
```

### Stop and remove old scraper containers

```bash
npm run docker:down
```

> This project uses plain Docker CLI scripts and does not require Docker Compose plugin support.

### What gets isolated

- Node runtime and project dependencies
- Playwright browser runtime
- Environment scope loaded from `.env`

### What remains persistent on host

- `./logs` (execution logs)
- `./downloads` (temporary file artifacts)

### Suggested VPS cron strategy

Use a scheduled job that triggers:

```bash
cd /path/to/project && npm run docker:run
```

This ensures each run starts clean and exits clean.
