#!/usr/bin/env node

import { WalletTrackerServer } from './server';
import { logger } from './logger';
import { validateConfig } from './config';

async function main() {
  try {
    // Validate configuration
    validateConfig();

    // Create and start the server
    const server = new WalletTrackerServer();
    await server.start();

  } catch (error) {
    logger.error('Failed to start Wallet Tracker:', error);
    console.error('❌ Failed to start Wallet Tracker:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main();
}
