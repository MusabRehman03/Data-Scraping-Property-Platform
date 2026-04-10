import fs from 'fs';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { getAppConfig } from '../../config/appConfig';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let cachedClients: { sheets: sheets_v4.Sheets; drive: drive_v3.Drive } | null = null;

function ensureServiceAccountFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Google service account file not found: ${filePath}`);
  }
}

export function getGoogleClients(): { sheets: sheets_v4.Sheets; drive: drive_v3.Drive } {
  if (cachedClients) {
    return cachedClients;
  }

  const config = getAppConfig();
  let auth;

  if (config.googleRefreshToken && config.googleClientId && config.googleClientSecret) {
    // 🚀 Use OAuth2 Refresh Token Strategy
    auth = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      "https://developers.google.com/oauthplayground"
    );
    auth.setCredentials({
      refresh_token: config.googleRefreshToken
    });
  } else {
    // ⚙️ Fallback to standard Service Account Strategy
    ensureServiceAccountFile(config.googleServiceAccountJson);
    auth = new google.auth.GoogleAuth({
      keyFile: config.googleServiceAccountJson,
      scopes: GOOGLE_SCOPES,
    });
  }

  cachedClients = {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };

  return cachedClients;
}
