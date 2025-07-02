#!/usr/bin/env node

import { WalletManager } from './walletManager';
import { logger } from './logger';
import { validateConfig } from './config';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    const walletManager = new WalletManager();
    await walletManager.initialize();

    const command = process.argv[2];
    const args = process.argv.slice(3);

    switch (command) {
      case 'add':
        await handleAddWallet(walletManager, args);
        break;
      case 'remove':
        await handleRemoveWallet(walletManager, args);
        break;
      case 'list':
        await handleListWallets(walletManager);
        break;
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function handleAddWallet(walletManager: WalletManager, args: string[]) {
  if (args.length === 0) {
    console.error('❌ Please provide a wallet address');
    console.log('Usage: npm run add-wallet <address> [label]');
    return;
  }

  const address = args[0];
  const label = args[1];

  try {
    await walletManager.addWallet(address, label);
    console.log(`✅ Successfully added wallet: ${address}`);
    if (label) {
      console.log(`   Label: ${label}`);
    }
    console.log('💡 Restart the tracker to begin monitoring this wallet');
  } catch (error) {
    console.error('❌ Failed to add wallet:', error instanceof Error ? error.message : error);
  }
}

async function handleRemoveWallet(walletManager: WalletManager, args: string[]) {
  if (args.length === 0) {
    console.error('❌ Please provide a wallet address');
    console.log('Usage: npm run remove-wallet <address>');
    return;
  }

  const address = args[0];

  try {
    await walletManager.removeWallet(address);
    console.log(`✅ Successfully removed wallet: ${address}`);
    console.log('💡 Restart the tracker to stop monitoring this wallet');
  } catch (error) {
    console.error('❌ Failed to remove wallet:', error instanceof Error ? error.message : error);
  }
}

async function handleListWallets(walletManager: WalletManager) {
  try {
    const allWallets = await walletManager.getAllWallets();
    const activeWallets = allWallets.filter(w => w.isActive);
    const inactiveWallets = allWallets.filter(w => !w.isActive);

    console.log('\n📊 Wallet Tracking Status\n');
    
    if (activeWallets.length > 0) {
      console.log('🟢 Active Wallets:');
      activeWallets.forEach((wallet, index) => {
        console.log(`  ${index + 1}. ${wallet.address}`);
        if (wallet.label) {
          console.log(`     Label: ${wallet.label}`);
        }
        console.log(`     Added: ${new Date(wallet.addedAt).toLocaleString()}`);
        console.log('');
      });
    } else {
      console.log('🟢 Active Wallets: None');
    }

    if (inactiveWallets.length > 0) {
      console.log('🔴 Inactive Wallets:');
      inactiveWallets.forEach((wallet, index) => {
        console.log(`  ${index + 1}. ${wallet.address}`);
        if (wallet.label) {
          console.log(`     Label: ${wallet.label}`);
        }
        console.log(`     Added: ${new Date(wallet.addedAt).toLocaleString()}`);
        console.log('');
      });
    }

    console.log(`📈 Total: ${allWallets.length} wallets (${activeWallets.length} active, ${inactiveWallets.length} inactive)`);
  } catch (error) {
    console.error('❌ Failed to list wallets:', error instanceof Error ? error.message : error);
  }
}

function showHelp() {
  console.log(`
🔍 Solana Wallet Tracker CLI

Usage:
  npm run add-wallet <address> [label]     Add a wallet to tracking
  npm run remove-wallet <address>         Remove a wallet from tracking  
  npm run list-wallets                    List all tracked wallets
  npm run dev                             Start the tracker server

Examples:
  npm run add-wallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM "My Wallet"
  npm run remove-wallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
  npm run list-wallets

For more information, visit: https://github.com/helius-labs/helius-sdk
`);
}

// Run the CLI
if (require.main === module) {
  main();
}
