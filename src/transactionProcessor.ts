import { TransactionData } from './types';
import { logger } from './logger';
import { DiscordNotifier } from './discordNotifier';
import { WalletManager } from './walletManager';

export class TransactionProcessor {
  private discordNotifier: DiscordNotifier;
  private walletManager: WalletManager;

  constructor(discordNotifier: DiscordNotifier, walletManager: WalletManager) {
    this.discordNotifier = discordNotifier;
    this.walletManager = walletManager;
  }

  /**
   * Process incoming webhook transaction data
   */
  async processTransaction(webhookData: any): Promise<void> {
    try {
      logger.info('Processing transaction webhook data');
      
      // Extract transaction data from webhook payload
      const transactions = this.extractTransactions(webhookData);
      
      for (const transaction of transactions) {
        await this.handleSingleTransaction(transaction);
      }
    } catch (error) {
      logger.error('Error processing transaction:', error);
      throw error;
    }
  }

  /**
   * Extract transaction data from Helius webhook payload
   */
  private extractTransactions(webhookData: any): TransactionData[] {
    const transactions: TransactionData[] = [];
    
    try {
      // Handle different webhook payload structures
      if (Array.isArray(webhookData)) {
        // Array of transactions
        for (const item of webhookData) {
          const transaction = this.parseTransactionData(item);
          if (transaction) {
            transactions.push(transaction);
          }
        }
      } else if (webhookData.transaction || webhookData.meta) {
        // Single transaction
        const transaction = this.parseTransactionData(webhookData);
        if (transaction) {
          transactions.push(transaction);
        }
      } else {
        logger.warn('Unknown webhook payload structure:', JSON.stringify(webhookData, null, 2));
      }
    } catch (error) {
      logger.error('Error extracting transactions from webhook data:', error);
    }

    return transactions;
  }

  /**
   * Parse individual transaction data
   */
  private parseTransactionData(data: any): TransactionData | null {
    try {
      // Handle Helius enhanced transaction format
      if (data.type && data.signature) {
        return {
          signature: data.signature,
          slot: data.slot || 0,
          timestamp: data.timestamp || Math.floor(Date.now() / 1000),
          fee: data.fee || 0,
          feePayer: data.feePayer || '',
          instructions: data.instructions || [],
          nativeTransfers: data.nativeTransfers || [],
          tokenTransfers: data.tokenTransfers || [],
          accountData: data.accountData || [],
          transactionError: data.transactionError,
          type: data.type,
          source: data.source || 'helius',
          description: data.description || this.generateDescription(data)
        };
      }

      // Handle raw transaction format
      if (data.transaction && data.meta) {
        return this.parseRawTransaction(data);
      }

      logger.warn('Unable to parse transaction data:', JSON.stringify(data, null, 2));
      return null;
    } catch (error) {
      logger.error('Error parsing transaction data:', error);
      return null;
    }
  }

  /**
   * Parse raw Solana transaction format
   */
  private parseRawTransaction(data: any): TransactionData | null {
    try {
      const transaction = data.transaction;
      const meta = data.meta;

      return {
        signature: transaction.signatures?.[0] || '',
        slot: data.slot || 0,
        timestamp: data.blockTime || Math.floor(Date.now() / 1000),
        fee: meta.fee || 0,
        feePayer: transaction.message?.accountKeys?.[0] || '',
        instructions: transaction.message?.instructions || [],
        nativeTransfers: this.extractNativeTransfers(data),
        tokenTransfers: this.extractTokenTransfers(data),
        accountData: this.extractAccountData(data),
        transactionError: meta.err,
        type: 'UNKNOWN',
        source: 'raw',
        description: 'Raw transaction data'
      };
    } catch (error) {
      logger.error('Error parsing raw transaction:', error);
      return null;
    }
  }

  /**
   * Extract native SOL transfers from raw transaction
   */
  private extractNativeTransfers(data: any): any[] {
    const transfers: any[] = [];
    
    try {
      const meta = data.meta;
      const preBalances = meta.preBalances || [];
      const postBalances = meta.postBalances || [];
      const accountKeys = data.transaction?.message?.accountKeys || [];

      for (let i = 0; i < preBalances.length; i++) {
        const preBalance = preBalances[i];
        const postBalance = postBalances[i];
        const difference = postBalance - preBalance;

        if (Math.abs(difference) > 0) {
          // Find corresponding transfers
          for (let j = 0; j < preBalances.length; j++) {
            if (i !== j) {
              const otherDifference = postBalances[j] - preBalances[j];
              if (Math.abs(difference + otherDifference) < 1000) { // Account for fees
                transfers.push({
                  fromUserAccount: accountKeys[difference < 0 ? i : j],
                  toUserAccount: accountKeys[difference < 0 ? j : i],
                  amount: Math.abs(difference)
                });
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error extracting native transfers:', error);
    }

    return transfers;
  }

  /**
   * Extract token transfers from raw transaction
   */
  private extractTokenTransfers(data: any): any[] {
    const transfers: any[] = [];
    
    try {
      const meta = data.meta;
      const preTokenBalances = meta.preTokenBalances || [];
      const postTokenBalances = meta.postTokenBalances || [];

      // Match pre and post token balances to find transfers
      for (const preBalance of preTokenBalances) {
        const postBalance = postTokenBalances.find(
          (post: any) => post.accountIndex === preBalance.accountIndex
        );

        if (postBalance) {
          const preAmount = parseInt(preBalance.uiTokenAmount?.amount || '0');
          const postAmount = parseInt(postBalance.uiTokenAmount?.amount || '0');
          const difference = postAmount - preAmount;

          if (difference !== 0) {
            transfers.push({
              fromUserAccount: preBalance.owner,
              toUserAccount: postBalance.owner,
              fromTokenAccount: preBalance.accountIndex,
              toTokenAccount: postBalance.accountIndex,
              tokenAmount: Math.abs(difference),
              mint: preBalance.mint,
              tokenStandard: 'fungible'
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error extracting token transfers:', error);
    }

    return transfers;
  }

  /**
   * Extract account data changes
   */
  private extractAccountData(data: any): any[] {
    const accountData: any[] = [];
    
    try {
      const meta = data.meta;
      const preBalances = meta.preBalances || [];
      const postBalances = meta.postBalances || [];
      const accountKeys = data.transaction?.message?.accountKeys || [];

      for (let i = 0; i < accountKeys.length; i++) {
        const preBalance = preBalances[i] || 0;
        const postBalance = postBalances[i] || 0;
        const nativeBalanceChange = postBalance - preBalance;

        if (nativeBalanceChange !== 0) {
          accountData.push({
            account: accountKeys[i],
            nativeBalanceChange,
            tokenBalanceChanges: [] // Would need more complex parsing for token balance changes
          });
        }
      }
    } catch (error) {
      logger.error('Error extracting account data:', error);
    }

    return accountData;
  }

  /**
   * Generate description for transaction
   */
  private generateDescription(data: any): string {
    if (data.nativeTransfers?.length > 0) {
      return 'SOL Transfer';
    }
    if (data.tokenTransfers?.length > 0) {
      return 'Token Transfer';
    }
    if (data.type) {
      return data.type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
    return 'Solana Transaction';
  }

  /**
   * Handle a single transaction
   */
  private async handleSingleTransaction(transaction: TransactionData): Promise<void> {
    try {
      // Get tracked wallets
      const trackedAddresses = await this.walletManager.getActiveWalletAddresses();
      
      // Check if this transaction involves any tracked wallets
      const involvedWallets = this.findInvolvedWallets(transaction, trackedAddresses);
      
      if (involvedWallets.length === 0) {
        logger.debug(`Transaction ${transaction.signature} does not involve tracked wallets`);
        return;
      }

      // Send notifications for each involved wallet
      for (const walletAddress of involvedWallets) {
        logger.info(`Sending notification for wallet ${walletAddress}, transaction ${transaction.signature}`);
        await this.discordNotifier.sendTransactionNotification(transaction, walletAddress);
      }
    } catch (error) {
      logger.error(`Error handling transaction ${transaction.signature}:`, error);
    }
  }

  /**
   * Find which tracked wallets are involved in the transaction
   */
  private findInvolvedWallets(transaction: TransactionData, trackedAddresses: string[]): string[] {
    const involvedWallets = new Set<string>();

    // Check fee payer
    if (trackedAddresses.includes(transaction.feePayer)) {
      involvedWallets.add(transaction.feePayer);
    }

    // Check native transfers
    if (transaction.nativeTransfers) {
      for (const transfer of transaction.nativeTransfers) {
        if (trackedAddresses.includes(transfer.fromUserAccount)) {
          involvedWallets.add(transfer.fromUserAccount);
        }
        if (trackedAddresses.includes(transfer.toUserAccount)) {
          involvedWallets.add(transfer.toUserAccount);
        }
      }
    }

    // Check token transfers
    if (transaction.tokenTransfers) {
      for (const transfer of transaction.tokenTransfers) {
        if (trackedAddresses.includes(transfer.fromUserAccount)) {
          involvedWallets.add(transfer.fromUserAccount);
        }
        if (trackedAddresses.includes(transfer.toUserAccount)) {
          involvedWallets.add(transfer.toUserAccount);
        }
      }
    }

    // Check account data
    if (transaction.accountData) {
      for (const account of transaction.accountData) {
        if (trackedAddresses.includes(account.account)) {
          involvedWallets.add(account.account);
        }
      }
    }

    return Array.from(involvedWallets);
  }
}
