/**
 * Type definitions for mempool-related data structures
 */

/**
 * Represents a packet of data from the mempool
 */
export interface MempoolPacket {
  id: string;
  timestamp: number;
  data?: any;
  
  // Additional fields that might be present in mempool packets
  transactions?: any[];
  messages?: any[];
  hash?: string | Buffer;
}

/**
 * Information about a DEX
 */
export interface DexInfo {
  dex: string;
  tokenPair: string;
  price: number;
}

/**
 * Details specific to arbitrage opportunities
 */
export interface ArbitrageOpportunityDetails {
  buyDex: string;
  sellDex: string;
  tokenPair: string;
  priceDifferencePercent: number;
  buyAmount: number;
  sellAmount: number;
  estimatedProfit: number;
  estimatedGas: number;
  executionPlan: string;
}

/**
 * Configuration for the arbitrage strategy
 */
export interface ArbitrageConfig {
  dexes: string[];
  minPriceDifferencePercent: number;
  maxSlippage: number;
  minProfitEstimate: number;
  minConfidence: number;
  gasBuffer: number;
}
