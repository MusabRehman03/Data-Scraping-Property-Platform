// Entry point for automation (cron triggers this)
import './config/env';
import { mainWorkflow } from './workflows/mainWorkflow';
import { log } from './utils/logger';

async function run(): Promise<void> {
	try {
		await mainWorkflow();
		log('Automation finished successfully.');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log(`Automation failed: ${message}`);
		process.exitCode = 1;
	}
}

void run();
