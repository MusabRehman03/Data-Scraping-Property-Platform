import { getAppConfig } from '../../config/appConfig';
import { getGoogleClients } from './googleClient';

export type LeadRow = Record<string, string | number | boolean | null | undefined>;
export type ColumnMap = Record<string, string | number | boolean | null | undefined>;
export type HeaderMap = Record<string, string | number | boolean | null | undefined>;

export async function appendRowsToSheet(rows: string[][]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const config = getAppConfig();
  const { sheets } = getGoogleClients();

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${config.googleSheetTabName}!A:ZZ`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows,
    },
  });
}

export async function appendLeadRow(lead: LeadRow): Promise<void> {
  const keys = Object.keys(lead);
  const values = keys.map((key) => normalizeCellValue(lead[key]));
  await appendRowsToSheet([values]);
}

// Example map: { A: 'Prospect', C: 'MLS123', F: '750000' }
export async function appendRowByColumns(columnMap: ColumnMap): Promise<void> {
  const entries = Object.entries(columnMap);
  if (entries.length === 0) {
    return;
  }

  const maxColumnIndex = Math.max(...entries.map(([column]) => columnToIndex(column)));
  const row = Array.from({ length: maxColumnIndex + 1 }, () => '');

  for (const [column, value] of entries) {
    row[columnToIndex(column)] = normalizeCellValue(value);
  }

  await appendRowsToSheet([row]);
}

export async function appendRowByHeaders(headerMap: HeaderMap): Promise<void> {
  const entries = Object.entries(headerMap);
  if (entries.length === 0) {
    return;
  }

  const config = getAppConfig();
  const { sheets } = getGoogleClients();

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${config.googleSheetTabName}!A1:ZZ1`,
  });

  const headers = (headerResponse.data.values?.[0] || []).map((h) => String(h || ''));
  if (headers.length === 0) {
    throw new Error('Sheet header row is empty. Cannot map values by heading.');
  }

  const headerIndexMap = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    headerIndexMap.set(normalizeHeader(headers[i]), i);
  }

  const missingHeaders: string[] = [];
  const targetIndexes: number[] = [];
  for (const [header] of entries) {
    const idx = headerIndexMap.get(normalizeHeader(header));
    if (idx === undefined) {
      missingHeaders.push(header);
      continue;
    }
    targetIndexes.push(idx);
  }

  if (missingHeaders.length > 0) {
    throw new Error(`Missing required sheet headers: ${missingHeaders.join(', ')}`);
  }

  const maxColumnIndex = Math.max(...targetIndexes);
  const row = Array.from({ length: maxColumnIndex + 1 }, () => '');
  for (const [header, value] of entries) {
    const idx = headerIndexMap.get(normalizeHeader(header));
    if (idx !== undefined) {
      row[idx] = normalizeCellValue(value);
    }
  }

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${config.googleSheetTabName}!A:ZZ`,
  });
  const nextRow = (existing.data.values?.length ?? 0) + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${config.googleSheetTabName}!A${nextRow}:ZZ${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row],
    },
  });
}

export async function getExistingValuesByHeader(headerName: string): Promise<string[]> {
  const config = getAppConfig();
  const { sheets } = getGoogleClients();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${config.googleSheetTabName}!A:ZZ`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((h) => String(h || ''));
  const headerIndex = headers.findIndex((header) => normalizeHeader(header) === normalizeHeader(headerName));

  if (headerIndex === -1) {
    throw new Error(`Missing required sheet header: ${headerName}`);
  }

  return rows
    .slice(1)
    .map((row) => normalizeReferenceValue(row[headerIndex]))
    .filter((value) => value.length > 0);
}

export async function getExistingReferenceNumbers(): Promise<Set<string>> {
  const values = await getExistingValuesByHeader('Reference Number');
  return new Set(values);
}

function normalizeCellValue(value: LeadRow[string]): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

function columnToIndex(column: string): number {
  const clean = column.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(clean)) {
    throw new Error(`Invalid column letter: ${column}`);
  }

  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    index = index * 26 + (clean.charCodeAt(i) - 64);
  }
  return index - 1;
}

function normalizeHeader(header: string): string {
  return String(header || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeReferenceValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim().toLowerCase();
}
