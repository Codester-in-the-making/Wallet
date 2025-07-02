# Solana Wallet Tracker

A real-time Solana wallet transaction tracker that monitors wallet addresses and sends Discord notifications for all transaction activity including transfers, swaps, NFT trades, and more.

## Features

✅ **Real-time monitoring** - Instant notifications via Helius webhooks
✅ **Multiple wallets** - Track unlimited wallet addresses
✅ **Rich notifications** - Detailed Discord embeds with transaction info
✅ **Transaction filtering** - Monitors transfers, swaps, NFT trades, staking, and more
✅ **Error resilience** - Robust error handling and retry logic
✅ **Easy management** - Simple CLI commands to add/remove wallets

## Prerequisites

- Node.js 16+ installed
- Helius API key (free at [helius.dev](https://helius.dev))
- Discord webhook URL

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   - Copy `.env.example` to `.env`
   - Add your Helius API key and Discord webhook URL

3. **Add wallets to track:**
   ```bash
   npm run add-wallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM "My Wallet"
   ```

4. **Start the tracker:**
   ```bash
   npm run dev
   ```

## CLI Commands

### Add a wallet
```bash
npm run add-wallet <wallet-address> [optional-label]
```

### Remove a wallet
```bash
npm run remove-wallet <wallet-address>
```

### List all wallets
```bash
npm run list-wallets
```

### Start the tracker
```bash
npm run dev          # Development mode with auto-restart
npm run build        # Build for production
npm run start        # Start production build
```

## Configuration

Edit the `.env` file with your settings:

```env
# Helius API Configuration
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here

# Discord Configuration
DISCORD_WEBHOOK_URL=your_discord_webhook_url_here

# Server Configuration
PORT=3000
WEBHOOK_PATH=/webhook

# Application Configuration
WALLETS_FILE=./data/wallets.json
LOG_LEVEL=info
```

## How It Works

1. **Wallet Management**: Add wallet addresses you want to monitor using the CLI
2. **Webhook Registration**: The app automatically registers a webhook with Helius for your tracked wallets
3. **Real-time Monitoring**: Helius sends transaction data to your local server whenever tracked wallets have activity
4. **Discord Notifications**: Rich Discord embeds are sent with transaction details including:
   - Transaction type (transfer, swap, NFT trade, etc.)
   - Amounts and tokens involved
   - Wallet addresses (truncated for readability)
   - Transaction fees
   - Links to Solscan explorer
   - Timestamps

## Supported Transaction Types

The tracker monitors these transaction types:
- **Transfers**: SOL and token transfers
- **Swaps**: DEX trades and token swaps
- **NFT Activity**: Sales, listings, bids, mints
- **DeFi**: Staking, unstaking, liquidity provision
- **And many more**: See full list in the code

## API Endpoints

When running, the server provides these endpoints:

- `GET /health` - Health check
- `GET /status` - Current status and statistics
- `POST /test-discord` - Test Discord webhook
- `POST /webhooks/setup` - Manually setup webhook
- `GET /webhooks` - List all webhooks
- `DELETE /webhooks/cleanup` - Clean up all webhooks

## Troubleshooting

### Common Issues

1. **"No active wallets found"**
   - Add wallets using `npm run add-wallet <address>`
   - Verify wallets are active with `npm run list-wallets`

2. **Discord notifications not working**
   - Test with `curl -X POST http://localhost:3000/test-discord`
   - Verify Discord webhook URL in `.env`

3. **Webhook setup fails**
   - Check Helius API key is valid
   - Ensure server is accessible (use ngrok for external access)

### Logs

Logs are stored in the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Error logs only

## Development

### Project Structure
```
src/
├── index.ts                 # Main entry point
├── server.ts               # Express server setup
├── config.ts               # Configuration management
├── logger.ts               # Winston logging setup
├── types.ts                # TypeScript type definitions
├── walletManager.ts        # Wallet storage and management
├── heliusWebhookManager.ts # Helius webhook API integration
├── transactionProcessor.ts # Transaction data processing
├── discordNotifier.ts      # Discord webhook integration
└── cli.ts                  # Command-line interface
```

### Building
```bash
npm run build    # Compile TypeScript
npm run start    # Run compiled version
```

## License

MIT License - see LICENSE file for details.

## Support

For issues or questions:
1. Check the logs in `logs/` directory
2. Test individual components using the API endpoints
3. Verify your Helius API key and Discord webhook URL
4. Ensure wallet addresses are valid Solana addresses
