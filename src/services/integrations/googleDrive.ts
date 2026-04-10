import fs from 'fs';
import path from 'path';
import { drive_v3 } from 'googleapis';
import { getAppConfig } from '../../config/appConfig';
import { getGoogleClients } from './googleClient';

export async function ensureDriveFolder(
  name: string,
  parentFolderId: string,
): Promise<string> {
  const config = getAppConfig();
  const { drive } = getGoogleClients();

  const queryParts = [
    `name = '${escapeQueryValue(name)}'`,
    `'${parentFolderId}' in parents`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
  ];

  const existing = await drive.files.list({
    q: queryParts.join(' and '),
    fields: 'files(id, name)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: config.googleDriveSharedDriveId ? 'drive' : 'user',
    driveId: config.googleDriveSharedDriveId,
  });

  const folder = existing.data.files?.[0];
  if (folder?.id) {
    return folder.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  const folderId = created.data.id;
  if (!folderId) {
    throw new Error(`Failed to create Drive folder: ${name}`);
  }

  return folderId;
}

export async function ensureDriveFolderPath(pathSegments: string[]): Promise<string> {
  const config = getAppConfig();

  let currentParent = config.googleDriveRootFolderId;
  for (const segment of pathSegments) {
    currentParent = await ensureDriveFolder(segment, currentParent);
  }
  return currentParent;
}

export async function uploadToDrive(
  filePath: string,
  parentFolderId?: string,
): Promise<{ id: string; webViewLink?: string }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist for upload: ${filePath}`);
  }

  const config = getAppConfig();
  const { drive } = getGoogleClients();
  const fileName = path.basename(filePath);
  const targetParent = parentFolderId ?? config.googleDriveRootFolderId;

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [targetParent],
    },
    media: {
      mimeType: detectMimeType(filePath),
      body: fs.createReadStream(filePath),
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });

  const id = created.data.id;
  if (!id) {
    throw new Error(`Failed to upload file to Drive: ${filePath}`);
  }

  return {
    id,
    webViewLink: created.data.webViewLink ?? undefined,
  };
}

function escapeQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

function detectMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mimeByExtension: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return mimeByExtension[extension] ?? 'application/octet-stream';
}
