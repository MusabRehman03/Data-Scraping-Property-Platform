import fs from 'fs';
import path from 'path';

export function log(message: string): void {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const logPath = path.join(logsDir, 'execution.log');
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

export type LogAction = 'LOGIN' | 'OTP' | 'NAVIGATION' | 'SCRAPING' | 'EXPORT' | 'SYSTEM';

export interface ExecutionLogger {
  filePath: string;
  step: (action: LogAction, message: string) => void;
  anomaly: (action: LogAction, message: string) => void;
  error: (action: LogAction, message: string, error?: unknown) => void;
  finalize: (leadsProcessed: number) => void;
}

function ensureLogsDir(): string {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function safeTimestamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

function errorToText(error: unknown): string {
  if (!error) return 'Unknown error';
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function divider(char = '─', length = 58): string {
  return char.repeat(length);
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function isCategoryStart(message: string): string | null {
  const match = message.match(/^Starting category:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isCategoryEnd(message: string): { name: string; leads: number | null } | null {
  const match = message.match(/^Finished category:\s*([^|]+)(?:\|\s*leads=(\d+))?/i);
  if (!match) return null;
  return {
    name: match[1].trim(),
    leads: match[2] ? Number(match[2]) : null
  };
}

export function createExecutionLogger(filePrefix = 'execution'): ExecutionLogger {
  const startedAt = new Date();
  const logsDir = ensureLogsDir();
  const filePath = path.join(logsDir, `${filePrefix}-${safeTimestamp(startedAt)}.log`);

  let stepCounter = 0;
  let anomalyCount = 0;
  let errorCount = 0;
  let activeCategory: string | null = null;

  const anomalyDigest: string[] = [];
  const errorDigest: string[] = [];
  const categoryStartTimes = new Map<string, number>();
  const categoryStats = new Map<string, { leads: number; anomalies: number; errors: number; durationMs: number }>();

  const append = (line: string): void => {
    fs.appendFileSync(filePath, `${line}\n`);
  };

  append(divider('═'));
  append('🏁 APCIQ SCRAPER EXECUTION LOG');
  append(`Run ID       : ${path.basename(filePath, '.log')}`);
  append(`Start DateTime: ${startedAt.toISOString()}`);
  append('Status       : RUNNING');
  append(divider('═'));
  append('');

  return {
    filePath,
    step: (action: LogAction, message: string): void => {
      stepCounter += 1;
      append(`[${new Date().toISOString()}] [STEP ${String(stepCounter).padStart(3, '0')}] [${action}] ${message}`);

      if (action === 'SYSTEM') {
        const startedCategory = isCategoryStart(message);
        if (startedCategory) {
          activeCategory = startedCategory;
          categoryStartTimes.set(startedCategory, Date.now());
          if (!categoryStats.has(startedCategory)) {
            categoryStats.set(startedCategory, { leads: 0, anomalies: 0, errors: 0, durationMs: 0 });
          }
          append(divider());
          append(`📂 CATEGORY: ${startedCategory}`);
          append(divider());
        }

        const endedCategory = isCategoryEnd(message);
        if (endedCategory) {
          const stats = categoryStats.get(endedCategory.name) ?? { leads: 0, anomalies: 0, errors: 0, durationMs: 0 };
          const startedAtMs = categoryStartTimes.get(endedCategory.name);
          const durationMs = startedAtMs ? Date.now() - startedAtMs : stats.durationMs;
          stats.durationMs = durationMs;
          if (typeof endedCategory.leads === 'number') {
            stats.leads = endedCategory.leads;
          }
          categoryStats.set(endedCategory.name, stats);

          append(`✅ Category Complete: ${endedCategory.name}`);
          append(`   Leads: ${stats.leads} | Anomalies: ${stats.anomalies} | Errors: ${stats.errors} | Duration: ${formatDuration(stats.durationMs)}`);
          append('');
          if (activeCategory === endedCategory.name) {
            activeCategory = null;
          }
        }
      }
    },
    anomaly: (action: LogAction, message: string): void => {
      anomalyCount += 1;
      append(`[${new Date().toISOString()}] [ANOMALY] [${action}] ${message}`);
      anomalyDigest.push(`[${action}] ${message}`);
      if (activeCategory && categoryStats.has(activeCategory)) {
        const stats = categoryStats.get(activeCategory)!;
        stats.anomalies += 1;
        categoryStats.set(activeCategory, stats);
      }
    },
    error: (action: LogAction, message: string, error?: unknown): void => {
      errorCount += 1;
      append(`[${new Date().toISOString()}] [ERROR] [${action}] ${message}`);
      errorDigest.push(`[${action}] ${message}`);
      if (activeCategory && categoryStats.has(activeCategory)) {
        const stats = categoryStats.get(activeCategory)!;
        stats.errors += 1;
        categoryStats.set(activeCategory, stats);
      }
      if (error) {
        append(errorToText(error));
      }
    },
    finalize: (leadsProcessed: number): void => {
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      append('');
      append(divider('═'));
      append('📊 EXECUTION SUMMARY');
      append(divider('═'));
      append(`End DateTime    : ${endedAt.toISOString()}`);
      append(`Total Duration  : ${formatDuration(durationMs)}`);
      append(`Leads Processed : ${leadsProcessed}`);
      append(`Anomalies       : ${anomalyCount}`);
      append(`Errors          : ${errorCount}`);
      append(`Status          : ${errorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'}`);

      if (anomalyDigest.length) {
        append('');
        append('🧾 Anomaly Digest');
        anomalyDigest.forEach((item) => append(`- ${item}`));
      }

      if (errorDigest.length) {
        append('');
        append('🧾 Error Digest');
        errorDigest.forEach((item) => append(`- ${item}`));
      }
    }
  };
}
