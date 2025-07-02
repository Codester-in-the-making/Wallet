import axios from 'axios';
import { config } from './config';
import { logger } from './logger';

export interface HeliusWebhook {
  webhookID: string;
  wallet: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: string;
  authHeader?: string;
}

export class HeliusWebhookManager {
  private apiKey: string;
  private baseUrl: string = 'https://api.helius.xyz/v0/webhooks';
  private webhookUrl: string;
  private currentWebhookId: string | null = null;

  constructor() {
    this.apiKey = config.helius.apiKey;
    // Use custom webhook URL if provided, otherwise default to localhost
    const customWebhookUrl = process.env.WEBHOOK_URL;
    this.webhookUrl = customWebhookUrl || `http://localhost:${config.server.port}${config.server.webhookPath}`;
  }

  /**
   * Create a new webhook for wallet tracking
   */
  async createWebhook(walletAddresses: string[]): Promise<HeliusWebhook> {
    try {
      logger.info(`Creating Helius webhook for ${walletAddresses.length} wallet addresses`);

      const webhookData = {
        webhookURL: this.webhookUrl,
        transactionTypes: this.getRelevantTransactionTypes(),
        accountAddresses: walletAddresses,
        webhookType: 'enhanced', // Use enhanced webhooks for better parsing
        authHeader: '', // Optional: add auth header if needed
      };

      const response = await axios.post(
        `${this.baseUrl}?api-key=${this.apiKey}`,
        webhookData,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const webhook: HeliusWebhook = response.data;
      this.currentWebhookId = webhook.webhookID;
      
      logger.info(`Successfully created webhook with ID: ${webhook.webhookID}`);
      return webhook;
    } catch (error) {
      logger.error('Failed to create Helius webhook:', error);
      if (axios.isAxiosError(error)) {
        logger.error('Response data:', error.response?.data);
        logger.error('Response status:', error.response?.status);
      }
      throw error;
    }
  }

  /**
   * Update existing webhook with new wallet addresses
   */
  async updateWebhook(webhookId: string, walletAddresses: string[]): Promise<HeliusWebhook> {
    try {
      logger.info(`Updating webhook ${webhookId} with ${walletAddresses.length} wallet addresses`);

      const updateData = {
        webhookURL: this.webhookUrl,
        transactionTypes: this.getRelevantTransactionTypes(),
        accountAddresses: walletAddresses,
        webhookType: 'enhanced',
      };

      const response = await axios.put(
        `${this.baseUrl}/${webhookId}?api-key=${this.apiKey}`,
        updateData,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const webhook: HeliusWebhook = response.data;
      logger.info(`Successfully updated webhook ${webhookId}`);
      return webhook;
    } catch (error) {
      logger.error(`Failed to update webhook ${webhookId}:`, error);
      if (axios.isAxiosError(error)) {
        logger.error('Response data:', error.response?.data);
        logger.error('Response status:', error.response?.status);
      }
      throw error;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    try {
      logger.info(`Deleting webhook ${webhookId}`);

      await axios.delete(
        `${this.baseUrl}/${webhookId}?api-key=${this.apiKey}`,
        {
          timeout: 30000,
        }
      );

      if (this.currentWebhookId === webhookId) {
        this.currentWebhookId = null;
      }

      logger.info(`Successfully deleted webhook ${webhookId}`);
    } catch (error) {
      logger.error(`Failed to delete webhook ${webhookId}:`, error);
      if (axios.isAxiosError(error)) {
        logger.error('Response data:', error.response?.data);
        logger.error('Response status:', error.response?.status);
      }
      throw error;
    }
  }

  /**
   * Get all webhooks for the current API key
   */
  async getAllWebhooks(): Promise<HeliusWebhook[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}?api-key=${this.apiKey}`,
        {
          timeout: 30000,
        }
      );

      return response.data || [];
    } catch (error) {
      logger.error('Failed to get webhooks:', error);
      if (axios.isAxiosError(error)) {
        logger.error('Response data:', error.response?.data);
        logger.error('Response status:', error.response?.status);
      }
      throw error;
    }
  }

  /**
   * Get a specific webhook by ID
   */
  async getWebhook(webhookId: string): Promise<HeliusWebhook> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${webhookId}?api-key=${this.apiKey}`,
        {
          timeout: 30000,
        }
      );

      return response.data;
    } catch (error) {
      logger.error(`Failed to get webhook ${webhookId}:`, error);
      if (axios.isAxiosError(error)) {
        logger.error('Response data:', error.response?.data);
        logger.error('Response status:', error.response?.status);
      }
      throw error;
    }
  }

  /**
   * Setup or update webhook based on current wallet addresses
   */
  async setupWebhookForWallets(walletAddresses: string[]): Promise<HeliusWebhook> {
    try {
      if (walletAddresses.length === 0) {
        logger.warn('No wallet addresses provided for webhook setup');
        throw new Error('At least one wallet address is required');
      }

      // Check if we have an existing webhook
      const existingWebhooks = await this.getAllWebhooks();
      const existingWebhook = existingWebhooks.find(w => w.webhookURL === this.webhookUrl);

      if (existingWebhook) {
        logger.info(`Found existing webhook ${existingWebhook.webhookID}, updating...`);
        return await this.updateWebhook(existingWebhook.webhookID, walletAddresses);
      } else {
        logger.info('No existing webhook found, creating new one...');
        return await this.createWebhook(walletAddresses);
      }
    } catch (error) {
      logger.error('Failed to setup webhook for wallets:', error);
      throw error;
    }
  }

  /**
   * Get relevant transaction types for wallet tracking
   */
  private getRelevantTransactionTypes(): string[] {
    return [
      // Basic transfers
      'TRANSFER',
      
      // Token operations
      'TOKEN_MINT',
      'BURN',
      'BURN_NFT',
      
      // Trading and swaps
      'SWAP',
      'BUY',
      'SELL',
      
      // NFT operations
      'NFT_SALE',
      'NFT_BID',
      'NFT_LISTING',
      'NFT_CANCEL_LISTING',
      'NFT_MINT',
      
      // DeFi operations
      'ADD_LIQUIDITY',
      'WITHDRAW_LIQUIDITY',
      'STAKE_SOL',
      'UNSTAKE_SOL',
      'STAKE_TOKEN',
      'UNSTAKE_TOKEN',
      'CLAIM_REWARDS',
      
      // Wallet operations
      'DEPOSIT',
      'WITHDRAW',
      
      // Catch-all for unknown transactions
      'UNKNOWN',
    ];
  }

  /**
   * Clean up all webhooks (useful for testing/debugging)
   */
  async cleanupAllWebhooks(): Promise<void> {
    try {
      const webhooks = await this.getAllWebhooks();
      logger.info(`Found ${webhooks.length} existing webhooks, cleaning up...`);

      for (const webhook of webhooks) {
        await this.deleteWebhook(webhook.webhookID);
      }

      logger.info('Successfully cleaned up all webhooks');
    } catch (error) {
      logger.error('Failed to cleanup webhooks:', error);
      throw error;
    }
  }

  /**
   * Get current webhook ID
   */
  getCurrentWebhookId(): string | null {
    return this.currentWebhookId;
  }

  /**
   * Set webhook URL (useful for testing with ngrok)
   */
  setWebhookUrl(url: string): void {
    this.webhookUrl = url;
    logger.info(`Updated webhook URL to: ${url}`);
  }
}
