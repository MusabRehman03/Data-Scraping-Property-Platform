import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getLatestOtp } from './otp';
import { humanDelay } from '../../utils/delay';
import type { ExecutionLogger, LogAction } from '../../utils/logger';

export interface LoginSession {
  browser: Browser;
  context: BrowserContext;
  matrixPage: Page;
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

  let browser: Browser | null = null;

  try {
    logStep('LOGIN', 'Starting APCIQ/Centris shared login flow.');
    console.log('Login milestone: browser launched and authentication flow started.');

    const launchOptions: Parameters<typeof chromium.launch>[0] = { headless: false };
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
    const page1Promise = page.waitForEvent('popup');
    await humanDelay(page, 1000, 2000);
    await page.getByRole('link', { name: 'Outils Centris', exact: true }).click();
    const page1 = await page1Promise;
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

    await page1.waitForLoadState('domcontentloaded');
    await page1.waitForTimeout(10000);
    const didomiAgreeButton = page1.locator('#didomi-notice-agree-button');
    if (await didomiAgreeButton.isVisible().catch(() => false)) {
      await didomiAgreeButton.click({ timeout: 60_000 });
    }

    logStep('NAVIGATION', 'Opening Matrix popup.');
    console.log('Login milestone: launching Matrix session.');
    const page2Promise = page1.waitForEvent('popup');
    await humanDelay(page1, 1500, 2500);
    await page1.getByRole('link', { name: 'Matrix ' }).click();
    const page2 = await page2Promise;
    await humanDelay(page2, 2500, 4000);

    const tariffHeading = page2.getByRole('heading', { name: ' Tarif pour actes notariés' });
    if (await tariffHeading.isVisible().catch(() => false)) {
      await humanDelay(page2, 1000, 2000);
      await page2.getByRole('button', { name: 'Je l\'ai lu' }).click();
      await humanDelay(page2, 1000, 1500);
    }

    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(10000);
    const isAnotherLoginVisible = await page2.locator('.linkIcon.icon_ok').isVisible().catch(() => false);
    if (isAnotherLoginVisible) {
      await page2.locator('.linkIcon.icon_ok').click();
    }
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(10000);

    logStep('LOGIN', 'Shared login flow completed successfully.');
    console.log('Login milestone: Matrix session is ready for scraping.');
    return {
      browser,
      context,
      matrixPage: page2
    };
  } catch (error) {
    logError('LOGIN', 'Shared login flow failed.', error);
    if (browser) {
      await browser.close().catch(() => null);
    }
    throw error;
  }
}
