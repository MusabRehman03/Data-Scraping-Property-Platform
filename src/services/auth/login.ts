import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getLatestOtp } from './otp';
import { humanDelay } from '../../utils/delay';
import type { ExecutionLogger, LogAction } from '../../utils/logger';

export interface LoginSession {
  browser: Browser;
  context: BrowserContext;
  matrixPage: Page;
}

const LOGIN_MAX_ATTEMPTS = 3;
const LOGIN_ATTEMPT_TIMEOUT_MS = 300_000; // 5 minutes per attempt, configurable via env var
const LOGIN_POPUP_TIMEOUT_MS = 60_000;
const LOGIN_RETRY_BASE_DELAY_MS = 5_000; // Base delay for retries, multiplied by attempt number

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isRetryableLoginError(error: unknown): boolean {
  const asAny = error as any;
  const errorName = String(asAny?.name || '');
  const errorMessage = String(asAny?.message || '');
  const errorStack = String(asAny?.stack || '');
  const fallbackText = (() => {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error || '');
    }
  })();

  const text = `${errorName} ${errorMessage} ${errorStack} ${fallbackText}`.trim();
  const normalized = text.toLowerCase();

  const retryableSignals = [
    'timeout',
    'timed out',
    'navigation',
    'net::',
    'network',
    'target closed',
    'browser has been closed',
    'socket hang up',
    'econnreset',
    'etimedout',
    'eai_again',
    'popup',
    'protocol error',
    'waitforevent',
    'exceeded while waiting for event',
  ];

  return retryableSignals.some((signal) => normalized.includes(signal));
}

export async function login(username: string, password: string, logger?: ExecutionLogger): Promise<LoginSession> {
  const pinnedUserAgent =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
  const proxyServerFromEnv = process.env.WEBSHARE_PROXY_SERVER?.trim();
  const proxyHost = process.env.WEBSHARE_PROXY_HOST?.trim();
  const proxyPort = process.env.WEBSHARE_PROXY_PORT?.trim();
  const proxyUsername = process.env.WEBSHARE_PROXY_USERNAME?.trim();
  const proxyPassword = process.env.WEBSHARE_PROXY_PASSWORD?.trim();

  const proxyServer = proxyServerFromEnv || ((proxyHost && proxyPort) ? `http://${proxyHost}:${proxyPort}` : undefined);

  if ((proxyHost && !proxyPort) || (!proxyHost && proxyPort)) {
    throw new Error('Incomplete Webshare proxy config. Set both WEBSHARE_PROXY_HOST and WEBSHARE_PROXY_PORT.');
  }

  if ((proxyUsername && !proxyPassword) || (!proxyUsername && proxyPassword)) {
    throw new Error('Incomplete Webshare proxy credentials. Set both WEBSHARE_PROXY_USERNAME and WEBSHARE_PROXY_PASSWORD.');
  }

  const logStep = (action: LogAction, message: string): void => {
    logger?.step(action, message);
    console.log(message);
  };

  const logAnomaly = (action: LogAction, message: string): void => {
    logger?.anomaly(action, message);
    console.warn(message);
  };

  const logError = (action: LogAction, message: string, error?: unknown): void => {
    logger?.error(action, message, error);
    console.error(message, error ?? '');
  };

  if (!username || !password) {
    throw new Error('Missing APCIQ credentials in .env. Required: APCIQ_USERNAME (or APCIQ_USER) and APCIQ_PASSWORD.');
  }

  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt++) {
    let browser: any = null;

    try {
      logStep('LOGIN', `Starting APCIQ/Centris shared login flow (attempt ${attempt}/${LOGIN_MAX_ATTEMPTS}).`);
      console.log('Login milestone: browser launched and authentication flow started.');

      const session = await withTimeout((async (): Promise<LoginSession> => {
        const launchOptions: Parameters<typeof chromium.launch>[0] = { headless: true };
        if (proxyServer) {
          launchOptions.proxy = {
            server: proxyServer,
            username: proxyUsername || undefined,
            password: proxyPassword || undefined
          };
          console.log(`Login milestone: Webshare proxy enabled (${proxyServer}).`);
        }

        browser = await chromium.launch(launchOptions);
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          locale: 'en-CA',
          timezoneId: 'America/Toronto',
          userAgent: pinnedUserAgent
        });
        context.setDefaultTimeout(60_000);
        context.setDefaultNavigationTimeout(60_000);
        const page = await context.newPage();

        logStep('NAVIGATION', 'Navigating to APCIQ.');
        await page.goto('https://apciq.ca/');
        await humanDelay(page, 1500, 2500);

        const consentButton = page.getByRole('button', { name: 'Autoriser tout' });
        if (await consentButton.isVisible().catch(() => false)) {
          await consentButton.click();
          await humanDelay(page, 1000, 2000);
        }

        const accessLink = page.getByRole('link', { name: 'Accès membres' });
        await accessLink.waitFor({ state: 'visible', timeout: 60_000 });
        await humanDelay(page, 1000, 1500);
        await accessLink.click();

        const userBox = page.getByRole('textbox', { name: "Code d'utilisateur" });
        await userBox.waitFor({ state: 'visible', timeout: 60_000 });
        await humanDelay(page, 1000, 2000);
        await userBox.click();
        await humanDelay(page, 500, 1000);
        await userBox.fill(username);

        const passBox = page.getByRole('textbox', { name: 'Mot de passe' });
        await passBox.waitFor({ state: 'visible', timeout: 60_000 });
        await humanDelay(page, 1000, 2000);
        await passBox.click();
        await humanDelay(page, 500, 1000);
        await passBox.fill(password);

        const loginBtn = page.getByRole('button', { name: 'Connexion' });
        await loginBtn.waitFor({ state: 'visible', timeout: 60_000 });
        await humanDelay(page, 1500, 2500);
        await loginBtn.click();
        await humanDelay(page, 2000, 3000);
        console.log('Login milestone: APCIQ credentials submitted.');

        const twoFABox = page.getByRole('textbox', { name: 'Entrez le code à 6 chiffres' });
        if (await twoFABox.isVisible().catch(() => false)) {
          logStep('OTP', '2FA required, waiting for OTP from Twilio.');
          console.log('Login milestone: OTP challenge detected.');
          await humanDelay(page, 1000, 2000);
          const otpCode = await getLatestOtp();

          await twoFABox.click();
          await twoFABox.fill(otpCode);
          await humanDelay(page, 500, 1500);
          await page.getByRole('button', { name: 'Continuer' }).click();
          await humanDelay(page, 2000, 3000);
          console.log('Login milestone: OTP submitted successfully.');
        } else {
          logAnomaly('OTP', '2FA textbox not visible (session may already be trusted).');
        }

        logStep('NAVIGATION', 'Opening Centris tools popup.');
        console.log('Login milestone: opening Centris portal.');
        await humanDelay(page, 1000, 2000);
        const [page1] = await Promise.all([
          page.waitForEvent('popup', { timeout: LOGIN_POPUP_TIMEOUT_MS }),
          page.getByRole('link', { name: 'Outils Centris', exact: true }).click(),
        ]);
        await humanDelay(page1, 2000, 3000);

        await page1.getByRole('textbox', { name: 'Code d\'utilisateur' }).click();
        await humanDelay(page1, 500, 1000);
        await page1.getByRole('textbox', { name: 'Code d\'utilisateur' }).fill(username);
        await humanDelay(page1, 1000, 1500);
        await page1.getByRole('textbox', { name: 'Mot de passe' }).click();
        await humanDelay(page1, 1000, 2000);
        await page1.getByRole('textbox', { name: 'Mot de passe' }).fill(password);
        await humanDelay(page1, 1000, 2000);
        await page1.getByRole('button', { name: 'Connexion' }).click();
        await humanDelay(page1, 2000, 3500);
        console.log('Login milestone: Centris credentials submitted.');

        await page1.waitForLoadState('domcontentloaded', { timeout: 60_000 });
        await page1.waitForTimeout(10000);
        const didomiAgreeButton = page1.locator('#didomi-notice-agree-button');
        if (await didomiAgreeButton.isVisible().catch(() => false)) {
          await didomiAgreeButton.click({ timeout: 60_000 });
        }

        const dontShowAgainButton = page1.getByRole('button', { name: 'Ne plus afficher', exact: true });
        if (await dontShowAgainButton.isVisible().catch(() => false)) {
          await dontShowAgainButton.click({ timeout: 60_000 });
        }

        logStep('NAVIGATION', 'Opening Matrix popup.');
        console.log('Login milestone: launching Matrix session.');
        await humanDelay(page1, 1500, 2500);
        const [page2] = await Promise.all([
          page1.waitForEvent('popup', { timeout: LOGIN_POPUP_TIMEOUT_MS }),
          page1.getByRole('link', { name: 'Matrix ' }).click(),
        ]);
        await humanDelay(page2, 2500, 4000);

        const tariffHeading = page2.getByRole('heading', { name: ' Tarif pour actes notariés' });
        if (await tariffHeading.isVisible().catch(() => false)) {
          await humanDelay(page2, 1000, 2000);
          await page2.getByRole('button', { name: 'Je l\'ai lu' }).click();
          await humanDelay(page2, 1000, 1500);
        }

        await page2.waitForLoadState('domcontentloaded', { timeout: 60_000 });
        await page2.waitForTimeout(10000);
        const isAnotherLoginVisible = await page2.locator('.linkIcon.icon_ok').isVisible().catch(() => false);
        if (isAnotherLoginVisible) {
          await page2.locator('.linkIcon.icon_ok').click();
        }
        await page2.waitForLoadState('domcontentloaded', { timeout: 60_000 });
        await page2.waitForTimeout(10000);

        logStep('LOGIN', 'Shared login flow completed successfully.');
        console.log('Login milestone: Matrix session is ready for scraping.');
        return {
          browser,
          context,
          matrixPage: page2
        };
      })(), LOGIN_ATTEMPT_TIMEOUT_MS, `Login attempt timed out after ${LOGIN_ATTEMPT_TIMEOUT_MS}ms`);

      if (attempt > 1) {
        logAnomaly('LOGIN', `Login succeeded on retry attempt ${attempt}/${LOGIN_MAX_ATTEMPTS}.`);
      }

      return session;
    } catch (error) {
      logError('LOGIN', `Shared login flow failed (attempt ${attempt}/${LOGIN_MAX_ATTEMPTS}).`, error);
      if (browser && typeof browser.close === 'function') {
        await browser.close().catch(() => null);
      }

      const retryable = isRetryableLoginError(error);
      const hasAttemptsLeft = attempt < LOGIN_MAX_ATTEMPTS;
      logAnomaly(
        'LOGIN',
        `Login retry decision: retryable=${retryable} hasAttemptsLeft=${hasAttemptsLeft} (attempt ${attempt}/${LOGIN_MAX_ATTEMPTS}).`
      );
      if (!retryable || !hasAttemptsLeft) {
        throw error;
      }

      const waitMs = LOGIN_RETRY_BASE_DELAY_MS * attempt;
      logAnomaly('LOGIN', `Retrying login after transient error in ${waitMs}ms (next attempt ${attempt + 1}/${LOGIN_MAX_ATTEMPTS}).`);
      await wait(waitMs);
    }
  }

  throw new Error('Login attempts exhausted.');
}
