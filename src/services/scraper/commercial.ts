import { type Request, type Response } from '@playwright/test';
import { ensureDriveFolderPath, uploadToDrive } from '../integrations/googleDrive';
import { appendRowByHeaders } from '../integrations/googleSheets';
import { login } from '../auth/login';
import { humanDelay } from '../../utils/delay';
import {
  formatPrice,
  extractFirstWord,
  formatCentrisNumber,
  parseStreetAddress,
  parseCityAndZip,
  parseFullName
} from '../../utils/formatters';
import { createExecutionLogger, type ExecutionLogger, type LogAction } from '../../utils/logger';
import type { SharedScraperContext } from './shared';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const APCIQ_USER = process.env.APCIQ_USERNAME || process.env.APCIQ_USER || '';
const APCIQ_PASSWORD = process.env.APCIQ_PASSWORD || '';

export async function scrapeCommercial(shared?: SharedScraperContext): Promise<number> {
  if (!shared) {
    throw new Error('Shared session is required. Run via orchestrator or initialize login session first.');
  }

  const logger: ExecutionLogger = shared?.logger ?? createExecutionLogger('commercial');
  const ownsLogger = !shared?.logger;
  let leadsProcessed = 0;
  const infoLog = (message: string): void => {
    globalThis.console.log(message);
  };
  const console = { ...globalThis.console, log: (..._args: unknown[]) => undefined };

  const logStep = (action: LogAction, message: string): void => {
    infoLog(message);
    logger.step(action, message);
  };

  const logAnomaly = (action: LogAction, message: string): void => {
    console.warn(message);
    logger.anomaly(action, message);
  };

  const logError = (action: LogAction, message: string, error?: unknown): void => {
    console.error(message, error ?? '');
    logger.error(action, message, error);
  };

  const page2 = shared.matrixPage;

  try {
    logStep('SYSTEM', 'Starting commercial script execution (shared session).');
    await page2.goto('https://matrix.centris.ca/Matrix/Recherche/Propri%C3%A9t%C3%A9commercialeouindustrielle/G%C3%A9n%C3%A9rale');

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getDate()).padStart(2, '0');
    const searchDateValue = `${yyyy}${mm}${dd}+`;

    await page2.locator('input[name="Fm101_Ctrl3425_TB"]').click();
    await humanDelay(page2, 1000, 1500);
    await page2.locator('input[name="Fm101_Ctrl3425_TB"]').fill(searchDateValue);
    await humanDelay(page2, 1500, 2000);

    await page2.locator('#m_ucSearchButtons_m_lbSearch').click();
    await humanDelay(page2, 3000, 4500);

    const returnToResultsGrid = async () => {
      const listingLocator = page2.locator("td.d15879m6 a[data-mtx-track='Results - In-Display Full Link Click']");
      if (await listingLocator.first().isVisible().catch(() => false)) return;

      await page2.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await humanDelay(page2, 2500, 4500);
      await listingLocator.first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => null);

      if (!await listingLocator.first().isVisible().catch(() => false)) {
        logAnomaly('NAVIGATION', 'Listing grid not visible after single goBack.');
      }
    };

    const processOpenedListing = async (listingId: string, pageIndex: number, listingIndex: number) => {
      logStep('SCRAPING', `Processing listing ${listingId} (Page ${pageIndex}, Index ${listingIndex + 1}).`);

      const rawPrice = await page2.locator('.field.d15835m20').first().textContent();
      const price = rawPrice
        ? (() => {
          const dollarIndex = rawPrice.indexOf('$');
          if (dollarIndex >= 0) {
            const pickedPrice = rawPrice.slice(0, dollarIndex);
            return pickedPrice.replace(/\s+/g, '');
          }
          return formatPrice(rawPrice);
        })()
        : null;
      const rawCentris = await page2.locator('.formula.field.d15835m5').first().textContent();
      const centrisNumber = rawCentris ? extractFirstWord(rawCentris) : null;
      const rawLotNumber = await page2.locator('.wrapped-field').first().textContent();
      const lotNumber = formatCentrisNumber(rawLotNumber) || null;

      const addressFields = await page2.locator('.field.d15835m20').allTextContents();
      const {
        streetNumber: otherStreetNumber,
        streetName: otherStreetName,
        appartment: otherAppartment,
      } = parseStreetAddress(addressFields[2]);

      const otherCity = addressFields[3];
      const otherZip = addressFields[4];
      infoLog(`Listing ${listingId}: data scraped.`);

      const currentYear = new Date().getFullYear().toString();
      const folderId = await ensureDriveFolderPath([currentYear, 'EXPIRED', centrisNumber || 'UNKNOWN']);
      const driveFolderUrl = `https://drive.google.com/drive/folders/${folderId}`;

      const documentLinks = page2.locator(".formula.field.d15899m6 a[data-mtx-track='Results - In-Display Popup Link Click']");
      const docCount = await documentLinks.count();
      let docsUploaded = 0;
      infoLog(`Listing ${listingId}: found ${docCount} document link(s).`);

      const getExtFromMime = (mimeRaw: string) => {
        const mime = (mimeRaw || '').toLowerCase().split(';')[0].trim();
        const mimeMap: Record<string, string> = {
          'application/pdf': '.pdf',
          'image/jpeg': '.jpg',
          'image/jpg': '.jpg',
          'image/png': '.png',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'image/tiff': '.tiff',
          'image/bmp': '.bmp',
          'application/msword': '.doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'application/vnd.ms-excel': '.xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'application/vnd.ms-powerpoint': '.ppt',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
          'text/plain': '.txt'
        };
        return mimeMap[mime] || '';
      };

      const getExtFromBuffer = (buffer: Buffer) => {
        if (!buffer || buffer.length < 4) return '';
        const hex4 = buffer.subarray(0, 4).toString('hex').toLowerCase();
        const hex8 = buffer.subarray(0, 8).toString('hex').toLowerCase();
        const header5 = buffer.subarray(0, 5).toString('utf-8');
        if (header5 === '%PDF-') return '.pdf';
        if (hex4 === 'ffd8ffe0' || hex4 === 'ffd8ffe1' || hex4 === 'ffd8ffe8') return '.jpg';
        if (hex8 === '89504e470d0a1a0a') return '.png';
        if (hex4 === '47494638') return '.gif';
        if (hex4 === '52494646' && buffer.subarray(8, 12).toString('utf-8') === 'WEBP') return '.webp';
        if (hex4 === '49492a00' || hex4 === '4d4d002a') return '.tiff';
        if (hex4 === '424d') return '.bmp';
        return '';
      };

      const docEventWaitMs = 15_000;

      for (let i = 0; i < docCount; i++) {
        const linkLocator = documentLinks.nth(i);
        let rawLinkText = await documentLinks.nth(i).textContent();
        rawLinkText = rawLinkText ? rawLinkText.trim() : `document_${i + 1}_${Date.now()}`;
        rawLinkText = rawLinkText.replace(/[/\\?%*:|"<>]/g, '-');
        const baseFileName = rawLinkText;
        let fileName = baseFileName;
        console.log(`Listing ${listingId}: document ${i + 1}/${docCount} processing started (${baseFileName}).`);
        const directHref =
          (await linkLocator.getAttribute('href').catch(() => null)) ||
          (await linkLocator.evaluate((el) => (el as HTMLAnchorElement).href || '').catch(() => ''));
        const onclickCode = await linkLocator.getAttribute('onclick').catch(() => null);
        const onclickUrlMatch = (onclickCode || '').match(/https?:\/\/[^'"\s)]+|\/Matrix\/[^'"\s)]+/i);
        const onclickDerivedHref = onclickUrlMatch
          ? (() => {
            const raw = onclickUrlMatch[0];
            if (/^https?:\/\//i.test(raw)) return raw;
            try {
              return new URL(raw, page2.url()).toString();
            } catch {
              return '';
            }
          })()
          : '';
        console.log(`Listing ${listingId}: document ${i + 1} href='${directHref || 'EMPTY'}' onclick='${onclickCode || 'EMPTY'}'.`);
        if (onclickDerivedHref) {
          console.log(`Listing ${listingId}: document ${i + 1} onclick-derived URL='${onclickDerivedHref}'.`);
        }

        const downloadPromise = page2.waitForEvent('download').catch(() => null);
        const popupPromise = page2.waitForEvent('popup').catch(() => null);
        const newPagePromise = page2.context().waitForEvent('page').catch(() => null);
        const docResponsePromise = page2
          .waitForResponse(
            (response) => {
              const status = response.status();
              if (status !== 200 && status !== 206) return false;
              const url = String(response.url() || '').toLowerCase();
              const ct = String(response.headers()['content-type'] || '').toLowerCase();
              const cd = String(response.headers()['content-disposition'] || '').toLowerCase();
              const reqType = String(response.request().resourceType() || '').toLowerCase();
              const isFileMime =
                ct.includes('application/pdf') ||
                ct.includes('image/') ||
                ct.includes('application/msword') ||
                ct.includes('officedocument') ||
                ct.includes('application/vnd.ms-') ||
                ct.includes('text/plain') ||
                ct.includes('octet-stream') ||
                ct.includes('binary');
              const isLikelyDocUrl = /(document|download|attachment|declaration|facture|certificat|plan|fichier|media|piece)/.test(url);
              const isAttachment = cd.includes('attachment') || cd.includes('filename');
              const isCentrisDocRequest =
                url.includes('matrix.centris.ca') &&
                (reqType === 'xhr' || reqType === 'fetch' || reqType === 'document') &&
                (isAttachment || isLikelyDocUrl);
              return isFileMime || isLikelyDocUrl || isCentrisDocRequest;
            },
            { timeout: docEventWaitMs }
          )
          .catch(() => null);

        await humanDelay(page2, 900, 1400);
        await linkLocator.click();
        const download = await Promise.race([
          downloadPromise,
          new Promise(resolve => setTimeout(resolve, docEventWaitMs)).then(() => null)
        ]);

        let tempPath = '';

        if (download) {
          console.log(`Listing ${listingId}: document ${i + 1} received via download event.`);
          const suggestedName = (download.suggestedFilename() || '').trim();
          const suggestedExt = path.extname(suggestedName);
          const baseExt = path.extname(baseFileName);
          if (!baseExt && suggestedExt) {
            fileName = `${baseFileName}${suggestedExt}`;
          } else if (!baseExt && !suggestedExt) {
            fileName = `${baseFileName}.bin`;
          }

          tempPath = path.join(__dirname, '../../../downloads', fileName);
          await download.saveAs(tempPath);
        } else {
          console.log(`Listing ${listingId}: document ${i + 1} has no direct download, trying popup fetch.`);
          const openedPage = await Promise.race([
            popupPromise,
            newPagePromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), docEventWaitMs))
          ]);

          if (openedPage) {
            try {
              await openedPage.waitForLoadState('domcontentloaded').catch(() => null);
              await openedPage.waitForTimeout(1500).catch(() => null);

              const docUrl = openedPage.url();
              console.log(`Listing ${listingId}: popup URL captured for document ${i + 1}.`);
              let buffer: Buffer | null = null;
              let detectedMime = '';
              for (let fetchRetry = 0; fetchRetry < 3; fetchRetry++) {
                try {
                  console.log(`Listing ${listingId}: popup fetch attempt ${fetchRetry + 1}/3 for document ${i + 1}.`);
                  const response = await page2.context().request.get(docUrl);
                  detectedMime = String(response.headers()['content-type'] || '');
                  buffer = await response.body();
                  break;
                } catch {
                  console.log(`Listing ${listingId}: popup fetch attempt ${fetchRetry + 1}/3 failed for document ${i + 1}.`);
                  await humanDelay(page2, 2000, 4000);
                }
              }

              if (!buffer) throw new Error(`Failed to extract bytes for ${fileName} after 3 attempts`);

              const baseExt = path.extname(baseFileName);
              const mimeExt = getExtFromMime(detectedMime);
              const sigExt = getExtFromBuffer(buffer);
              const finalExt = baseExt || mimeExt || sigExt || '.bin';
              if (!baseExt) fileName = `${baseFileName}${finalExt}`;

              tempPath = path.join(__dirname, '../../../downloads', fileName);
              fs.writeFileSync(tempPath, buffer);
              console.log(`Listing ${listingId}: document ${i + 1} saved locally from popup (${fileName}).`);
              if (openedPage !== page2 && !openedPage.isClosed()) {
                await openedPage.close().catch(() => null);
              }
            } catch {
              console.log(`Listing ${listingId}: popup handling failed for document ${i + 1}, skipping.`);
              continue;
            }
          } else {
            console.log(`Listing ${listingId}: popup not available for document ${i + 1}, trying direct href fallback.`);
            let networkFallbackBuffer: Buffer | null = null;
            let networkFallbackMime = '';
            const fallbackHref = directHref || onclickDerivedHref;
            if (!directHref && onclickDerivedHref) {
              console.log(`Listing ${listingId}: using onclick-derived URL fallback for document ${i + 1}.`);
            }

            if (!fallbackHref || !/^https?:\/\//i.test(fallbackHref)) {
              console.log(`Listing ${listingId}: no usable direct href for document ${i + 1}, trying network response fallback.`);
              const networkResponse = await docResponsePromise;
              if (!networkResponse) {
                console.log(`Listing ${listingId}: network response fallback unavailable for document ${i + 1}, skipping. onclick=${onclickCode || 'none'}`);
                continue;
              }

              try {
                networkFallbackMime = String(networkResponse.headers()['content-type'] || '');
                networkFallbackBuffer = await networkResponse.body();
              } catch {
                networkFallbackBuffer = null;
              }

              if (!networkFallbackBuffer) {
                console.log(`Listing ${listingId}: network response fallback body missing for document ${i + 1}, skipping.`);
                continue;
              }

              const baseExt = path.extname(baseFileName);
              const mimeExt = getExtFromMime(networkFallbackMime);
              const sigExt = getExtFromBuffer(networkFallbackBuffer);
              const finalExt = baseExt || mimeExt || sigExt || '.bin';
              if (!baseExt) fileName = `${baseFileName}${finalExt}`;

              tempPath = path.join(__dirname, '../../../downloads', fileName);
              fs.writeFileSync(tempPath, networkFallbackBuffer);
              console.log(`Listing ${listingId}: document ${i + 1} saved locally via network response fallback (${fileName}).`);
            }

            if (!tempPath) {
              let buffer: Buffer | null = null;
              let detectedMime = '';
              for (let fetchRetry = 0; fetchRetry < 3; fetchRetry++) {
                try {
                  console.log(`Listing ${listingId}: direct href fetch attempt ${fetchRetry + 1}/3 for document ${i + 1}.`);
                  const response = await page2.context().request.get(fallbackHref);
                  detectedMime = String(response.headers()['content-type'] || '');
                  buffer = await response.body();
                  break;
                } catch {
                  console.log(`Listing ${listingId}: direct href fetch attempt ${fetchRetry + 1}/3 failed for document ${i + 1}.`);
                  await humanDelay(page2, 2000, 4000);
                }
              }

              if (!buffer) {
                console.log(`Listing ${listingId}: direct href fallback failed for document ${i + 1}, trying network response fallback.`);
                const networkResponse = await docResponsePromise;
                if (!networkResponse) {
                  console.log(`Listing ${listingId}: network response fallback unavailable for document ${i + 1}, skipping.`);
                  continue;
                }
                try {
                  detectedMime = String(networkResponse.headers()['content-type'] || detectedMime);
                  buffer = await networkResponse.body();
                } catch {
                  buffer = null;
                }
                if (!buffer) {
                  console.log(`Listing ${listingId}: network response fallback body missing for document ${i + 1}, skipping.`);
                  continue;
                }
                console.log(`Listing ${listingId}: network response fallback succeeded for document ${i + 1}.`);
              }

              const baseExt = path.extname(baseFileName);
              const mimeExt = getExtFromMime(detectedMime);
              const sigExt = getExtFromBuffer(buffer);
              const finalExt = baseExt || mimeExt || sigExt || '.bin';
              if (!baseExt) fileName = `${baseFileName}${finalExt}`;

              tempPath = path.join(__dirname, '../../../downloads', fileName);
              fs.writeFileSync(tempPath, buffer);
              console.log(`Listing ${listingId}: document ${i + 1} saved locally via direct href fallback (${fileName}).`);
            }
          }
        }

        let uploadSuccess = false;
        for (let retries = 0; retries < 3; retries++) {
          try {
            console.log(`Listing ${listingId}: upload attempt ${retries + 1}/3 for ${fileName}.`);
            await uploadToDrive(tempPath, folderId);
            uploadSuccess = true;
            docsUploaded += 1;
            console.log(`Listing ${listingId}: upload succeeded for ${fileName}.`);
            break;
          } catch {
            console.log(`Listing ${listingId}: upload attempt ${retries + 1}/3 failed for ${fileName}.`);
            await humanDelay(page2, 2000, 4000);
          }
        }

        if (!uploadSuccess) {
          logAnomaly('EXPORT', `Failed to upload ${fileName} after 3 attempts.`);
        }

        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          console.log(`Listing ${listingId}: cleaned temporary file ${fileName}.`);
        } catch {
          // ignore cleanup errors
        }

        await humanDelay(page2, 2500, 4000);
      }

      infoLog(`Listing ${listingId}: documents uploaded to Google Drive (${docsUploaded}/${docCount}).`);

      infoLog(`Listing ${listingId}: Matrix PDF generation started.`);
      await page2.waitForTimeout(10_000);
      await page2.locator('.linkIcon.icon_print').first().click();
      await page2.waitForLoadState('domcontentloaded').catch(() => null);
      await humanDelay(page2, 1200, 2200);
      await page2.getByText('Detaillé courtier avec album de photos (Impérial)').click();
      await humanDelay(page2, 400, 800);
      await page2.locator('#m_ddlLanguage').selectOption('2');
      await humanDelay(page2, 400, 800);

      const matrixTempPath = path.join(__dirname, '../../../downloads', 'Matrix.pdf');
      const matrixCandidates: Array<{ source: string; size: number; buffer: Buffer; quality: 'strict' | 'legacy' }> = [];
      const matrixFetchUrls = new Set<string>();
      let matrixUploaded = false;
      const isValidPdfBuffer = (buffer: Buffer, minSize = 20000) => !!buffer && buffer.length >= minSize && buffer.subarray(0, 5).toString('utf-8') === '%PDF-';
      const isPdfLikePath = (url: string): boolean => {
        const raw = String(url || '');
        try {
          const parsed = new URL(raw);
          const pathOnly = parsed.pathname.toLowerCase();
          return pathOnly.endsWith('.pdf') || pathOnly.includes('/matrix/printpdf') || pathOnly.includes('/matrixx/printpdf');
        } catch {
          const pathOnly = raw.split('?')[0].toLowerCase();
          return pathOnly.endsWith('.pdf') || pathOnly.includes('/matrix/printpdf') || pathOnly.includes('/matrixx/printpdf');
        }
      };
      const isDocumentOrPdf = (resourceType: string, url: string, contentType?: string): boolean => {
        const normalizedType = String(resourceType || '').toLowerCase();
        const normalizedContentType = String(contentType || '').toLowerCase();
        const isDocumentType = normalizedType === 'document';
        const isPdfUrl = isPdfLikePath(url);
        const isPdfMime = normalizedContentType.includes('application/pdf');
        return isDocumentType || isPdfUrl || isPdfMime;
      };
      const matrixNetworkLogRequest = (request: Request): void => {
        const type = request.resourceType();
        const method = request.method();
        const url = request.url();
        if (!isDocumentOrPdf(type, url)) return;
        console.log(`[MATRIX-NETWORK][REQUEST][${listingId}] type=${type} method=${method} url=${url}`);
      };
      const matrixNetworkLogResponse = (response: Response): void => {
        const request = response.request();
        const type = request.resourceType();
        const method = request.method();
        const status = response.status();
        const url = response.url();
        const contentType = String(response.headers()['content-type'] || 'unknown');
        if (!isDocumentOrPdf(type, url, contentType)) return;
        console.log(`[MATRIX-NETWORK][RESPONSE][${listingId}] type=${type} method=${method} status=${status} contentType=${contentType} url=${url}`);
      };
      const matrixNetworkLogFailed = (request: Request): void => {
        const type = request.resourceType();
        const method = request.method();
        const url = request.url();
        const errorText = request.failure()?.errorText || 'unknown';
        if (!isDocumentOrPdf(type, url)) return;
        console.log(`[MATRIX-NETWORK][FAILED][${listingId}] type=${type} method=${method} error=${errorText} url=${url}`);
      };

      const onMatrixResponse = async (response: Response) => {
        try {
          const request = response.request();
          const requestMethod = String(request.method() || 'GET').toUpperCase();
          const headers = response.headers() || {};
          const ct = String(headers['content-type'] || '').toLowerCase();
          const contentLength = Number(headers['content-length'] || 0);
          const status = response.status();
          const url = String(response.url() || '');
          const lowerUrl = url.toLowerCase();

          const isChromeViewerPdfUuid = /^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url);
          const isPdfMime = ct.includes('application/pdf');
          const isLegacyPrintPdf = lowerUrl.includes('matrix.centris.ca/matrix/printpdf') || lowerUrl.includes('matrix.centris.ca/matrixx/printpdf');
          const isHeadlessPrintPdf = isLegacyPrintPdf && isPdfMime;
          const isStrictCandidate = (isChromeViewerPdfUuid && isPdfMime) || isHeadlessPrintPdf;
          const isLegacyCandidate = isLegacyPrintPdf && (isPdfMime || ct.includes('octet-stream') || ct.includes('binary'));

          if (!(isStrictCandidate || isLegacyCandidate)) return;
          if (status !== 200 && status !== 206) return;
          if (contentLength && contentLength < 20000) return;
          matrixFetchUrls.add(url);

          let body: Buffer | null = null;
          try {
            body = await response.body();
          } catch {
            body = null;
          }

          if ((!body || body.length < 500 || body.subarray(0, 5).toString('utf-8') !== '%PDF-') && isLegacyPrintPdf) {
            try {
              const reqHeaders = request.headers();
              const mergedHeaders: Record<string, string> = {
                ...reqHeaders,
                accept: 'application/pdf,*/*'
              };
              delete mergedHeaders['content-length'];

              let replayBody: Buffer;
              if (requestMethod === 'POST') {
                const replayResp = await page2.context().request.post(url, {
                  timeout: 60000,
                  headers: mergedHeaders,
                  data: request.postData() || undefined
                });
                replayBody = await replayResp.body();
              } else {
                const replayResp = await page2.context().request.get(url, {
                  timeout: 60000,
                  headers: mergedHeaders
                });
                replayBody = await replayResp.body();
              }

              if (replayBody.length > 500 && replayBody.subarray(0, 5).toString('utf-8') === '%PDF-') {
                body = replayBody;
                console.log(`Listing ${listingId}: matrix response body recovered via ${requestMethod} replay.`);
              }
            } catch {
              // ignore replay recovery errors
            }
          }

          if (!body) return;
          const isPdfSig = body.subarray(0, 5).toString('utf-8') === '%PDF-';
          const quality: 'strict' | 'legacy' = isStrictCandidate ? 'strict' : 'legacy';
          if (isPdfSig && body.length > 500) {
            matrixCandidates.push({ source: `network:${response.url() || 'unknown'}`, size: body.length, buffer: body, quality });
          }
        } catch {
          // ignore
        }
      };

      page2.context().on('request', matrixNetworkLogRequest);
      page2.context().on('response', matrixNetworkLogResponse);
      page2.context().on('requestfailed', matrixNetworkLogFailed);
      console.log(`Listing ${listingId}: matrix-scoped network tracing enabled.`);
      console.log(`Listing ${listingId}: attaching matrix network listener.`);
      page2.context().on('response', onMatrixResponse);
      const matrixPopupPromise = page2.waitForEvent('popup').catch(() => null);
      await page2.locator('.linkIcon.icon_page').filter({ hasText: 'Imprimer en PDF' }).click();
      const matrixPopup = await matrixPopupPromise;
      console.log(`Listing ${listingId}: matrix popup ${matrixPopup ? 'opened' : 'not opened'}, using ${matrixPopup ? 'popup page' : 'current page'} for capture.`);

      try {
        const capturePage = matrixPopup || page2;
        let bestCandidate: { source: string; size: number; buffer: Buffer; quality: 'strict' | 'legacy' } | undefined;
        let fallbackFetched = false;

        let cdpSession: any = null;
        const cdpTracked = new Map<string, { url: string; status: number; mimeType: string }>();
        const cdpRequestMeta = new Map<string, { method: string; url: string; initiatorType: string; initiatorUrl: string }>();
        try {
          cdpSession = await capturePage.context().newCDPSession(capturePage);
          await cdpSession.send('Network.enable');

          cdpSession.on('Network.requestWillBeSent', (evt: any) => {
            try {
              const requestId = String(evt?.requestId || '');
              const url = String(evt?.request?.url || '');
              const method = String(evt?.request?.method || 'GET');
              const initiatorType = String(evt?.initiator?.type || 'unknown');
              const initiatorUrl = String(evt?.initiator?.url || evt?.documentURL || 'unknown');
              const isChromeViewer = /^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//i.test(url);
              if (!isChromeViewer) return;
              cdpRequestMeta.set(requestId, { method, url, initiatorType, initiatorUrl });
              console.log(`[MATRIX-CDP][REQUEST][${listingId}] method=${method} type=other initiatorType=${initiatorType} initiatorUrl=${initiatorUrl} url=${url}`);
            } catch {
              // ignore cdp request parse errors
            }
          });

          cdpSession.on('Network.responseReceived', (evt: any) => {
            try {
              const requestId = String(evt?.requestId || '');
              const url = String(evt?.response?.url || '');
              const mimeType = String(evt?.response?.mimeType || '').toLowerCase();
              const status = Number(evt?.response?.status || 0);
              const resourceType = String(evt?.type || 'other').toLowerCase();
              const method = cdpRequestMeta.get(requestId)?.method || 'GET';
              const initiatorType = cdpRequestMeta.get(requestId)?.initiatorType || 'unknown';
              const initiatorUrl = cdpRequestMeta.get(requestId)?.initiatorUrl || 'unknown';
              const isChromeViewerPdfUuid = /^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url);
              if (isChromeViewerPdfUuid) {
                console.log(`[MATRIX-CDP][RESPONSE][${listingId}] method=${method} type=${resourceType} status=${status} mimeType=${mimeType || 'unknown'} initiatorType=${initiatorType} initiatorUrl=${initiatorUrl} url=${url}`);
              }
              if (!isChromeViewerPdfUuid) return;
              if (!mimeType.includes('pdf')) return;
              if (status !== 200 && status !== 206) return;
              cdpTracked.set(String(evt.requestId), { url, status, mimeType });
            } catch {
              // ignore cdp parse errors
            }
          });

          cdpSession.on('Network.loadingFinished', (evt: any) => {
            const requestId = String(evt?.requestId || '');
            if (!cdpTracked.has(requestId)) return;

            void (async () => {
              try {
                const meta = cdpTracked.get(requestId)!;
                const bodyObj = await cdpSession.send('Network.getResponseBody', { requestId });
                const rawBody = String(bodyObj?.body || '');
                const buffer = bodyObj?.base64Encoded ? Buffer.from(rawBody, 'base64') : Buffer.from(rawBody, 'utf-8');
                const isPdfSig = buffer.subarray(0, 5).toString('utf-8') === '%PDF-';
                if (isPdfSig && buffer.length >= 20000) {
                  matrixCandidates.push({
                    source: `cdp:${meta.url}`,
                    size: buffer.length,
                    buffer,
                    quality: 'strict'
                  });
                }
              } catch {
                // ignore CDP body extraction errors
              } finally {
                cdpTracked.delete(requestId);
                cdpRequestMeta.delete(requestId);
              }
            })();
          });

          cdpSession.on('Network.loadingFailed', (evt: any) => {
            try {
              const requestId = String(evt?.requestId || '');
              const failureText = String(evt?.errorText || 'unknown');
              const canceled = Boolean(evt?.canceled);
              const meta = cdpRequestMeta.get(requestId);
              if (!meta || !/^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//i.test(meta.url)) return;
              console.log(`[MATRIX-CDP][FAILED][${listingId}] method=${meta.method} type=other canceled=${canceled} error=${failureText} initiatorType=${meta.initiatorType} initiatorUrl=${meta.initiatorUrl} url=${meta.url}`);
            } catch {
              // ignore CDP failure parse errors
            } finally {
              const requestId = String(evt?.requestId || '');
              cdpTracked.delete(requestId);
              cdpRequestMeta.delete(requestId);
            }
          });
        } catch {
          cdpSession = null;
        }

        for (let attempt = 1; attempt <= 3 && !bestCandidate; attempt++) {
          console.log(`Listing ${listingId}: matrix capture attempt ${attempt}/3 started.`);
          if (attempt > 1) {
            await capturePage.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
            await humanDelay(capturePage, 1200, 2200);
          }

          const matrixStartTime = Date.now();
          let lastBestSize = 0;
          let stableTicks = 0;

          for (let i = 0; i < 60; i++) {
            await humanDelay(capturePage, 1000, 1800);
            const bodyText = await capturePage.evaluate(() => (document.body ? document.body.innerText.toLowerCase() : '')).catch(() => '');
            const bestCandidateSize = matrixCandidates.reduce((max, c) => Math.max(max, c.size), 0);
            const elapsedMs = Date.now() - matrixStartTime;

            if (bestCandidateSize === lastBestSize && bestCandidateSize > 20000) stableTicks++;
            else stableTicks = 0;
            lastBestSize = bestCandidateSize;

            const generationFinished = !bodyText.includes('création') && !bodyText.includes('creation') && !bodyText.includes('patienter');
            if (generationFinished && bestCandidateSize > 20000 && elapsedMs >= 12000 && stableTicks >= 2) break;
          }

          const validCandidates = matrixCandidates.filter(c => isValidPdfBuffer(c.buffer));
          const strictCandidates = validCandidates.filter(c => c.quality === 'strict');
          const legacyCandidates = validCandidates.filter(c => c.quality === 'legacy');
          console.log(`Listing ${listingId}: matrix candidates strict=${strictCandidates.length}, legacy=${legacyCandidates.length}.`);
          bestCandidate = (strictCandidates.length ? strictCandidates : legacyCandidates).sort((a, b) => b.size - a.size)[0];
        }

        if (bestCandidate) {
          console.log(`Listing ${listingId}: best matrix candidate selected (${bestCandidate.size} bytes from ${bestCandidate.source}).`);
          fs.writeFileSync(matrixTempPath, bestCandidate.buffer);
          await uploadToDrive(matrixTempPath, folderId);
          matrixUploaded = true;
          console.log(`Listing ${listingId}: matrix PDF uploaded via primary capture path.`);
          if (fs.existsSync(matrixTempPath)) fs.unlinkSync(matrixTempPath);
        } else {
          const fallbackUrls = Array.from(new Set([(matrixPopup?.url() || '').trim(), ...Array.from(matrixFetchUrls)])).filter(u => !!u && !u.startsWith('chrome-extension://'));
          for (const fallbackUrl of fallbackUrls) {
            console.log(`Listing ${listingId}: trying matrix fallback URL (${fallbackUrl}).`);
            for (let retry = 1; retry <= 3; retry++) {
              try {
                console.log(`Listing ${listingId}: matrix fallback attempt ${retry}/3.`);
                const fallbackResp = await page2.context().request.get(fallbackUrl, { timeout: 60_000, headers: { accept: 'application/pdf,*/*' } });
                const fallbackBody = await fallbackResp.body();
                const fallbackSig = fallbackBody.subarray(0, 5).toString('utf-8') === '%PDF-';
                if (fallbackSig && fallbackBody.length >= 20000) {
                  fs.writeFileSync(matrixTempPath, fallbackBody);
                  await uploadToDrive(matrixTempPath, folderId);
                  matrixUploaded = true;
                  console.log(`Listing ${listingId}: matrix PDF uploaded via fallback URL.`);
                  if (fs.existsSync(matrixTempPath)) fs.unlinkSync(matrixTempPath);
                  fallbackFetched = true;
                  break;
                }
              } catch {
                console.log(`Listing ${listingId}: matrix fallback attempt ${retry}/3 failed.`);
                await humanDelay(page2, 1200, 2200);
              }
            }
            if (fallbackFetched) break;
          }

          if (!fallbackFetched) {
            console.log(`Listing ${listingId}: matrix fallback exhausted with no valid PDF.`);
          }
        }

        if (cdpSession) {
          await cdpSession.detach().catch(() => null);
        }
      } finally {
        page2.context().off('request', matrixNetworkLogRequest);
        page2.context().off('response', matrixNetworkLogResponse);
        page2.context().off('requestfailed', matrixNetworkLogFailed);
        console.log(`Listing ${listingId}: matrix-scoped network tracing disabled.`);
        page2.context().off('response', onMatrixResponse);
        console.log(`Listing ${listingId}: matrix network listener detached.`);
      }

      if (matrixUploaded) {
        infoLog(`Listing ${listingId}: Matrix PDF found and uploaded.`);
      } else {
        infoLog(`Listing ${listingId}: Matrix PDF not found.`);
      }

      if (matrixPopup && !matrixPopup.isClosed()) await matrixPopup.close().catch(() => { });

      await page2.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
      await humanDelay(page2, 1000, 1800);

      const page3Promise = page2.waitForEvent('popup');
      await page2.locator('.formula.field.d18485m3').first().click();
      const page3 = await page3Promise;
      await humanDelay(page3, 1500, 2600);

      const mailingAddressResults = (await page3.locator('.field.d12023m4').allTextContents()).map(v => (v || '').trim());
      const hasSecondValue = Boolean(mailingAddressResults[1]);
      const rawFullName = hasSecondValue ? (mailingAddressResults[1] || '') : (mailingAddressResults[0] || '');
      const rawMailingAddress = hasSecondValue ? (mailingAddressResults[3] || '') : (mailingAddressResults[2] || '');
      const rawMailingCityZip = hasSecondValue ? (mailingAddressResults[5] || '') : (mailingAddressResults[4] || '');
      const rawPhoneCell = hasSecondValue ? (mailingAddressResults[7] || '') : (mailingAddressResults[6] || '');

      const phoneNumber = (() => {
        const start = rawPhoneCell.search(/\d/);
        if (start < 0) return '';
        let end = -1;
        for (let i = rawPhoneCell.length - 1; i >= 0; i--) {
          if (/\d/.test(rawPhoneCell[i])) {
            end = i;
            break;
          }
        }
        if (end < start) return '';
        return rawPhoneCell.slice(start, end + 1).trim();
      })();

      const { firstName, lastName } = parseFullName(rawFullName || '');
      const addrParts = parseStreetAddress(rawMailingAddress || '');
      const mailingStreetNumber = addrParts.streetNumber;
      const mailingStreetName = addrParts.streetName;
      const mailingAppartment = addrParts.appartment;
      const locParts = parseCityAndZip(rawMailingCityZip || '');
      const mailingCity = locParts.city;
      const mailingZip = locParts.zip;
      console.log(`Listing ${listingId}: owner details captured.`);

      const mockDataByHeader = {
        Type: 'Prospect',
        'Lead Source': 'Expired',
        'Reference Number': centrisNumber || 'NF',
        'Type Propriete': 'Commercial',
        Price: price || 'NF',
        'Numero lot': lotNumber || 'NF',
        'First Name': firstName || 'NF',
        'Last Name': lastName || 'NF',
        Phone: phoneNumber || '',
        'Other Unit': otherAppartment || '',
        'Other Street Number': otherStreetNumber || 'NF',
        'Other Street': otherStreetName || 'NF',
        'Other City': otherCity || 'NF',
        'Other Zip': otherZip || 'NF',
        'Other State': 'Quebec',
        'Other Country': 'Canada',
        'Mailing Unit': mailingAppartment || '',
        'Mailing Street Number': mailingStreetNumber || 'NF',
        'Mailing Street': mailingStreetName || 'NF',
        'Mailing City': mailingCity || 'NF',
        'Mailing Zip': mailingZip || 'NF',
        'Mailing State': 'Quebec',
        'Mailing Country': 'Canada',
        'Google Drive': driveFolderUrl || 'NF',
      };

      try {
        await appendRowByHeaders(mockDataByHeader);
        console.log(`Listing ${listingId}: lead exported to Google Sheets.`);
      } catch (error: any) {
        logError('EXPORT', 'Google Sheets append failed.', error);
      }

      if (!page3.isClosed()) await page3.close().catch(() => { });
      leadsProcessed += 1;
      infoLog(`Listing ${listingId}: completed.`);
    };

    await page2.locator('#m_pnlDisplay').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => null);
    await humanDelay(page2, 700, 1200);

    const rowCells = page2.locator('td.d15879m6');
    const cellCount = await rowCells.count();
    let listingsWithoutMarker = 0;
    for (let i = 0; i < cellCount; i += 2) {
      const row = rowCells.nth(i);
      const mainLink = row.locator("a[data-mtx-track='Results - In-Display Full Link Click']").first();
      if (!await mainLink.isVisible().catch(() => false)) continue;
      const markerCount = await row.locator("a[data-original-title*='Il existe une inscription en vigueur pour cette propriété.']").count();
      if (markerCount === 0) listingsWithoutMarker += 1;
    }
    infoLog(`Found ${listingsWithoutMarker} listing(s) without inscription marker.`);
    logStep('SCRAPING', `Found ${listingsWithoutMarker} listing(s) without inscription marker.`);
    let firstListingOpened = false;

    // Keep commercial's special grid indexing only for selecting the first valid listing.
    for (let i = 0; i < cellCount; i += 2) {
      const row = rowCells.nth(i);
      const mainLink = row.locator("a[data-mtx-track='Results - In-Display Full Link Click']").first();
      if (!await mainLink.isVisible().catch(() => false)) continue;

      const listingId = ((await mainLink.textContent()) || '').trim() || `row_${Math.floor(i / 2) + 1}`;
      const markerCount = await row.locator("a[data-original-title*='Il existe une inscription en vigueur pour cette propriété.']").count();
      if (markerCount > 0) {
        logAnomaly('SCRAPING', `Skipped listing ${listingId}: active inscription marker found.`);
        continue;
      }

      await mainLink.click();
      await humanDelay(page2, 1600, 2600);
      firstListingOpened = true;
      break;
    }

    if (!firstListingOpened) {
      logStep('NAVIGATION', 'No processable listing found in results.');
      return leadsProcessed;
    }

    const getCurrentListingId = async (fallback: string): Promise<string> => {
      const rawCentris = await page2.locator('.formula.field.d15835m5').first().textContent().catch(() => null);
      return extractFirstWord(rawCentris || '') || fallback;
    };

    const hasActiveInscriptionMarkerOnDetail = async (): Promise<boolean> => {
      const marker = page2.locator("a[data-original-title*='Il existe une inscription en vigueur pour cette propriété.']").first();
      if (await marker.isVisible().catch(() => false)) return true;
      const markerCount = await page2.locator("a[data-original-title*='Il existe une inscription en vigueur pour cette propriété.']").count().catch(() => 0);
      return markerCount > 0;
    };

    const moveToNextListing = async (): Promise<boolean> => {
      const nextListingButton = page2.locator('#m_DisplayCore_dpy3, #m_DisplayCore_dpy').first();
      const hasNextButton = await nextListingButton.count();
      if (!hasNextButton) {
        logStep('NAVIGATION', 'Next listing button (#m_DisplayCore_dpy3/#m_DisplayCore_dpy) not found. Stopping.');
        return false;
      }

      const isNextDisabled = await nextListingButton.evaluate((el: Element) => {
        const href = (el as HTMLAnchorElement).getAttribute('href');
        const className = String((el as HTMLElement).className || '').toLowerCase();
        const ariaDisabled = String(el.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
        return el.hasAttribute('disabled') || ariaDisabled || className.includes('disabled') || !href || href.trim() === '';
      }).catch(() => true);

      if (isNextDisabled) {
        logStep('NAVIGATION', 'Reached last listing (next button disabled).');
        return false;
      }

      await nextListingButton.click();
      await humanDelay(page2, 1600, 2600);
      await page2.waitForLoadState('domcontentloaded').catch(() => null);
      return true;
    };

    let listingIndex = 0;
    while (true) {
      const currentListingId = await getCurrentListingId(`listing_${listingIndex + 1}`);
      const hasActiveMarker = await hasActiveInscriptionMarkerOnDetail();
      if (hasActiveMarker) {
        logAnomaly('SCRAPING', `Skipped listing ${currentListingId}: active inscription marker found on detail view.`);
        const moved = await moveToNextListing();
        if (!moved) break;
        listingIndex += 1;
        continue;
      }

      try {
        await processOpenedListing(currentListingId, 1, listingIndex);
      } catch (listingErr: any) {
        logError('SCRAPING', `Failed processing listing ${currentListingId}.`, listingErr);
      }

      const moved = await moveToNextListing();
      if (!moved) break;
      listingIndex += 1;
    }
  } catch (error) {
    logError('SYSTEM', 'Scraper encountered a fatal error.', error);
    throw error;
  } finally {
    if (ownsLogger) {
      logger.finalize(leadsProcessed);
    }
  }

  return leadsProcessed;
}

if (require.main === module) {
  Promise.race([
    (async () => {
      const session = await login(APCIQ_USER, APCIQ_PASSWORD);
      const logger = createExecutionLogger('commercial');
      try {
        const leads = await scrapeCommercial({ matrixPage: session.matrixPage, logger });
        logger.finalize(leads);
      } finally {
        await session.browser.close();
      }
    })(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Script timeout reached (5 hours).')), FIVE_HOURS_MS);
    })
  ]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
