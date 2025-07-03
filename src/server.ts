import express from 'express';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { WalletManager } from './walletManager';
import { DiscordNotifier } from './discordNotifier';
import { TransactionProcessor } from './transactionProcessor';
import { HeliusWebhookManager } from './heliusWebhookManager';

export class WalletTrackerServer {
  private app: express.Application;
  private walletManager: WalletManager;
  private discordNotifier: DiscordNotifier;
  private transactionProcessor: TransactionProcessor;
  private heliusWebhookManager: HeliusWebhookManager;
  private server: any;

  constructor() {
    this.app = express();
    this.walletManager = new WalletManager();
    this.discordNotifier = new DiscordNotifier(this.walletManager);
    this.heliusWebhookManager = new HeliusWebhookManager();
    this.transactionProcessor = new TransactionProcessor(
      this.discordNotifier,
      this.walletManager
    );

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json({ limit: '10mb' }));

    // Parse URL-encoded bodies
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });

    // Error handling middleware
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Express error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Root endpoint - serve web interface
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // API info endpoint
    this.app.get('/api', (req, res) => {
      res.json({
        name: 'Solana Wallet Tracker',
        version: '1.0.0',
        status: 'running',
        endpoints: {
          health: '/health',
          status: '/status',
          webhook: config.server.webhookPath,
          wallets: '/wallets',
          testDiscord: '/test-discord'
        },
        timestamp: new Date().toISOString(),
      });
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    // Main webhook endpoint for Helius
    this.app.post(config.server.webhookPath, async (req, res) => {
      try {
        logger.info('Received webhook from Helius');
        logger.debug('Webhook payload:', JSON.stringify(req.body, null, 2));

        // Process the transaction data
        await this.transactionProcessor.processTransaction(req.body);

        res.status(200).json({ success: true });
      } catch (error) {
        logger.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Failed to process webhook' });
      }
    });

    // Status endpoint
    this.app.get('/status', async (req, res) => {
      try {
        const activeWallets = await this.walletManager.getActiveWallets();
        const webhooks = await this.heliusWebhookManager.getAllWebhooks();
        
        res.json({
          status: 'running',
          activeWallets: activeWallets.length,
          webhooks: webhooks.length,
          currentWebhookId: this.heliusWebhookManager.getCurrentWebhookId(),
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Error getting status:', error);
        res.status(500).json({ error: 'Failed to get status' });
      }
    });

    // Test Discord notification endpoint
    this.app.post('/test-discord', async (req, res) => {
      try {
        const success = await this.discordNotifier.testConnection();
        res.json({ success, message: success ? 'Discord test successful' : 'Discord test failed' });
      } catch (error) {
        logger.error('Discord test failed:', error);
        res.status(500).json({ error: 'Discord test failed' });
      }
    });

    // Wallet management endpoints
    this.app.post('/wallets', async (req, res) => {
      try {
        const { address, label } = req.body;
        if (!address) {
          return res.status(400).json({ error: 'Wallet address is required' });
        }

        await this.walletManager.addWallet(address, label || 'API Added');
        await this.refreshWebhook();

        res.json({ success: true, message: `Wallet ${address} added successfully` });
      } catch (error) {
        logger.error('Failed to add wallet:', error);
        res.status(500).json({ error: 'Failed to add wallet' });
      }
    });

    this.app.delete('/wallets/:address', async (req, res) => {
      try {
        const { address } = req.params;
        await this.walletManager.removeWallet(address);
        await this.refreshWebhook();

        res.json({ success: true, message: `Wallet ${address} removed successfully` });
      } catch (error) {
        logger.error('Failed to remove wallet:', error);
        res.status(500).json({ error: 'Failed to remove wallet' });
      }
    });

    this.app.get('/wallets', async (req, res) => {
      try {
        const wallets = await this.walletManager.getAllWallets();
        res.json({ success: true, wallets });
      } catch (error) {
        logger.error('Failed to get wallets:', error);
        res.status(500).json({ error: 'Failed to get wallets' });
      }
    });

    // Webhook management endpoints
    this.app.post('/webhooks/setup', async (req, res) => {
      try {
        const activeWallets = await this.walletManager.getActiveWalletAddresses();
        if (activeWallets.length === 0) {
          return res.status(400).json({ error: 'No active wallets to track' });
        }

        const webhook = await this.heliusWebhookManager.setupWebhookForWallets(activeWallets);
        res.json({ success: true, webhook });
      } catch (error) {
        logger.error('Failed to setup webhook:', error);
        res.status(500).json({ error: 'Failed to setup webhook' });
      }
    });

    this.app.get('/webhooks', async (req, res) => {
      try {
        const webhooks = await this.heliusWebhookManager.getAllWebhooks();
        res.json({ webhooks });
      } catch (error) {
        logger.error('Failed to get webhooks:', error);
        res.status(500).json({ error: 'Failed to get webhooks' });
      }
    });

    this.app.delete('/webhooks/cleanup', async (req, res) => {
      try {
        await this.heliusWebhookManager.cleanupAllWebhooks();
        res.json({ success: true, message: 'All webhooks cleaned up' });
      } catch (error) {
        logger.error('Failed to cleanup webhooks:', error);
        res.status(500).json({ error: 'Failed to cleanup webhooks' });
      }
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  /**
   * Initialize the server and all components
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Wallet Tracker Server...');

      // Initialize wallet manager
      await this.walletManager.initialize();

      // Test Discord connection
      logger.info('Testing Discord connection...');
      const discordTest = await this.discordNotifier.testConnection();
      if (!discordTest) {
        logger.warn('Discord connection test failed, but continuing...');
      }

      // Setup webhook for active wallets
      const activeWallets = await this.walletManager.getActiveWalletAddresses();
      if (activeWallets.length > 0) {
        logger.info(`Setting up webhook for ${activeWallets.length} active wallets...`);
        await this.heliusWebhookManager.setupWebhookForWallets(activeWallets);
      } else {
        logger.warn('No active wallets found. Add wallets using the CLI before starting the server.');
      }

      logger.info('✅ Server initialization complete');
    } catch (error) {
      logger.error('Failed to initialize server:', error);
      throw error;
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      await this.initialize();

      this.server = this.app.listen(config.server.port, () => {
        logger.info(`🚀 Wallet Tracker Server running on port ${config.server.port}`);
        logger.info(`📡 Webhook endpoint: http://localhost:${config.server.port}${config.server.webhookPath}`);
        logger.info(`📊 Status endpoint: http://localhost:${config.server.port}/status`);
        logger.info(`🔧 Health check: http://localhost:${config.server.port}/health`);
      });

      // Handle graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());

    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down server...');
    
    if (this.server) {
      this.server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  /**
   * Refresh webhook with current active wallets
   */
  async refreshWebhook(): Promise<void> {
    try {
      const activeWallets = await this.walletManager.getActiveWalletAddresses();
      if (activeWallets.length > 0) {
        await this.heliusWebhookManager.setupWebhookForWallets(activeWallets);
        logger.info('Webhook refreshed successfully');
      } else {
        logger.warn('No active wallets to refresh webhook');
      }
    } catch (error) {
      logger.error('Failed to refresh webhook:', error);
      throw error;
    }
  }
}
