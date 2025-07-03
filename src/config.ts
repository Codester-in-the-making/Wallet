import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export interface Config {
  helius: {
    apiKey: string;
    rpcUrl: string;
  };
  discord: {
    webhookUrl: string;
  };
  server: {
    port: number;
    webhookPath: string;
  };
  app: {
    walletsFile: string;
    logLevel: string;
  };
}

function validateEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
}

export const config: Config = {
  helius: {
    apiKey: validateEnvVar('HELIUS_API_KEY', process.env.HELIUS_API_KEY),
    rpcUrl: validateEnvVar('HELIUS_RPC_URL', process.env.HELIUS_RPC_URL),
  },
  discord: {
    webhookUrl: validateEnvVar('DISCORD_WEBHOOK_URL', process.env.DISCORD_WEBHOOK_URL),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    webhookPath: process.env.WEBHOOK_PATH || '/webhook',
  },
  app: {
    walletsFile: process.env.WALLETS_FILE || '/tmp/wallets.json',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

// Validate configuration on startup
export function validateConfig(): void {
  console.log('✅ Configuration loaded successfully');
  console.log(`📡 Server will run on port ${config.server.port}`);
  console.log(`📁 Wallets file: ${config.app.walletsFile}`);
  console.log(`📝 Log level: ${config.app.logLevel}`);
}
