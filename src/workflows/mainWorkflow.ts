
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

type CategoryRunner = (shared: { matrixPage: any; logger: ReturnType<typeof createExecutionLogger> }) => Promise<number>;

type CategoryDefinition = {
  label: string;
  runner: CategoryRunner;
};

async function triggerPhoneLookup(orchestratorLogger: ReturnType<typeof createExecutionLogger>): Promise<void> {
  try {
    const triggerUrl = 'https://sctelelisting.solutionimmobiliere.ca/lookup';
    orchestratorLogger.step('SYSTEM', `Triggering phone lookup endpoint: ${triggerUrl}`);

    const response = await fetch(triggerUrl, { method: 'GET' });
    const status = response.status;
    const bodyText = await response.text().catch(() => '<unable to read response body>');

    if (response.ok) {
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
}

// Main business flow placeholder
export async function mainWorkflow(): Promise<void> {

  const orchestratorLogger = createExecutionLogger('all-categories');
  let totalLeadsProcessed = 0;
  const failedFirstPass: CategoryDefinition[] = [];

  const categories: CategoryDefinition[] = [
    { label: 'Unifamilial', runner: (shared) => scrapeResidential(shared) },
    { label: 'Copropriete', runner: (shared) => scrapeCopropriete(shared) },
    { label: 'Plex', runner: (shared) => scrapePlex(shared) },
    { label: 'Commercial', runner: (shared) => scrapeCommercial(shared) },
  ];

  const runCategoryOnce = async (label: string, runner: CategoryRunner, shared: { matrixPage: any; logger: ReturnType<typeof createExecutionLogger> }): Promise<number> => {
    orchestratorLogger.step('SYSTEM', `Starting category: ${label}`);
    const leads = await runner(shared);
    orchestratorLogger.step('SYSTEM', `Finished category: ${label} | leads=${leads}`);
    return leads;
  };

  const rerunCategoryWithFreshLogin = async (category: CategoryDefinition): Promise<void> => {
    let session: Awaited<ReturnType<typeof login>> | null = null;
    try {
      orchestratorLogger.step('SYSTEM', `Re-running failed category with fresh login: ${category.label}`);
      session = await login(APCIQ_USER, APCIQ_PASSWORD, orchestratorLogger);
      const shared = { matrixPage: session.matrixPage, logger: orchestratorLogger };
      const leads = await runCategoryOnce(`${category.label} (rerun)`, category.runner, shared);
      totalLeadsProcessed += leads;
      orchestratorLogger.step('SYSTEM', `Deferred rerun succeeded: ${category.label} | leads=${leads}`);
    } catch (error) {
      orchestratorLogger.error('SYSTEM', `Deferred rerun failed: ${category.label}`, error);
    } finally {
      if (session) {
        await session.browser.close().catch(() => null);
      }
    }
  };

  try {
    let sharedSession: Awaited<ReturnType<typeof login>> | null = null;
    try {
      orchestratorLogger.step('SYSTEM', 'Starting first pass for all categories using shared session.');
      sharedSession = await login(APCIQ_USER, APCIQ_PASSWORD, orchestratorLogger);
      const shared = { matrixPage: sharedSession.matrixPage, logger: orchestratorLogger };

      for (const category of categories) {
        try {
          const leads = await runCategoryOnce(category.label, category.runner, shared);
          totalLeadsProcessed += leads;
        } catch (categoryError) {
          failedFirstPass.push(category);
          orchestratorLogger.error(
            'SYSTEM',
            `Category failed during first pass and will be deferred for rerun: ${category.label}`,
            categoryError
          );
        }
      }
    } finally {
      if (sharedSession) {
        await sharedSession.browser.close().catch(() => null);
      }
    }

    if (failedFirstPass.length > 0) {
      orchestratorLogger.anomaly(
        'SYSTEM',
        `Deferred rerun queue: ${failedFirstPass.map((c) => c.label).join(', ')}`
      );
      for (const category of failedFirstPass) {
        await rerunCategoryWithFreshLogin(category);
      }
    } else {
      orchestratorLogger.step('SYSTEM', 'No category failed in first pass; deferred rerun phase skipped.');
    }

    await triggerPhoneLookup(orchestratorLogger);
  } catch (error) {
    orchestratorLogger.error('SYSTEM', 'Fatal orchestrator error.', error);
    throw error;
  } finally {
    orchestratorLogger.finalize(totalLeadsProcessed);
  }

  log('Main workflow completed.');
}
