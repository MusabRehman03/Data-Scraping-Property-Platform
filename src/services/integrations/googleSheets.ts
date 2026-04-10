import { getAppConfig } from '../../config/appConfig';
import { getGoogleClients } from './googleClient';

export type LeadRow = Record<string, string | number | boolean | null | undefined>;
export type ColumnMap = Record<string, string | number | boolean | null | undefined>;

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
