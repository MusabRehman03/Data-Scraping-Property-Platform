import type { Page } from '@playwright/test';
import type { ExecutionLogger } from '../../utils/logger';

export interface SharedScraperContext {
	matrixPage: Page;
	logger?: ExecutionLogger;
}
