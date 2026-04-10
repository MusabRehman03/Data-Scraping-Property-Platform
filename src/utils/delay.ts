import { Page, Locator } from '@playwright/test';

// Human-like delay helper
export function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

/**
 * Simulates a human-like delay by waiting a random amount of time between min and max.
 * @param p Playwright Page or Locator object
 * @param min Minimum wait time in ms
 * @param max Maximum wait time in ms
 */
export const humanDelay = async (p: Page | Locator | any, min = 1000, max = 3000) => {
  const waitTime = Math.floor(Math.random() * (max - min + 1)) + min;
  if (typeof p.waitForTimeout === 'function') {
    await p.waitForTimeout(waitTime);
  } else {
    await delay(waitTime);
  }
};
