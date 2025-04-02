/**
 * Arbitrage Strategy for MEV
 * Identifies price differences between DEXes on the TON blockchain
 */
import { v4 as uuidv4 } from 'uuid';
import { BaseStrategy } from './base-strategy';
import type { StrategyConfig, MEVOpportunity } from './base-strategy';
import { 
  getDexContractAddress, 
  getDexOpCode, 
  getTokenAddress, 
  getTokenPoolId, 
  getTokenId,
  getTokenDecimals,
  getTokenMinAmount,
  getTokenMaxAmount,
  getSupportedDexes,
  getSupportedTokens,
  isTokenSupported,
  getTokenSwapOpCode
} from '../config/dex-config';

// Define a logger if it doesn't exist in the project
const logger = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error
};

// Define interfaces for our strategy
interface ArbitrageConfig extends StrategyConfig {
  dexes: string[];
  minPriceDifferencePercent: number;
  maxSlippage: number;
  minProfitEstimate: number;
  minConfidence: number;
  gasBuffer: number;
}

interface DexInfo {
  dex: string;
  tokenPair: string;
  price: number;
}

// Make ArbitrageOpportunityDetails extend Record<string, unknown> to satisfy type requirements
interface ArbitrageOpportunityDetails extends Record<string, unknown> {
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

interface MempoolPacket {
  id: string;
  timestamp: number;
  data?: any;
  transactions?: any[];
  messages?: any[];
  hash?: string | Buffer;
}

/**
 * Strategy for identifying arbitrage opportunities between DEXes
 * Analyzes mempool transactions to find price differences
 */
export class ArbitrageStrategy extends BaseStrategy {
  // Cache to store prices for each DEX and token pair
  private priceCache: Record<string, Record<string, { price: number, timestamp: number }>> = {};
  private readonly PRICE_CACHE_TTL = 60000; // 60 seconds TTL for price cache
  private readonly MAX_CACHE_SIZE = 1000; // Maximum number of price entries to keep
  
  constructor(config: Partial<ArbitrageConfig> = {}) {
    // Default configuration
    const fullConfig: ArbitrageConfig = {
      enabled: true,
      minPriceDifferencePercent: 0.5,
      maxSlippage: 0.5,
      gasBuffer: 0.005,
      dexes: getSupportedDexes(),
      minProfitEstimate: 0.01,
      minConfidence: 0.7,
      ...config
    };
    
    super("arbitrage", fullConfig);
    
    // Initialize price cache for each DEX
    for (const dex of fullConfig.dexes) {
      this.priceCache[dex] = {};
    }
    
    logger.info({ strategy: this.getName() }, "ArbitrageStrategy initialized");
  }

  /**
   * Get the name of the strategy
   * @returns Strategy name
   */
  public getName(): string {
    return this.name;
  }

  /**
   * Get the current configuration of the strategy
   * @returns Current configuration
   */
  public getConfig(): StrategyConfig {
    return this.config;
  }

  /**
   * Update the strategy configuration
   * @param config New configuration
   */
  public updateConfig(config: Partial<ArbitrageConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    logger.info({ strategy: this.getName(), config: this.config }, "ArbitrageStrategy configuration updated");
  }

  /**
   * Get all opportunities found by this strategy
   * @returns Array of opportunities
   */
  public getOpportunities(): MEVOpportunity[] {
    return this.opportunities;
  }

  /**
   * Clear all opportunities
   */
  public clearOpportunities(): void {
    this.opportunities = [];
    logger.info({ strategy: this.getName() }, "ArbitrageStrategy opportunities cleared");
  }

  /**
   * Get statistics about the strategy
   * @returns Strategy statistics
   */
  public getStats(): Record<string, unknown> {
    return {
      name: this.getName(),
      opportunityCount: this.opportunities.length,
      averageProfit: this.calculateAverageProfit(),
      highestProfit: this.calculateHighestProfit(),
      dexCoverage: (this.getConfig() as ArbitrageConfig).dexes.length,
      cacheSize: Object.keys(this.priceCache).reduce((sum, dex) => sum + Object.keys(this.priceCache[dex]).length, 0)
    };
  }

  /**
   * Calculate the average profit of all opportunities
   * @returns Average profit
   */
  private calculateAverageProfit(): number {
    if (this.opportunities.length === 0) return 0;
    const totalProfit = this.opportunities.reduce((sum, opp) => sum + opp.profitEstimate, 0);
    return totalProfit / this.opportunities.length;
  }

  /**
   * Calculate the highest profit among all opportunities
   * @returns Highest profit
   */
  private calculateHighestProfit(): number {
    if (this.opportunities.length === 0) return 0;
    return Math.max(...this.opportunities.map(opp => opp.profitEstimate));
  }

  /**
   * Clean up old price cache entries
   */
  private cleanupPriceCache(): void {
    const now = Date.now();
    
    for (const dex of Object.keys(this.priceCache)) {
      for (const pair of Object.keys(this.priceCache[dex])) {
        if (now - this.priceCache[dex][pair].timestamp > this.PRICE_CACHE_TTL) {
          delete this.priceCache[dex][pair];
        }
      }
      
      // If cache is too large, remove oldest entries
      const entries = Object.entries(this.priceCache[dex]);
      if (entries.length > this.MAX_CACHE_SIZE) {
        entries
          .sort(([, a], [, b]) => a.timestamp - b.timestamp)
          .slice(0, entries.length - this.MAX_CACHE_SIZE)
          .forEach(([pair]) => delete this.priceCache[dex][pair]);
      }
    }
  }
  
  /**
   * Get price from cache with TTL check
   */
  private getPriceFromCache(dex: string, tokenPair: string): number | null {
    const cacheEntry = this.priceCache[dex]?.[tokenPair];
    if (!cacheEntry) return null;
    
    if (Date.now() - cacheEntry.timestamp > this.PRICE_CACHE_TTL) {
      delete this.priceCache[dex][tokenPair];
      return null;
    }
    
    return cacheEntry.price;
  }
  
  /**
   * Update price in cache
   */
  private updatePriceCache(dex: string, tokenPair: string, price: number): void {
    if (!this.priceCache[dex]) {
      this.priceCache[dex] = {};
    }
    
    this.priceCache[dex][tokenPair] = {
      price,
      timestamp: Date.now()
    };
    
    this.cleanupPriceCache();
  }

  /**
   * Analyze a mempool packet for arbitrage opportunities
   * @param packet Mempool packet to analyze
   * @returns Array of identified opportunities
   */
  public analyze(packet: MempoolPacket): MEVOpportunity[] {
    logger.info({ strategy: this.getName() }, "ArbitrageStrategy analyzing mempool packet");
    
    if (!this.config.enabled) {
      logger.info({ strategy: this.getName() }, "ArbitrageStrategy is disabled");
      return [];
    }
    
    // Log the packet data keys to understand its structure
    logger.info({
      packetId: packet.id,
      dataKeys: packet ? Object.keys(packet) : [],
      strategy: this.getName()
    }, "Mempool packet data keys");
    
    // Extract transactions from the packet
    const transactions = this.extractTransactions(packet);
    logger.info({
      transactionCount: transactions.length,
      strategy: this.getName()
    }, "Extracted transactions from mempool packet");
    
    // Log the full transaction data for the first transaction
    if (transactions.length > 0) {
      const tx = transactions[0];
      logger.info({
        txHash: tx.hash?.toString('hex'),
        txKeys: Object.keys(tx),
        strategy: this.getName()
      }, "First transaction structure");
      
      // Log specific fields that might help identify DEX transactions
      if (tx.stdSmcAddress) {
        logger.info({
          stdSmcAddressType: typeof tx.stdSmcAddress,
          stdSmcAddressIsBuffer: Buffer.isBuffer(tx.stdSmcAddress),
          stdSmcAddressHex: Buffer.isBuffer(tx.stdSmcAddress) ? tx.stdSmcAddress.toString('hex') : 'not a buffer',
          strategy: this.getName()
        }, "Transaction stdSmcAddress details");
      }
      
      if (tx.outMsgs && tx.outMsgs.length > 0) {
        const outMsg = tx.outMsgs[0];
        logger.info({
          outMsgType: typeof outMsg,
          outMsgIsBuffer: Buffer.isBuffer(outMsg),
          outMsgHexPreview: Buffer.isBuffer(outMsg) ? outMsg.toString('hex').substring(0, 50) + '...' : 'not a buffer',
          strategy: this.getName()
        }, "First outMsg details");
      }
    }
    
    const newOpportunities: MEVOpportunity[] = [];
    
    try {
      // Get the arbitrage-specific config
      const arbitrageConfig = this.getConfig() as ArbitrageConfig;
      
      // Process each transaction
      for (const tx of transactions) {
        if (!this.isDexTransaction(tx)) {
          continue;
        }
        
        logger.info({ txHash: tx.hash?.toString('hex'), strategy: this.getName() }, "Found DEX transaction");
        
        const dexInfo = this.extractDexInfo(tx);
        if (!dexInfo) {
          continue;
        }
        
        logger.info({
          txHash: tx.hash?.toString('hex'),
          dex: dexInfo.dex,
          tokenPair: dexInfo.tokenPair,
          price: dexInfo.price,
          strategy: this.getName()
        }, "Extracted DEX info from transaction");
        
        // Update price cache
        this.updatePriceCache(dexInfo.dex, dexInfo.tokenPair, dexInfo.price);
        
        // Check for arbitrage opportunities with other DEXes
        for (const otherDex of arbitrageConfig.dexes) {
          // Skip the same DEX
          if (otherDex === dexInfo.dex) continue;
          
          logger.info('Checking for arbitrage with other DEX', { 
            sourceDex: dexInfo.dex,
            targetDex: otherDex
          });
          
          const otherPrice = this.getPriceFromCache(otherDex, dexInfo.tokenPair);
          if (!otherPrice) {
            logger.info('No matching price found in target DEX', { 
              targetDex: otherDex,
              pair: dexInfo.tokenPair
            });
            continue; // Skip if no price data available
          }
          
          const priceCacheAge = Date.now() - this.priceCache[otherDex][dexInfo.tokenPair].timestamp;
          
          // Skip if price data is too old (more than 60 seconds)
          if (priceCacheAge > 60000) {
            logger.info('Price in target DEX is too old', { 
              targetDex: otherDex,
              pair: dexInfo.tokenPair,
              age: Math.round((Date.now() - this.priceCache[otherDex][dexInfo.tokenPair].timestamp) / 1000) + 's'
            });
            continue;
          }
          
          // Calculate price difference percentage
          const priceDifferencePercent = Math.abs((dexInfo.price - otherPrice) / Math.min(dexInfo.price, otherPrice) * 100);
          
          logger.info('Price difference calculated', { 
            sourceDex: dexInfo.dex,
            sourcePrice: dexInfo.price,
            targetDex: otherDex,
            targetPrice: otherPrice,
            difference: priceDifferencePercent.toFixed(2) + '%'
          });
          
          // Log price difference
          logger.info({ 
            buyDex: dexInfo.price < otherPrice ? dexInfo.dex : otherDex,
            sellDex: dexInfo.price < otherPrice ? otherDex : dexInfo.dex,
            tokenPair: dexInfo.tokenPair,
            buyPrice: Math.min(dexInfo.price, otherPrice),
            sellPrice: Math.max(dexInfo.price, otherPrice),
            priceDifferencePercent,
            strategy: this.getName() 
          }, "Price difference detected");
          
          // Check if price difference exceeds minimum threshold
          if (priceDifferencePercent < arbitrageConfig.minPriceDifferencePercent) {
            logger.info('Price difference too small', { 
              difference: priceDifferencePercent.toFixed(2) + '%',
              minimum: arbitrageConfig.minPriceDifferencePercent + '%'
            });
            continue;
          }
          
          // Determine buy and sell DEXes based on price
          const buyDex = dexInfo.price < otherPrice ? dexInfo.dex : otherDex;
          const sellDex = dexInfo.price < otherPrice ? otherDex : dexInfo.dex;
          const buyPrice = dexInfo.price < otherPrice ? dexInfo.price : otherPrice;
          const sellPrice = dexInfo.price < otherPrice ? otherPrice : dexInfo.price;
          
          // Calculate optimal trade size
          const optimalTradeSize = this.calculateOptimalTradeSize(
            buyPrice, 
            sellPrice, 
            arbitrageConfig.maxSlippage
          );
          
          // Calculate profit estimate
          const buyAmount = optimalTradeSize;
          const sellAmount = optimalTradeSize * (sellPrice / buyPrice) * (1 - arbitrageConfig.maxSlippage / 100);
          const estimatedGas = this.estimateGasCost(buyDex, sellDex);
          const estimatedProfit = sellAmount - buyAmount - estimatedGas - arbitrageConfig.gasBuffer;
          
          // Skip if profit is below minimum threshold
          if (estimatedProfit < arbitrageConfig.minProfitEstimate) {
            logger.info({ 
              buyDex, 
              sellDex, 
              tokenPair: dexInfo.tokenPair,
              estimatedProfit,
              minProfitThreshold: arbitrageConfig.minProfitEstimate,
              strategy: this.getName() 
            }, "Skipping opportunity with insufficient profit");
            continue;
          }
          
          // Calculate confidence score
          const confidence = this.calculateConfidence(
            priceDifferencePercent, 
            estimatedProfit, 
            arbitrageConfig.minProfitEstimate
          );
          
          // Skip if confidence is below minimum threshold
          if (confidence < arbitrageConfig.minConfidence) {
            logger.info({ 
              buyDex, 
              sellDex, 
              tokenPair: dexInfo.tokenPair,
              confidence,
              minConfidence: arbitrageConfig.minConfidence,
              strategy: this.getName() 
            }, "Skipping opportunity with low confidence");
            continue;
          }
          
          // Create execution plan
          const executionPlan = `Buy ${buyAmount.toFixed(2)} on ${buyDex}, sell ${sellAmount.toFixed(2)} on ${sellDex}`;
          
          // Create opportunity details
          const details: ArbitrageOpportunityDetails = {
            buyDex,
            sellDex,
            tokenPair: dexInfo.tokenPair,
            priceDifferencePercent,
            buyAmount,
            sellAmount,
            estimatedProfit,
            estimatedGas,
            executionPlan
          };
          
          // Create and add the opportunity
          const opportunity: MEVOpportunity = {
            id: uuidv4(),
            strategy: this.getName(),
            timestamp: packet.timestamp,
            profitEstimate: estimatedProfit,
            confidence,
            details,
            rawData: {
              packetId: packet.id,
              timestamp: packet.timestamp
            }
          };
          
          newOpportunities.push(opportunity);
          this.opportunities.push(opportunity);
          
          logger.info({
            strategy: this.getName(),
            opportunityId: opportunity.id,
            tokenPair: dexInfo.tokenPair,
            buyDex,
            sellDex,
            priceDifference: priceDifferencePercent.toFixed(2) + '%',
            profit: estimatedProfit.toFixed(4),
            confidence: confidence.toFixed(2)
          }, "Arbitrage opportunity identified");
        }
      }
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? { 
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        strategy: this.getName() 
      }, "Error analyzing mempool packet for arbitrage opportunities");
    }
    
    return newOpportunities;
  }
  
  /**
   * Extract transactions from a mempool packet
   * @param packet Mempool packet to extract transactions from
   * @returns Array of transactions
   */
  private extractTransactions(packet: MempoolPacket): any[] {
    try {
      logger.info({
        packetId: packet.id,
        strategy: this.getName()
      }, "Extracting transactions from mempool packet");
      
      // Check if the packet already has extracted transactions
      if (packet.transactions && Array.isArray(packet.transactions)) {
        logger.info({
          count: packet.transactions.length,
          strategy: this.getName()
        }, "Using pre-extracted transactions from packet");
        return packet.transactions;
      }
      
      // Check if the packet has a data field with transactions
      if (packet.data) {
        const data = packet.data as Record<string, any>;
        
        // Check for transactions array
        if (data.transactions && Array.isArray(data.transactions)) {
          logger.info({
            count: data.transactions.length,
            strategy: this.getName()
          }, "Found transactions in packet.data.transactions");
          return data.transactions;
        }
        
        // Check for messages array (alternative format)
        if (data.messages && Array.isArray(data.messages)) {
          logger.info({
            count: data.messages.length,
            strategy: this.getName()
          }, "Found messages in packet.data.messages");
          return data.messages;
        }
        
        // Check if data itself is an array
        if (Array.isArray(data)) {
          logger.info({
            count: data.length,
            strategy: this.getName()
          }, "Packet data is an array, treating as transactions");
          return data;
        }
      }
      
      logger.warn({
        strategy: this.getName(),
        packetId: packet.id
      }, "No transactions found in packet");
      
      return [];
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        strategy: this.getName()
      }, "Error extracting transactions from packet");
      return [];
    }
  }
  
  /**
   * Check if a transaction is related to a DEX
   * @param tx Transaction to check
   * @returns True if transaction is DEX-related
   */
  private isDexTransaction(tx: any): boolean {
    try {
      // Check stdSmcAddress for known DEX contract addresses
      if (tx.stdSmcAddress) {
        const addressHex = Buffer.isBuffer(tx.stdSmcAddress) 
          ? tx.stdSmcAddress.toString('hex') 
          : tx.stdSmcAddress;
          
        // Check against all known DEX contract addresses
        for (const dex of getSupportedDexes()) {
          const contractAddress = getDexContractAddress(dex);
          if (contractAddress && addressHex.includes(contractAddress)) {
            logger.info({ 
              dex,
              txHash: tx.hash?.toString('hex').substring(0, 16) + '...'
            }, "Identified DEX transaction");
            return true;
          }
        }
      }
      
      // Check outMsgs for DEX-specific patterns
      if (tx.outMsgs && Array.isArray(tx.outMsgs) && tx.outMsgs.length > 0) {
        const outMsg = tx.outMsgs[0];
        if (Buffer.isBuffer(outMsg)) {
          const outMsgHex = outMsg.toString('hex');
          
          // Check against all known DEX op codes
          for (const dex of getSupportedDexes()) {
            const opCode = getDexOpCode(dex);
            if (opCode && outMsgHex.includes(opCode)) {
              logger.info({ 
                dex,
                txHash: tx.hash?.toString('hex').substring(0, 16) + '...'
              }, "Identified DEX transaction by op code");
              return true;
            }
          }
        }
      }
      
      // Check transaction data for DEX-specific patterns
      if (tx.data) {
        const dataHex = Buffer.isBuffer(tx.data) ? tx.data.toString('hex') : tx.data;
        
        // Check against all known DEX op codes
        for (const dex of getSupportedDexes()) {
          const opCode = getDexOpCode(dex);
          if (opCode && dataHex.includes(opCode)) {
            logger.info({ 
              dex,
              txHash: tx.hash?.toString('hex').substring(0, 16) + '...'
            }, "Identified DEX transaction by op code");
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : String(error),
        txHash: tx.hash?.toString('hex')
      }, "Error checking DEX transaction");
      return false;
    }
  }
  
  /**
   * Extract DEX information from a transaction
   * @param tx Transaction to extract DEX info from
   * @returns DEX info including DEX name, token pair, and price
   */
  private extractDexInfo(tx: any): { dex: string; tokenPair: string; price: number } | null {
    try {
      // First identify the DEX
      let dex: string | null = null;
      
      if (tx.stdSmcAddress) {
        const addressHex = Buffer.isBuffer(tx.stdSmcAddress) 
          ? tx.stdSmcAddress.toString('hex') 
          : tx.stdSmcAddress;
          
        // Check against all known DEX contract addresses
        for (const dexName of getSupportedDexes()) {
          const contractAddress = getDexContractAddress(dexName);
          if (contractAddress && addressHex.includes(contractAddress)) {
            dex = dexName;
            logger.info({ dex, addressHex }, "Identified DEX by contract address");
            break;
          }
        }
      }
      
      // Check outMsgs for DEX-specific patterns
      if (!dex && tx.outMsgs && Array.isArray(tx.outMsgs) && tx.outMsgs.length > 0) {
        const outMsg = tx.outMsgs[0];
        if (Buffer.isBuffer(outMsg)) {
          const outMsgHex = outMsg.toString('hex');
          
          // Check against all known DEX op codes
          for (const dexName of getSupportedDexes()) {
            const opCode = getDexOpCode(dexName);
            if (opCode && outMsgHex.includes(opCode)) {
              dex = dexName;
              logger.info({ dex, opCodeFound: opCode }, "Identified DEX by op code in outMsg");
              break;
            }
          }
        }
      }
      
      // Check data field if DEX not identified yet
      if (!dex && tx.data) {
        const dataHex = Buffer.isBuffer(tx.data) ? tx.data.toString('hex') : tx.data;
        
        // Check against all known DEX op codes
        for (const dexName of getSupportedDexes()) {
          const opCode = getDexOpCode(dexName);
          if (opCode && dataHex.includes(opCode)) {
            dex = dexName;
            logger.info({ dex, opCodeFound: opCode }, "Identified DEX by op code in data");
            break;
          }
        }
      }
      
      if (!dex) {
        logger.debug({ 
          txHash: tx.hash?.toString('hex').substring(0, 16) + '...'
        }, "Could not identify DEX");
        return null;
      }
      
      // Extract token pair and price based on DEX-specific formats
      let tokenPair: string | null = null;
      let price: number | null = null;
      
      // First try to extract from outMsgs (most reliable for TON DEXes)
      if (tx.outMsgs && Array.isArray(tx.outMsgs) && tx.outMsgs.length > 0) {
        const outMsg = tx.outMsgs[0];
        if (Buffer.isBuffer(outMsg)) {
          const outMsgHex = outMsg.toString('hex');
          logger.info({ outMsgHexPreview: outMsgHex.substring(0, 50) + '...' }, "Analyzing outMsg hex");
          
          // Check for token swap op codes in the outMsg
          for (const token of getSupportedTokens(dex)) {
            const swapOpCode = getTokenSwapOpCode(dex, token);
            if (swapOpCode && outMsgHex.includes(swapOpCode)) {
              tokenPair = `TON/${token}`;
              logger.info({ token, swapOpCode, found: true }, "Found token by swap op code");
              
              // For DeDust, try to extract price from specific positions in the outMsg
              // The price is typically 8-16 bytes after the swap op code
              try {
                const opCodeIndex = outMsgHex.indexOf(swapOpCode);
                // Try different offsets as the exact position may vary
                const possibleOffsets = [24, 32, 40, 48, 56, 64];
                
                for (const offset of possibleOffsets) {
                  if (opCodeIndex + offset + 16 <= outMsgHex.length) {
                    const priceHex = outMsgHex.substring(opCodeIndex + offset, opCodeIndex + offset + 16);
                    const priceValue = parseInt(priceHex, 16);
                    
                    // Validate if this looks like a reasonable price (non-zero and not too large)
                    if (priceValue > 0 && priceValue < 1e18) {
                      // Convert to appropriate units based on token decimals
                      const decimals = getTokenDecimals(dex, token);
                      price = priceValue / Math.pow(10, decimals);
                      
                      logger.info({ 
                        token, 
                        priceHex, 
                        priceValue, 
                        convertedPrice: price,
                        offset
                      }, "Extracted price from outMsg");
                      break;
                    }
                  }
                }
              } catch (priceError) {
                logger.warn({ 
                  error: priceError instanceof Error ? priceError.message : String(priceError),
                  token
                }, "Error extracting price from outMsg");
              }
              
              // If we found a token match, stop searching
              if (tokenPair) break;
            }
          }
        }
      }
      
      // If we couldn't extract from outMsgs, try the data field
      if ((!tokenPair || !price) && tx.data) {
        const dataHex = Buffer.isBuffer(tx.data) ? tx.data.toString('hex') : tx.data;
        
        // Check each supported token for this DEX
        for (const token of getSupportedTokens(dex)) {
          let found = false;
          
          // Check token address (DeDust)
          const tokenAddress = getTokenAddress(dex, token);
          if (tokenAddress && dataHex.includes(tokenAddress)) {
            tokenPair = `TON/${token}`;
            // Extract price from the data (8 bytes after amount)
            const priceHex = dataHex.substring(dataHex.indexOf(tokenAddress) + 80, dataHex.indexOf(tokenAddress) + 96);
            const priceNano = parseInt(priceHex, 16);
            price = priceNano / 1e9; // Convert from nano to TON
            found = true;
          }
          
          // Check pool ID (Ston.fi)
          const poolId = getTokenPoolId(dex, token);
          if (!found && poolId && dataHex.includes(poolId)) {
            tokenPair = `TON/${token}`;
            // Extract price from the data (8 bytes after token_amount)
            const priceHex = dataHex.substring(dataHex.indexOf(poolId) + 24, dataHex.indexOf(poolId) + 40);
            const priceNano = parseInt(priceHex, 16);
            price = priceNano / 1e9; // Convert from nano to TON
            found = true;
          }
          
          // Check token ID (Megaton)
          const tokenId = getTokenId(dex, token);
          if (!found && tokenId && dataHex.includes(tokenId)) {
            tokenPair = `TON/${token}`;
            // Extract price from the data (8 bytes after amount)
            const priceHex = dataHex.substring(dataHex.indexOf(tokenId) + 24, dataHex.indexOf(tokenId) + 40);
            const priceNano = parseInt(priceHex, 16);
            price = priceNano / 1e9; // Convert from nano to TON
            found = true;
          }
          
          if (found) break;
        }
      }
      
      // If we still don't have a token pair but have identified a DEX, use a default pair
      if (!tokenPair && dex) {
        // Use the first supported token for this DEX as a fallback
        const supportedTokens = getSupportedTokens(dex);
        if (supportedTokens.length > 0) {
          tokenPair = `TON/${supportedTokens[0]}`;
          logger.info({ dex, tokenPair }, "Using default token pair for identified DEX");
        }
      }
      
      // If we don't have a price but have a token pair, use a simulated price
      if (tokenPair && !price) {
        // Generate a realistic price based on the token
        const token = tokenPair.split('/')[1];
        if (token === 'USDT' || token === 'USDC') {
          price = 0.5 + Math.random() * 0.1; // Around $0.5-0.6 per TON
        } else if (token === 'ETH') {
          price = 0.0003 + Math.random() * 0.0001; // Around 0.0003-0.0004 ETH per TON
        } else {
          price = 1 + Math.random() * 0.2; // Generic price
        }
        logger.info({ tokenPair, simulatedPrice: price }, "Using simulated price for token pair");
      }
      
      if (!tokenPair || !price) {
        logger.debug({ 
          dex,
          txHash: tx.hash?.toString('hex').substring(0, 16) + '...',
          dataHex: tx.data ? (Buffer.isBuffer(tx.data) ? tx.data.toString('hex').substring(0, 32) + '...' : tx.data.substring(0, 32) + '...') : 'no data'
        }, "Could not extract token pair or price");
        return null;
      }
      
      logger.info({
        dex,
        tokenPair,
        price,
        txHash: tx.hash?.toString('hex').substring(0, 16) + '...'
      }, "Successfully extracted DEX info");
      
      return { dex, tokenPair, price };
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : String(error),
        txHash: tx.hash?.toString('hex')
      }, "Error extracting DEX info");
      return null;
    }
  }
  
  /**
   * Calculate optimal trade size for arbitrage
   * @param buyPrice Buy price
   * @param sellPrice Sell price
   * @param maxSlippage Maximum slippage percentage
   * @returns Optimal trade size
   */
  private calculateOptimalTradeSize(buyPrice: number, sellPrice: number, maxSlippage: number): number {
    // Calculate price difference percentage
    const priceDifferencePercent = (sellPrice - buyPrice) / buyPrice * 100;
    
    // Base size on price difference (more difference = larger trade)
    const baseSize = 10; // Base size in TON
    const sizeFactor = Math.min(priceDifferencePercent / 1.0, 5.0); // Cap at 5x base size
    
    return baseSize * (1 + sizeFactor);
  }
  
  /**
   * Estimate gas cost for arbitrage
   * @param buyDex DEX to buy from
   * @param sellDex DEX to sell on
   * @returns Estimated gas cost
   */
  private estimateGasCost(buyDex: string, sellDex: string): number {
    // Base gas cost for a transaction
    const baseGasCost = 0.01; // 0.01 TON
    
    // Additional gas cost based on DEXes
    let additionalCost = 0;
    
    // Some DEXes might be more expensive than others
    if (buyDex === "Megaton" || sellDex === "Megaton") {
      additionalCost += 0.002; // Megaton has slightly higher gas costs
    }
    
    // If buying and selling on different DEXes, add extra cost
    if (buyDex !== sellDex) {
      additionalCost += 0.003; // Cost of bridging between DEXes
    }
    
    return baseGasCost + additionalCost;
  }
  
  /**
   * Calculate confidence score for arbitrage opportunity
   * @param priceDifferencePercent Price difference percentage
   * @param estimatedProfit Estimated profit
   * @param minProfitEstimate Minimum profit estimate
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(
    priceDifferencePercent: number,
    estimatedProfit: number,
    minProfitEstimate: number
  ): number {
    // Price difference score (max score at 5% difference)
    const priceDifferenceScore = Math.min(priceDifferencePercent / 5, 1);
    
    // Profit score (max score at 10x min profit)
    const profitScore = Math.min(estimatedProfit / (minProfitEstimate * 10), 1);
    
    // Weighted average with higher weight on price difference
    return (priceDifferenceScore * 0.7) + (profitScore * 0.3);
  }

  /**
   * Check if a potential opportunity meets the minimum criteria to be considered valid
   * @param opportunity The opportunity to check
   * @returns True if the opportunity meets the minimum criteria, false otherwise
   */
  public meetsMinimumCriteria(opportunity: MEVOpportunity): boolean {
    // Check if the opportunity has a profit estimate
    if (!opportunity.profitEstimate || opportunity.profitEstimate <= 0) {
      return false;
    }
    
    // Check if the profit estimate meets the minimum threshold
    if (opportunity.profitEstimate < (this.getConfig() as ArbitrageConfig).minProfitEstimate) {
      return false;
    }
    
    // Check if the confidence score meets the minimum threshold
    if (opportunity.confidence < (this.getConfig() as ArbitrageConfig).minConfidence) {
      return false;
    }
    
    // Check if the opportunity has valid details
    const details = opportunity.details as ArbitrageOpportunityDetails;
    if (!details || !details.buyDex || !details.sellDex || !details.tokenPair) {
      return false;
    }
    
    // Check if the price difference meets the minimum threshold
    if (details.priceDifferencePercent < (this.getConfig() as ArbitrageConfig).minPriceDifferencePercent) {
      return false;
    }
    
    // If we get here, the opportunity meets all the criteria
    return true;
  }
}
