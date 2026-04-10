# Google Cloud Setup Guide (OAuth 2.0)

This guide provides the exact step-by-step process to set up Google Drive and Google Sheets integrations on a brand new Google account (free `@gmail.com` or Workspace). Because Google enforces a zero-byte storage quota on Service Accounts for free users, we use the **OAuth 2.0 Web Application** method to obtain a **Refresh Token**.

This allows the backend Node.js script to run continuously and write/upload files under the user's *own* storage quota.

---

## Step 1: Create a Google Cloud Project & Enable APIs

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with the **Client's Google Account**.
3. Create a new project (e.g., "Data Scraper Project").
4. Make sure your new project is selected in the top-left dropdown.
5. In the left sidebar, go to **APIs & Services > Library**.
6. Search for and click **Enable** on both:
   * **Google Drive API**
   * **Google Sheets API**

---

## Step 2: Configure the OAuth Consent Screen

*If you don't do this, Google will outright block you from logging in as a "Test User" later.*

1. In the left sidebar, click **APIs & Services > OAuth consent screen**.
2. Choose the User Type and click **Create**:
   * **Internal**: Choose this if the client is using a paid **Google Workspace** account (e.g., `name@company.com`). This makes things much easier because it automatically trusts users within the company and you can skip adding Test Users.
   * **External**: Choose this if the client is using a free `@gmail.com` account.
3. **App Information**: Enter an App Name (e.g., "Scraper App") and select a User Support Email (the client's email).
4. **Developer Contact Information**: Enter the client's email again. Click **Save and Continue**.
5. **Scopes**: Skip this page. Click **Save and Continue**.
6. **Test Users**: Click **+ ADD USERS**. Add the **exact email address** the client is currently logged into. Click **Save and Continue**.
7. Click **Back to Dashboard**.

---

## Step 3: Create OAuth Credentials

1. In the left sidebar, click **APIs & Services > Credentials**.
2. Click **+ CREATE CREDENTIALS** at the top and select **OAuth client ID**.
3. **Application Type**: Select **Web application** *(CRITICAL: Do not select Desktop!)*.
4. **Name**: Enter any name (e.g., "Web Uploader").
5. Under **Authorized redirect URIs**, click **+ ADD URI**.
6. Paste exactly this URL: `https://developers.google.com/oauthplayground`
7. Click **CREATE**.
8. A popup will appear with your **Client ID** and **Client Secret**. Copy BOTH of these into a notepad immediately.

---

## Step 4: Get Your Refresh Token

1. Open a new tab and go to the [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the **Gear icon (⚙️)** in the top right corner.
3. Check the box that says **"Use your own OAuth credentials"**.
4. Paste your **Client ID** and **Client Secret** into the boxes.
5. Close the popup (click the Gear icon again).
6. On the left side (Step 1), input your own scopes in the "Input your own scopes" box at the bottom. Separate them with a space:
   ```text
   https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets
   ```
7. Click **Authorize APIs**.
8. You will be redirected to a Google Sign-in screen. Select the Client's Google account.
   * *Note: If you see a warning saying "Google hasn't verified this app", click "Advanced" at the bottom left, then click "Go to [App Name] (unsafe)".*
9. Click **Continue** / **Allow** to grant permission.
10. You will be redirected back to the Playground.
11. Click the blue **Exchange authorization code for tokens** button.
12. Look in the right-hand panel for the `"refresh_token"`. Copy this value (it usually starts with `1//0...`).

---

## Step 5: Preparing the Drive Folder & Google Sheet

1. **Google Sheet**: Create a new Google Sheet on the client's account.
   * Look at the URL. Copy the Spreadsheet ID.
   * Example: `https://docs.google.com/spreadsheets/d/`**`1KQ_1RA8Pi1d8d9oQm_s11uhAi8vg37MFTpcPi5PFDcM`**`/edit`
   * Keep track of the Tab Name (usually `Sheet1`, or "Feuille 1" if in French).
   * Ensure headers like columns D, E, F... BC are ready if needed.
2. **Google Drive**: Create a new folder on the client's Drive (e.g., "Scraped Data ROOT").
   * Open the folder. Look at the URL to get the Folder ID.
   * Example: `https://drive.google.com/drive/folders/`**`1AubnRZyvIBTiWwjiG0UAXsHyKE4wqw47`**

---

## Step 6: Update the Application Configuration (`.env`)

Take all the IDs and Tokens you gathered above and set them in the `.env` file of the Node.js application:

```properties
# Google Services - Workspace Configuration
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here
GOOGLE_SHEETS_TAB_NAME=Sheet1
GOOGLE_DRIVE_ROOT_FOLDER_ID=your_drive_folder_id_here

# Google OAuth2 Credentials
GOOGLE_CLIENT_ID=your_client_id_from_step_3.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_from_step_3
GOOGLE_REFRESH_TOKEN=1//09your_refresh_token_from_step_4...
```

*Note: You no longer need `GOOGLE_SERVICE_ACCOUNT_JSON` since the OAuth2 token completely handles authentication on behalf of the user's active quota.*

---
**Done!** Run the application to verify. It will now automatically mint fresh `access_tokens` using the `refresh_token` without expiring and write to files using the user's 15GB free-tier quota.
