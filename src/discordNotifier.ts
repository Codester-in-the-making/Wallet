import axios from 'axios';
import { config } from './config';
import { logger } from './logger';
import { TransactionData, DiscordEmbed, DiscordMessage, DiscordField } from './types';

export class DiscordNotifier {
  private webhookUrl: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor() {
    this.webhookUrl = config.discord.webhookUrl;
  }

  /**
   * Send a transaction notification to Discord
   */
  async sendTransactionNotification(transaction: TransactionData, walletAddress: string): Promise<void> {
    try {
      const embed = this.createTransactionEmbed(transaction, walletAddress);
      const message: DiscordMessage = {
        embeds: [embed]
      };

      await this.sendWithRetry(message);
      logger.info(`Discord notification sent for transaction: ${transaction.signature}`);
    } catch (error) {
      logger.error('Failed to send Discord notification:', error);
      throw error;
    }
  }

  /**
   * Create a Discord embed for a transaction
   */
  private createTransactionEmbed(transaction: TransactionData, walletAddress: string): DiscordEmbed {
    const fields: DiscordField[] = [];
    
    // Basic transaction info
    fields.push({
      name: '🏦 Wallet',
      value: `\`${this.truncateAddress(walletAddress)}\``,
      inline: true
    });

    fields.push({
      name: '⏰ Time',
      value: `<t:${Math.floor(transaction.timestamp)}:R>`,
      inline: true
    });

    fields.push({
      name: '💰 Fee',
      value: `${(transaction.fee / 1e9).toFixed(6)} SOL`,
      inline: true
    });

    // Add native transfers if present
    if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0) {
      transaction.nativeTransfers.forEach((transfer, index) => {
        const isOutgoing = transfer.fromUserAccount === walletAddress;
        const direction = isOutgoing ? '📤 Sent' : '📥 Received';
        const otherAddress = isOutgoing ? transfer.toUserAccount : transfer.fromUserAccount;
        
        fields.push({
          name: `${direction} SOL`,
          value: `**${(transfer.amount / 1e9).toFixed(6)} SOL**\n${isOutgoing ? 'To' : 'From'}: \`${this.truncateAddress(otherAddress)}\``,
          inline: false
        });
      });
    }

    // Add token transfers if present
    if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
      transaction.tokenTransfers.forEach((transfer, index) => {
        const isOutgoing = transfer.fromUserAccount === walletAddress;
        const direction = isOutgoing ? '📤 Sent' : '📥 Received';
        const otherAddress = isOutgoing ? transfer.toUserAccount : transfer.fromUserAccount;
        
        fields.push({
          name: `${direction} Token`,
          value: `**${transfer.tokenAmount} tokens**\nMint: \`${this.truncateAddress(transfer.mint)}\`\n${isOutgoing ? 'To' : 'From'}: \`${this.truncateAddress(otherAddress)}\``,
          inline: false
        });
      });
    }

    // Transaction signature and explorer link
    fields.push({
      name: '🔗 Transaction',
      value: `[View on Solscan](https://solscan.io/tx/${transaction.signature})`,
      inline: false
    });

    // Determine embed color based on transaction type
    let color = 0x00ff00; // Green default
    if (transaction.nativeTransfers?.some(t => t.fromUserAccount === walletAddress)) {
      color = 0xff6b6b; // Red for outgoing
    } else if (transaction.nativeTransfers?.some(t => t.toUserAccount === walletAddress)) {
      color = 0x4ecdc4; // Teal for incoming
    }

    return {
      title: `💳 ${this.getTransactionTypeEmoji(transaction)} Transaction Detected`,
      description: transaction.description || 'Solana transaction activity',
      color,
      fields,
      timestamp: new Date(transaction.timestamp * 1000).toISOString(),
      footer: {
        text: 'Solana Wallet Tracker'
      }
    };
  }

  /**
   * Get emoji for transaction type
   */
  private getTransactionTypeEmoji(transaction: TransactionData): string {
    const type = transaction.type?.toLowerCase() || '';
    
    if (type.includes('swap')) return '🔄';
    if (type.includes('transfer')) return '💸';
    if (type.includes('stake')) return '🥩';
    if (type.includes('unstake')) return '📤';
    if (type.includes('vote')) return '🗳️';
    if (type.includes('nft')) return '🖼️';
    
    return '💳';
  }

  /**
   * Truncate address for display
   */
  private truncateAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }

  /**
   * Send message with retry logic
   */
  private async sendWithRetry(message: DiscordMessage, attempt: number = 1): Promise<void> {
    try {
      await axios.post(this.webhookUrl, message, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      });
    } catch (error) {
      if (attempt < this.maxRetries) {
        logger.warn(`Discord notification failed (attempt ${attempt}/${this.maxRetries}), retrying...`);
        await this.delay(this.retryDelay * attempt);
        return this.sendWithRetry(message, attempt + 1);
      }
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          logger.error('Discord rate limit exceeded');
        } else {
          logger.error(`Discord webhook error: ${error.response?.status} - ${error.response?.statusText}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Delay utility for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test Discord webhook connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const testMessage: DiscordMessage = {
        embeds: [{
          title: '🧪 Test Notification',
          description: 'Solana Wallet Tracker is now active and monitoring your wallets!',
          color: 0x00ff00,
          fields: [
            {
              name: '✅ Status',
              value: 'Connected successfully',
              inline: true
            },
            {
              name: '⏰ Time',
              value: new Date().toLocaleString(),
              inline: true
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: 'Solana Wallet Tracker - Test'
          }
        }]
      };

      await this.sendWithRetry(testMessage);
      logger.info('Discord test notification sent successfully');
      return true;
    } catch (error) {
      logger.error('Discord test notification failed:', error);
      return false;
    }
  }
}
