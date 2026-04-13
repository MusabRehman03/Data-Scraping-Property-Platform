
import { createExecutionLogger, log } from '../utils/logger';
import { login } from '../services/auth/login';
import { scrapeResidential } from '../services/scraper/unifamilial';
import { scrapeCopropriete } from '../services/scraper/copropriete';
import { scrapePlex } from '../services/scraper/plex';
import { scrapeCommercial } from '../services/scraper/commercial';

const APCIQ_USER = process.env.APCIQ_USERNAME || process.env.APCIQ_USER || '';
const APCIQ_PASSWORD = process.env.APCIQ_PASSWORD || '';

type PhoneLookupResponse = {
  status?: string;
  message?: string;
  sheet_id?: string;
  worksheet?: string;
  trigger_url?: string;
  log_file?: string;
  csv_log?: string;
  user?: string;
};

// Main business flow placeholder
export async function mainWorkflow(): Promise<void> {

  const orchestratorLogger = createExecutionLogger('all-categories');
  let totalLeadsProcessed = 0;
  let browserClosed = false;

  const safeRun = async (label: string, runner: () => Promise<number>) => {
    try {
      orchestratorLogger.step('SYSTEM', `Starting category: ${label}`);
      const leads = await runner();
      totalLeadsProcessed += leads;
      orchestratorLogger.step('SYSTEM', `Finished category: ${label} | leads=${leads}`);
    } catch (error) {
      orchestratorLogger.error('SYSTEM', `Category failed: ${label}`, error);
    }
  };

  try {
    const session = await login(APCIQ_USER, APCIQ_PASSWORD, orchestratorLogger);
    const shared = { matrixPage: session.matrixPage, logger: orchestratorLogger };

    // await safeRun('Unifamilial', () => scrapeResidential(shared));
    // await safeRun('Copropriete', () => scrapeCopropriete(shared));
    // await safeRun('Plex', () => scrapePlex(shared));
    // await safeRun('Commercial', () => scrapeCommercial(shared));

    // Always trigger the external phone lookup endpoint at the end of the run.
    try {
      const triggerUrl = 'https://sctelelisting.solutionimmobiliere.ca/lookup';
      orchestratorLogger.step('SYSTEM', `Triggering phone lookup endpoint: ${triggerUrl}`);
      // Use Playwright's APIRequestContext on the existing browser context to fire the unauthenticated request.
      // This avoids opening a new tab and reuses the current network environment.
      const response = await session.context.request.get(triggerUrl, { timeout: 60_000 });
      const status = response.status();
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch (e) {
        bodyText = '<unable to read response body>';
      }

      if (response.ok()) {
        let parsed: PhoneLookupResponse | null = null;
        try {
          parsed = JSON.parse(bodyText) as PhoneLookupResponse;
        } catch (_parseError) {
          parsed = null;
        }

        if (parsed) {
          orchestratorLogger.step(
            'SYSTEM',
            `Phone lookup response accepted by API gateway: httpStatus=${status} status=${parsed.status ?? 'unknown'} message=${parsed.message ?? 'n/a'}`
          );

          orchestratorLogger.step(
            'SYSTEM',
            `Phone lookup metadata: sheet_id=${parsed.sheet_id ?? 'n/a'} worksheet=${parsed.worksheet ?? 'n/a'} trigger_url=${parsed.trigger_url ?? triggerUrl} user=${parsed.user ?? 'n/a'}`
          );

          orchestratorLogger.step(
            'SYSTEM',
            `Phone lookup logs: log_file=${parsed.log_file ?? 'n/a'} csv_log=${parsed.csv_log ?? 'n/a'}`
          );

          if (parsed.status !== 'accepted') {
            orchestratorLogger.anomaly(
              'SYSTEM',
              `Phone lookup endpoint responded with unexpected status value: ${parsed.status ?? 'undefined'}`
            );
          }
        } else {
          orchestratorLogger.anomaly(
            'SYSTEM',
            `Phone lookup trigger returned non-JSON body: httpStatus=${status} bodyPreview=${String(bodyText).slice(0, 300)}`
          );
        }
      } else {
        orchestratorLogger.anomaly(
          'SYSTEM',
          `Phone lookup trigger returned non-OK status=${status} bodyPreview=${String(bodyText).slice(0, 300)}`
        );
      }
    } catch (triggerErr) {
      orchestratorLogger.error('SYSTEM', 'Failed to trigger phone lookup endpoint.', triggerErr);
    }

    await session.browser.close();
    browserClosed = true;
  } catch (error) {
    orchestratorLogger.error('SYSTEM', 'Fatal orchestrator error.', error);
    throw error;
  } finally {
    if (!browserClosed) {
      // If login failed before session creation there is no browser to close.
    }
    orchestratorLogger.finalize(totalLeadsProcessed);
  }

  log('Main workflow completed.');
}
