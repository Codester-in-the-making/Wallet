import axios from 'axios';
import { config } from './config';
import { logger } from './logger';
import { TransactionData, DiscordEmbed, DiscordMessage, DiscordField } from './types';
import { WalletManager } from './walletManager';

interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  price?: number;
  marketCap?: number;
}

interface EnhancedTransfer {
  type: 'BUY' | 'SELL' | 'TRANSFER';
  tokenAddress: string;
  tokenSymbol: string;
  tokenAmount: number;
  solAmount?: number;
  usdAmount?: number;
  marketCap?: number;
  fromAddress: string;
  toAddress: string;
  isUserSender: boolean;
}

export class DiscordNotifier {
  private webhookUrl: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second
  private tokenCache: Map<string, TokenMetadata> = new Map();
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.webhookUrl = config.discord.webhookUrl;
    this.walletManager = walletManager;
  }

  /**
   * Fetch token metadata from Helius
   */
  private async getTokenMetadata(mintAddress: string): Promise<TokenMetadata> {
    // Check cache first
    if (this.tokenCache.has(mintAddress)) {
      return this.tokenCache.get(mintAddress)!;
    }

    try {
      // Fetch from Helius Token Metadata API
      const response = await axios.post(
        `https://mainnet.helius-rpc.com/?api-key=${config.helius.apiKey}`,
        {
          jsonrpc: '2.0',
          id: 'token-metadata',
          method: 'getAsset',
          params: {
            id: mintAddress
          }
        }
      );

      const asset = response.data.result;
      const metadata: TokenMetadata = {
        symbol: asset?.content?.metadata?.symbol || 'UNKNOWN',
        name: asset?.content?.metadata?.name || 'Unknown Token',
        decimals: asset?.token_info?.decimals || 9
      };

      // Try to get price data from Jupiter/CoinGecko
      try {
        const priceResponse = await axios.get(
          `https://price.jup.ag/v4/price?ids=${mintAddress}`
        );

        if (priceResponse.data.data[mintAddress]) {
          metadata.price = priceResponse.data.data[mintAddress].price;
          metadata.marketCap = priceResponse.data.data[mintAddress].marketCap;
        }
      } catch (priceError) {
        logger.warn(`Could not fetch price for ${mintAddress}:`, priceError);
      }

      // Cache the result
      this.tokenCache.set(mintAddress, metadata);
      return metadata;
    } catch (error) {
      logger.error(`Error fetching token metadata for ${mintAddress}:`, error);

      // Return fallback metadata
      const fallback: TokenMetadata = {
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9
      };

      this.tokenCache.set(mintAddress, fallback);
      return fallback;
    }
  }

  /**
   * Analyze transaction to determine type and extract enhanced transfer data
   */
  private async analyzeTransaction(transaction: TransactionData, walletAddress: string): Promise<EnhancedTransfer[]> {
    const enhancedTransfers: EnhancedTransfer[] = [];

    // Process token transfers
    if (transaction.tokenTransfers && transaction.tokenTransfers.length > 0) {
      for (const transfer of transaction.tokenTransfers) {
        const isUserSender = transfer.fromUserAccount === walletAddress;
        const isUserReceiver = transfer.toUserAccount === walletAddress;

        if (!isUserSender && !isUserReceiver) continue; // Skip if user not involved

        const tokenMetadata = await this.getTokenMetadata(transfer.mint);
        const tokenAmount = transfer.tokenAmount / Math.pow(10, tokenMetadata.decimals);

        // Find corresponding SOL transfer to determine if it's a swap
        const correspondingSOLTransfer = transaction.nativeTransfers?.find(solTransfer => {
          // Look for SOL transfer in opposite direction
          return (isUserSender && solTransfer.toUserAccount === walletAddress) ||
                 (isUserReceiver && solTransfer.fromUserAccount === walletAddress);
        });

        let type: 'BUY' | 'SELL' | 'TRANSFER' = 'TRANSFER';
        let solAmount: number | undefined;
        let usdAmount: number | undefined;

        if (correspondingSOLTransfer) {
          // This is a swap
          solAmount = correspondingSOLTransfer.amount / 1e9;

          if (isUserSender) {
            type = 'SELL'; // User sent tokens, received SOL
          } else {
            type = 'BUY'; // User received tokens, sent SOL
          }

          // Calculate USD amount if we have SOL price (approximately $100 for now)
          if (solAmount) {
            usdAmount = solAmount * 100; // TODO: Get real SOL price
          }
        }

        enhancedTransfers.push({
          type,
          tokenAddress: transfer.mint,
          tokenSymbol: tokenMetadata.symbol,
          tokenAmount,
          solAmount,
          usdAmount,
          marketCap: tokenMetadata.marketCap,
          fromAddress: transfer.fromUserAccount,
          toAddress: transfer.toUserAccount,
          isUserSender
        });
      }
    }

    // Process pure SOL transfers (no token involved)
    if (transaction.nativeTransfers && transaction.nativeTransfers.length > 0) {
      for (const transfer of transaction.nativeTransfers) {
        const isUserSender = transfer.fromUserAccount === walletAddress;
        const isUserReceiver = transfer.toUserAccount === walletAddress;

        if (!isUserSender && !isUserReceiver) continue;

        // Skip if this SOL transfer was already processed as part of a swap
        const alreadyProcessed = enhancedTransfers.some(et =>
          et.solAmount && Math.abs(et.solAmount - (transfer.amount / 1e9)) < 0.000001
        );

        if (!alreadyProcessed) {
          const solAmount = transfer.amount / 1e9;

          enhancedTransfers.push({
            type: 'TRANSFER',
            tokenAddress: 'So11111111111111111111111111111111111111112', // SOL mint
            tokenSymbol: 'SOL',
            tokenAmount: solAmount,
            solAmount,
            usdAmount: solAmount * 100, // TODO: Get real SOL price
            fromAddress: transfer.fromUserAccount,
            toAddress: transfer.toUserAccount,
            isUserSender
          });
        }
      }
    }

    return enhancedTransfers;
  }

  /**
   * Send a transaction notification to Discord
   */
  async sendTransactionNotification(transaction: TransactionData, walletAddress: string): Promise<void> {
    try {
      // Get wallet information including custom name
      const wallet = await this.walletManager.getWallet(walletAddress);
      const walletName = wallet?.label || 'Unknown Wallet';

      const enhancedTransfers = await this.analyzeTransaction(transaction, walletAddress);
      const embed = await this.createEnhancedTransactionEmbed(transaction, walletAddress, walletName, enhancedTransfers);
      const message: DiscordMessage = {
        embeds: [embed]
      };

      await this.sendWithRetry(message);
      logger.info(`Discord notification sent for transaction: ${transaction.signature} (wallet: ${walletName})`);
    } catch (error) {
      logger.error('Failed to send Discord notification:', error);
      throw error;
    }
  }

  /**
   * Create an enhanced Discord embed for a transaction
   */
  private async createEnhancedTransactionEmbed(
    transaction: TransactionData,
    walletAddress: string,
    walletName: string,
    enhancedTransfers: EnhancedTransfer[]
  ): Promise<DiscordEmbed> {
    const fields: DiscordField[] = [];

    // Determine main transaction type
    const hasSwaps = enhancedTransfers.some(t => t.type === 'BUY' || t.type === 'SELL');
    const hasTransfers = enhancedTransfers.some(t => t.type === 'TRANSFER');

    let title = '📊 Transaction Detected';
    let color = 0x00ff00; // Default green

    if (hasSwaps) {
      const buyCount = enhancedTransfers.filter(t => t.type === 'BUY').length;
      const sellCount = enhancedTransfers.filter(t => t.type === 'SELL').length;

      if (buyCount > 0 && sellCount === 0) {
        title = '🟢 Token Purchase';
        color = 0x00ff00; // Green for buy
      } else if (sellCount > 0 && buyCount === 0) {
        title = '🔴 Token Sale';
        color = 0xff0000; // Red for sell
      } else {
        title = '🔄 Token Swap';
        color = 0xffaa00; // Orange for mixed
      }
    } else if (hasTransfers) {
      title = '💸 Transfer';
      color = 0x0099ff; // Blue for transfer
    }

    // Basic info
    fields.push({
      name: '🏦 Wallet',
      value: `**${walletName}**\n\`${this.truncateAddress(walletAddress)}\``,
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

    // Process each enhanced transfer
    for (const transfer of enhancedTransfers) {
      let emoji = '';
      let actionText = '';
      let valueText = '';

      if (transfer.type === 'BUY') {
        emoji = '🟢';
        actionText = 'BOUGHT';
        valueText = `**${transfer.tokenAmount.toLocaleString()} ${transfer.tokenSymbol}**`;

        if (transfer.solAmount) {
          valueText += `\nFor: **${transfer.solAmount.toFixed(4)} SOL**`;
        }
        if (transfer.usdAmount) {
          valueText += ` (~$${transfer.usdAmount.toFixed(2)})`;
        }
        if (transfer.marketCap) {
          valueText += `\nMarket Cap: $${(transfer.marketCap / 1000000).toFixed(2)}M`;
        }
        valueText += `\nCA: \`${transfer.tokenAddress}\``;

      } else if (transfer.type === 'SELL') {
        emoji = '🔴';
        actionText = 'SOLD';
        valueText = `**${transfer.tokenAmount.toLocaleString()} ${transfer.tokenSymbol}**`;

        if (transfer.solAmount) {
          valueText += `\nFor: **${transfer.solAmount.toFixed(4)} SOL**`;
        }
        if (transfer.usdAmount) {
          valueText += ` (~$${transfer.usdAmount.toFixed(2)})`;
        }
        if (transfer.marketCap) {
          valueText += `\nMarket Cap: $${(transfer.marketCap / 1000000).toFixed(2)}M`;
        }
        valueText += `\nCA: \`${transfer.tokenAddress}\``;

      } else { // TRANSFER
        emoji = '💸';
        actionText = transfer.isUserSender ? 'SENT' : 'RECEIVED';

        if (transfer.tokenSymbol === 'SOL') {
          valueText = `**${transfer.tokenAmount.toFixed(6)} SOL**`;
          if (transfer.usdAmount) {
            valueText += ` (~$${transfer.usdAmount.toFixed(2)})`;
          }
        } else {
          valueText = `**${transfer.tokenAmount.toLocaleString()} ${transfer.tokenSymbol}**`;
          valueText += `\nCA: \`${transfer.tokenAddress}\``;
        }

        const otherAddress = transfer.isUserSender ? transfer.toAddress : transfer.fromAddress;
        valueText += `\n${transfer.isUserSender ? 'To' : 'From'}: \`${this.truncateAddress(otherAddress)}\``;
      }

      fields.push({
        name: `${emoji} ${actionText} ${transfer.tokenSymbol}`,
        value: valueText,
        inline: false
      });
    }

    // Transaction link
    fields.push({
      name: '🔗 Transaction',
      value: `[View on Solscan](https://solscan.io/tx/${transaction.signature})`,
      inline: false
    });

    return {
      title,
      description: `Transaction processed for **${walletName}** (${this.truncateAddress(walletAddress)})`,
      color,
      fields,
      timestamp: new Date(transaction.timestamp * 1000).toISOString(),
      footer: {
        text: 'Solana Wallet Tracker'
      }
    };
  }

  /**
   * Create a Discord embed for a transaction (legacy method)
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
