export interface TrackedWallet {
  address: string;
  label?: string;
  addedAt: string;
  isActive: boolean;
}

export interface WalletStorage {
  wallets: TrackedWallet[];
  lastUpdated: string;
}

export interface TransactionData {
  signature: string;
  slot: number;
  timestamp: number;
  fee: number;
  feePayer: string;
  instructions: any[];
  nativeTransfers?: NativeTransfer[];
  tokenTransfers?: TokenTransfer[];
  accountData?: AccountData[];
  transactionError?: any;
  type: string;
  source: string;
  description: string;
}

export interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  mint: string;
  tokenStandard: string;
}

export interface AccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges?: TokenBalanceChange[];
}

export interface TokenBalanceChange {
  userAccount: string;
  tokenAccount: string;
  rawTokenAmount: {
    tokenAmount: string;
    decimals: number;
  };
  mint: string;
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: DiscordField[];
  timestamp: string;
  footer?: {
    text: string;
  };
}

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordMessage {
  embeds: DiscordEmbed[];
}
