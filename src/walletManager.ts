import fs from 'fs/promises';
import path from 'path';
import { TrackedWallet, WalletStorage } from './types';
import { config } from './config';
import { logger } from './logger';

export class WalletManager {
  private walletsFilePath: string;

  constructor() {
    this.walletsFilePath = path.resolve(config.app.walletsFile);
  }

  /**
   * Initialize the wallet storage file if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      // Ensure the directory exists
      const dir = path.dirname(this.walletsFilePath);
      await fs.mkdir(dir, { recursive: true });

      // Check if file exists
      await fs.access(this.walletsFilePath);
      logger.info(`Wallets file exists at: ${this.walletsFilePath}`);

      // Load and log existing wallets
      const wallets = await this.loadWallets();
      logger.info(`Loaded ${wallets.length} wallets from storage`);
      wallets.forEach(wallet => {
        logger.info(`  - ${wallet.label}: ${wallet.address} (active: ${wallet.isActive})`);
      });
    } catch (error) {
      logger.info(`Creating new wallets file at: ${this.walletsFilePath}`);
      await this.saveWallets([]);
    }
  }

  /**
   * Load wallets from storage (file or environment variable fallback)
   */
  async loadWallets(): Promise<TrackedWallet[]> {
    try {
      // Try to load from file first
      const data = await fs.readFile(this.walletsFilePath, 'utf-8');
      const storage: WalletStorage = JSON.parse(data);
      logger.info(`Loaded ${storage.wallets?.length || 0} wallets from file`);
      return storage.wallets || [];
    } catch (error) {
      logger.warn('Could not load from file, trying environment variable fallback');

      // Fallback to environment variable
      const envWallets = process.env.PERSISTENT_WALLETS;
      if (envWallets) {
        try {
          const storage: WalletStorage = JSON.parse(envWallets);
          logger.info(`Loaded ${storage.wallets?.length || 0} wallets from environment variable`);
          return storage.wallets || [];
        } catch (envError) {
          logger.error('Error parsing wallets from environment variable:', envError);
        }
      }

      logger.info('No wallets found in file or environment variable');
      return [];
    }
  }

  /**
   * Save wallets to storage (file and environment variable backup)
   */
  private async saveWallets(wallets: TrackedWallet[]): Promise<void> {
    const storage: WalletStorage = {
      wallets,
      lastUpdated: new Date().toISOString(),
    };

    const storageJson = JSON.stringify(storage, null, 2);

    try {
      // Try to save to file
      const dir = path.dirname(this.walletsFilePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.walletsFilePath, storageJson);
      logger.info(`Saved ${wallets.length} wallets to file`);
    } catch (error) {
      logger.warn('Could not save to file:', error);
    }

    // Automatically set environment variable as backup
    try {
      process.env.PERSISTENT_WALLETS = JSON.stringify(storage);
      logger.info(`✅ Automatically set PERSISTENT_WALLETS environment variable with ${wallets.length} wallets`);
    } catch (error) {
      logger.warn('Could not set environment variable automatically:', error);
      logger.info(`Manual backup: PERSISTENT_WALLETS=${JSON.stringify(storage)}`);
    }
  }

  /**
   * Validate Solana wallet address format
   */
  private isValidSolanaAddress(address: string): boolean {
    // Basic Solana address validation (base58, 32-44 characters)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
  }

  /**
   * Add a new wallet to tracking
   */
  async addWallet(address: string, label?: string): Promise<boolean> {
    if (!this.isValidSolanaAddress(address)) {
      throw new Error(`Invalid Solana address format: ${address}`);
    }

    const wallets = await this.loadWallets();
    
    // Check if wallet already exists
    const existingWallet = wallets.find(w => w.address === address);
    if (existingWallet) {
      if (existingWallet.isActive) {
        throw new Error(`Wallet ${address} is already being tracked`);
      } else {
        // Reactivate existing wallet
        existingWallet.isActive = true;
        existingWallet.label = label || existingWallet.label;
        await this.saveWallets(wallets);
        logger.info(`Reactivated wallet: ${address}`);
        return true;
      }
    }

    // Add new wallet
    const newWallet: TrackedWallet = {
      address,
      label,
      addedAt: new Date().toISOString(),
      isActive: true,
    };

    wallets.push(newWallet);
    await this.saveWallets(wallets);
    logger.info(`Added new wallet: ${address} ${label ? `(${label})` : ''}`);
    return true;
  }

  /**
   * Remove a wallet from tracking
   */
  async removeWallet(address: string): Promise<boolean> {
    const wallets = await this.loadWallets();
    const walletIndex = wallets.findIndex(w => w.address === address);
    
    if (walletIndex === -1) {
      throw new Error(`Wallet ${address} not found in tracking list`);
    }

    // Mark as inactive instead of deleting
    wallets[walletIndex].isActive = false;
    await this.saveWallets(wallets);
    logger.info(`Removed wallet from tracking: ${address}`);
    return true;
  }

  /**
   * Get all active wallets
   */
  async getActiveWallets(): Promise<TrackedWallet[]> {
    const wallets = await this.loadWallets();
    return wallets.filter(w => w.isActive);
  }

  /**
   * Get all wallets (active and inactive)
   */
  async getAllWallets(): Promise<TrackedWallet[]> {
    return await this.loadWallets();
  }

  /**
   * Get wallet by address
   */
  async getWallet(address: string): Promise<TrackedWallet | undefined> {
    const wallets = await this.loadWallets();
    return wallets.find(w => w.address === address);
  }

  /**
   * Get active wallet addresses for webhook registration
   */
  async getActiveWalletAddresses(): Promise<string[]> {
    const activeWallets = await this.getActiveWallets();
    return activeWallets.map(w => w.address);
  }
}
