import path from 'path';
import './env';

export type AppConfig = {
  googleServiceAccountJson: string;
  googleSpreadsheetId: string;
  googleSheetTabName: string;
  googleDriveRootFolderId: string;
  googleDriveSharedDriveId?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveFromProject(relativeOrAbsolutePath: string): string {
  if (path.isAbsolute(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath;
  }
  return path.resolve(process.cwd(), relativeOrAbsolutePath);
}

export function getAppConfig(): AppConfig {
  return {
    googleServiceAccountJson: resolveFromProject(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || 'src/config/service-account.json'),
    googleSpreadsheetId: requireEnv('GOOGLE_SHEETS_SPREADSHEET_ID'),
    googleSheetTabName: process.env.GOOGLE_SHEETS_TAB_NAME?.trim() || 'Sheet1',
    googleDriveRootFolderId: requireEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID'),
    googleDriveSharedDriveId: process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim() || undefined,
    googleClientId: process.env.GOOGLE_CLIENT_ID?.trim(),
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN?.trim(),
    twilioAccountSid: process.env.TWILIO_SID?.trim() || process.env.TWILIO_ACCOUNT_SID?.trim(),
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim(),
    twilioPhoneNumber: process.env.TWILIO_PHONE?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim(),
  };
}
