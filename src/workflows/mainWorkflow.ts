
import { createExecutionLogger, log } from '../utils/logger';
import { login } from '../services/auth/login';
import { scrapeResidential } from '../services/scraper/unifamilial';
import { scrapeCopropriete } from '../services/scraper/copropriete';
import { scrapePlex } from '../services/scraper/plex';
import { scrapeCommercial } from '../services/scraper/commercial';

const APCIQ_USER = process.env.APCIQ_USERNAME || process.env.APCIQ_USER || '';
const APCIQ_PASSWORD = process.env.APCIQ_PASSWORD || '';

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

    await safeRun('Unifamilial', () => scrapeResidential(shared));
    await safeRun('Copropriete', () => scrapeCopropriete(shared));
    await safeRun('Plex', () => scrapePlex(shared));
    await safeRun('Commercial', () => scrapeCommercial(shared));

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
