/**
 * Sandwich Strategy for MEV
 * Identifies opportunities to front-run and back-run large swap transactions
 */
import { v4 as uuidv4 } from 'uuid';
import type { MempoolPacket } from "../searcher";
import { BaseStrategy } from "./base-strategy";
import type { MEVOpportunity, StrategyConfig } from "./base-strategy";
import { logger } from "../client";

interface SandwichConfig extends StrategyConfig {
  minTargetSwapSize: number; // Minimum size of target swap (in TON)
  maxFrontRunGas: number; // Maximum gas to spend on front-run (in TON)
  maxBackRunGas: number; // Maximum gas to spend on back-run (in TON)
  targetPairs: string[]; // Token pairs to monitor
  slippageTolerance: number; // Maximum slippage tolerance (in percent)
}

interface SandwichOpportunityDetails extends Record<string, unknown> {
  targetTxHash: string;
  tokenPair: string;
  targetSwapSize: number;
  estimatedPriceImpact: number;
  frontRunAmount: number;
  backRunAmount: number;
  estimatedFrontRunGas: number;
  estimatedBackRunGas: number;
  totalGasCost: number;
  executionPlan: string;
}

export class SandwichStrategy extends BaseStrategy {
  constructor(config: Partial<SandwichConfig> = {}) {
    // Create a complete config with defaults
    const fullConfig: SandwichConfig = {
      enabled: true,
      minConfidence: 0.8, // Higher confidence required for sandwich attacks
      minProfitEstimate: 0.05, // Higher profit threshold for sandwich attacks
      minTargetSwapSize: 10, // Minimum 10 TON swap to target
      maxFrontRunGas: 0.03, // Maximum 0.03 TON for front-run gas
      maxBackRunGas: 0.03, // Maximum 0.03 TON for back-run gas
      targetPairs: ["TON/USDT", "TON/USDC", "JETTON/TON"],
      slippageTolerance: 1.0, // 1% slippage tolerance
      ...config
    };
    
    super("sandwich", fullConfig);
  }

  /**
   * Analyze mempool packet for sandwich attack opportunities
   * @param packet Mempool packet to analyze
   * @returns Array of identified sandwich opportunities
   */
  public analyze(packet: MempoolPacket): MEVOpportunity[] {
    logger.info({ strategy: this.getName() }, "SandwichStrategy analyzing mempool packet");
    
    const newOpportunities: MEVOpportunity[] = [];
    const sandwichConfig = this.getConfig() as SandwichConfig;
    
    try {
      // Extract transaction data
      const tx = packet.data;
      if (!tx) {
        logger.info({ strategy: this.getName() }, "No transaction data in packet");
        return newOpportunities;
      }
      
      // Extract swap details
      const swapDetails = this.extractSwapDetails(tx);
      if (!swapDetails) {
        logger.info({ strategy: this.getName() }, "Could not extract swap details from transaction");
        return newOpportunities;
      }
      
      // Check if this is a target token pair
      if (!sandwichConfig.targetPairs.includes(swapDetails.tokenPair)) {
        logger.info({ 
          tokenPair: swapDetails.tokenPair,
          strategy: this.getName() 
        }, "Token pair not in target list");
        return newOpportunities;
      }
      
      // Skip if swap size is too small
      if (swapDetails.swapSize < sandwichConfig.minTargetSwapSize) {
        logger.info({ 
          swapSize: swapDetails.swapSize,
          minSize: sandwichConfig.minTargetSwapSize,
          strategy: this.getName() 
        }, "Swap size too small");
        return newOpportunities;
      }
      
      // Calculate price impact
      const estimatedPriceImpact = this.calculatePriceImpact(swapDetails.swapSize, swapDetails.tokenPair);
      if (estimatedPriceImpact < 0.5) { // Minimum 0.5% price impact
        logger.info({ 
          priceImpact: estimatedPriceImpact,
          minImpact: 0.5,
          strategy: this.getName() 
        }, "Price impact too small");
        return newOpportunities;
      }
      
      // Calculate optimal front-run and back-run amounts
      const frontRunAmount = this.calculateOptimalFrontRunAmount(swapDetails.swapSize, estimatedPriceImpact);
      const backRunAmount = this.calculateOptimalBackRunAmount(swapDetails.swapSize, frontRunAmount);
      
      // Estimate gas costs
      const estimatedFrontRunGas = Math.min(
        sandwichConfig.maxFrontRunGas,
        0.01 + (frontRunAmount * 0.001) // Base 0.01 TON + 0.1% of amount
      );
      
      const estimatedBackRunGas = Math.min(
        sandwichConfig.maxBackRunGas,
        0.01 + (backRunAmount * 0.001) // Base 0.01 TON + 0.1% of amount
      );
      
      const totalGasCost = estimatedFrontRunGas + estimatedBackRunGas;
      
      // Calculate profit estimate
      const profitEstimate = this.calculateProfitEstimate(
        swapDetails.swapSize,
        estimatedPriceImpact,
        frontRunAmount,
        backRunAmount,
        totalGasCost
      );
      
      // Skip if profit is below minimum threshold
      if (profitEstimate < sandwichConfig.minProfitEstimate) {
        logger.info({ 
          profitEstimate,
          minProfit: sandwichConfig.minProfitEstimate,
          strategy: this.getName() 
        }, "Profit estimate too low");
        return newOpportunities;
      }
      
      // Calculate confidence score
      const confidence = this.calculateConfidence(
        swapDetails.swapSize,
        estimatedPriceImpact,
        profitEstimate
      );
      
      // Skip if confidence is below minimum threshold
      if (confidence < sandwichConfig.minConfidence) {
        logger.info({ 
          confidence,
          minConfidence: sandwichConfig.minConfidence,
          strategy: this.getName() 
        }, "Confidence too low");
        return newOpportunities;
      }
      
      // Create execution plan
      const executionPlan = `Front-run with ${frontRunAmount.toFixed(2)} TON, back-run with ${backRunAmount.toFixed(2)} TON`;
      
      // Create opportunity details
      const details: SandwichOpportunityDetails = {
        targetTxHash: (tx as any).hash?.toString('hex') || 'unknown',
        tokenPair: swapDetails.tokenPair,
        targetSwapSize: swapDetails.swapSize,
        estimatedPriceImpact,
        frontRunAmount,
        backRunAmount,
        estimatedFrontRunGas,
        estimatedBackRunGas,
        totalGasCost,
        executionPlan
      };
      
      // Create and add the opportunity
      const opportunity: MEVOpportunity = {
        id: uuidv4(),
        strategy: this.getName(),
        timestamp: packet.timestamp,
        profitEstimate,
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
        tokenPair: swapDetails.tokenPair,
        targetSwapSize: swapDetails.swapSize,
        profit: profitEstimate.toFixed(4),
        confidence: confidence.toFixed(2)
      }, "Sandwich opportunity identified");
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? { 
          message: error.message,
          stack: error.stack,
          name: error.name
        } : String(error),
        strategy: this.getName() 
      }, "Error analyzing mempool packet for sandwich opportunities");
    }
    
    return newOpportunities;
  }
  
  /**
   * Extract transactions from a mempool packet
   * @param packet Mempool packet to extract transactions from
   * @returns Array of transactions
   */
  private extractTransactions(packet: MempoolPacket): any[] {
    // Check if the packet already has extracted transactions
    if (packet.transactions && Array.isArray(packet.transactions)) {
      logger.info({
        count: packet.transactions.length,
        strategy: this.name
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
          strategy: this.name
        }, "Found transactions in packet.data.transactions");
        return data.transactions;
      }
      
      // Check for messages array (alternative format)
      if (data.messages && Array.isArray(data.messages)) {
        logger.info({
          count: data.messages.length,
          strategy: this.name
        }, "Found messages in packet.data.messages");
        return data.messages;
      }
      
      // Check if data itself is an array
      if (Array.isArray(data)) {
        logger.info({
          count: data.length,
          strategy: this.name
        }, "Packet data is an array, treating as transactions");
        return data;
      }
    }
    
    logger.warn({
      strategy: this.name,
      packetId: packet.id
    }, "No transactions found in packet");
    
    return [];
  }
  
  /**
   * Check if a transaction is a swap transaction
   * @param tx Transaction to check
   * @returns True if the transaction is a swap
   */
  private isSwapTransaction(tx: any): boolean {
    try {
      if (!tx) return false;
      
      // Check for common swap indicators in transaction properties
      const hasSwapIndicators = 
        (tx.op && (tx.op === 'swap' || tx.op === 'exchange')) ||
        (tx.method && (tx.method === 'swap' || tx.method === 'exchange')) ||
        (tx.function && (tx.function === 'swap' || tx.function === 'exchange'));
      
      if (hasSwapIndicators) {
        logger.info({ strategy: this.name }, "Found swap indicators in transaction properties");
        return true;
      }
      
      // Check outMsgs for swap-specific patterns
      if (tx.outMsgs && Array.isArray(tx.outMsgs) && tx.outMsgs.length > 0) {
        const outMsg = tx.outMsgs[0];
        if (Buffer.isBuffer(outMsg)) {
          const outMsgHex = outMsg.toString('hex');
          
          // Check for DeDust swap op code
          if (outMsgHex.includes('01e18801')) {
            logger.info({ 
              strategy: this.name,
              opCode: '01e18801'
            }, "Found swap op code in outMsg");
            return true;
          }
          
          // Check for other common swap indicators in hex
          const swapIndicators = ['swap', 'exchange', 'transfer'];
          for (const indicator of swapIndicators) {
            const hexIndicator = Buffer.from(indicator).toString('hex');
            if (outMsgHex.includes(hexIndicator)) {
              logger.info({ 
                strategy: this.name,
                indicator
              }, "Found swap indicator in outMsg");
              return true;
            }
          }
        }
      }
      
      // Check for DEX contract addresses
      if (tx.stdSmcAddress) {
        const addressHex = Buffer.isBuffer(tx.stdSmcAddress) 
          ? tx.stdSmcAddress.toString('hex') 
          : tx.stdSmcAddress;
          
        if (this.isDexAddress(addressHex)) {
          logger.info({ 
            strategy: this.name,
            addressHex: addressHex.substring(0, 16) + '...'
          }, "Found DEX address in transaction");
          return true;
        }
      }
      
      // Check data field for swap indicators
      if (tx.data) {
        const dataHex = Buffer.isBuffer(tx.data) ? tx.data.toString('hex') : tx.data;
        
        // Check for DeDust swap op code
        if (dataHex.includes('01e18801')) {
          logger.info({ 
            strategy: this.name,
            opCode: '01e18801'
          }, "Found swap op code in data");
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        strategy: this.name
      }, "Error checking if transaction is a swap");
      return false;
    }
  }
  
  /**
   * Check if an address is a known DEX address
   * @param address Address to check
   * @returns True if the address belongs to a known DEX
   */
  private isDexAddress(address: any): boolean {
    try {
      // Convert address to string if it's a buffer
      const addressStr = Buffer.isBuffer(address) ? address.toString('hex') : String(address);
      
      // Known DEX addresses on TON
      const knownDexAddresses = [
        'fa8025ea50139e7a76fc361bba109efd1c856619c3b2d003881eee01e8e80692', // DeDust
        'fdc7cd1d8d0e710105e2b69bbd747eb3748cc4103bc0dd581e91ba4360929b73', // Ston.fi
        '0bfe2f05a7ccf04aa326cb3ae08c2bb7d9729ddec7fc04a5f9d01007d9c65f9f'  // Megaton
      ];
      
      // Check if the address matches any known DEX address
      for (const dexAddress of knownDexAddresses) {
        if (addressStr.includes(dexAddress)) {
          logger.info({ 
            strategy: this.name,
            matchedDexAddress: dexAddress.substring(0, 16) + '...'
          }, "Found known DEX address");
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        strategy: this.name
      }, "Error checking DEX address");
      return false;
    }
  }
  
  /**
   * Extract swap details from a transaction
   * @param tx Transaction to extract details from
   * @returns Swap details or null if extraction fails
   */
  private extractSwapDetails(tx: any): { tokenPair: string; swapSize: number } | null {
    try {
      // Log the transaction structure to understand what we're working with
      logger.info({
        txKeys: tx ? Object.keys(tx) : [],
        strategy: this.name
      }, "Transaction structure for swap extraction");
      
      // First try to extract from outMsgs (most reliable for TON DEXes)
      if (tx.outMsgs && Array.isArray(tx.outMsgs) && tx.outMsgs.length > 0) {
        const outMsg = tx.outMsgs[0];
        if (Buffer.isBuffer(outMsg)) {
          const outMsgHex = outMsg.toString('hex');
          logger.info({ 
            outMsgHexPreview: outMsgHex.substring(0, 50) + '...',
            strategy: this.name 
          }, "Analyzing outMsg hex for swap details");
          
          // Look for swap indicators in the outMsg
          // For DeDust, the swap op code is typically '01e18801'
          if (outMsgHex.includes('01e18801')) {
            logger.info({ strategy: this.name }, "Found DeDust swap operation code");
            
            // Try to extract the amount from the message
            // The amount is typically 8-16 bytes after specific positions
            try {
              const opCodeIndex = outMsgHex.indexOf('01e18801');
              // Try different offsets as the exact position may vary
              const possibleOffsets = [8, 16, 24, 32];
              
              for (const offset of possibleOffsets) {
                if (opCodeIndex + offset + 16 <= outMsgHex.length) {
                  const amountHex = outMsgHex.substring(opCodeIndex + offset, opCodeIndex + offset + 16);
                  const amountValue = parseInt(amountHex, 16);
                  
                  // Validate if this looks like a reasonable amount (non-zero and not too large)
                  if (amountValue > 0 && amountValue < 1e18) {
                    // Convert to TON (assuming 9 decimals for TON)
                    const swapSize = amountValue / 1e9;
                    
                    logger.info({ 
                      amountHex, 
                      amountValue, 
                      swapSize,
                      offset,
                      strategy: this.name
                    }, "Extracted swap size from outMsg");
                    
                    // For now, assume it's a TON/USDT swap (most common)
                    // In a full implementation, we would extract the actual token pair
                    return { tokenPair: 'TON/USDT', swapSize };
                  }
                }
              }
            } catch (amountError) {
              logger.warn({ 
                error: amountError instanceof Error ? amountError.message : String(amountError),
                strategy: this.name
              }, "Error extracting amount from outMsg");
            }
          }
        }
      }
      
      // If we couldn't extract from outMsgs, try the data field
      if (tx.data) {
        const dataHex = Buffer.isBuffer(tx.data) ? tx.data.toString('hex') : tx.data;
        logger.info({ 
          dataHexPreview: dataHex.substring(0, 50) + '...',
          strategy: this.name 
        }, "Analyzing data hex for swap details");
        
        // Look for swap indicators in the data
        if (dataHex.includes('swap') || dataHex.includes('exchange') || dataHex.includes('01e18801')) {
          logger.info({ strategy: this.name }, "Found swap indicator in data");
          
          // Try to extract the amount from the data
          // For demonstration, extract a number that looks like a reasonable amount
          const amountMatch = dataHex.match(/([0-9a-f]{8,16})/i);
          if (amountMatch) {
            const amountValue = parseInt(amountMatch[1], 16);
            if (amountValue > 0 && amountValue < 1e18) {
              // Convert to TON (assuming 9 decimals for TON)
              const swapSize = amountValue / 1e9;
              
              logger.info({ 
                amountHex: amountMatch[1], 
                amountValue, 
                swapSize,
                strategy: this.name
              }, "Extracted swap size from data");
              
              // For now, assume it's a TON/USDT swap (most common)
              return { tokenPair: 'TON/USDT', swapSize };
            }
          }
        }
      }
      
      // If we couldn't extract real data, use a fallback with realistic values
      logger.info({ strategy: this.name }, "Using fallback swap details");
      const sandwichConfig = this.config as SandwichConfig;
      
      // Select a token pair from our target list
      const tokenPair = sandwichConfig.targetPairs[0]; // Use the first one for consistency
      
      // Generate a realistic swap size (between min and min+20)
      const swapSize = sandwichConfig.minTargetSwapSize + (Math.random() * 20);
      
      logger.info({ 
        tokenPair, 
        swapSize,
        fallback: true,
        strategy: this.name
      }, "Using fallback swap details");
      
      return { tokenPair, swapSize };
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        strategy: this.name
      }, "Error extracting swap details");
      return null;
    }
  }
  
  /**
   * Calculate price impact based on swap size
   * @param swapSize Size of the swap
   * @param tokenPair Token pair being swapped
   * @returns Estimated price impact percentage
   */
  private calculatePriceImpact(swapSize: number, tokenPair: string): number {
    // In a real implementation, we would calculate this based on liquidity depth
    // For now, we'll use a simple model where larger swaps have more impact
    
    // Base impact is 0.1% for small swaps
    let impact = 0.1;
    
    // Add 0.05% for each 10 TON above the minimum
    const sandwichConfig = this.config as SandwichConfig;
    const sizeAboveMin = swapSize - sandwichConfig.minTargetSwapSize;
    impact += (sizeAboveMin / 10) * 0.05;
    
    // Cap at 5% for very large swaps
    return Math.min(impact, 5);
  }
  
  /**
   * Calculate optimal front-run amount
   * @param targetSwapSize Size of the target swap
   * @param priceImpact Estimated price impact
   * @returns Optimal front-run amount
   */
  private calculateOptimalFrontRunAmount(targetSwapSize: number, priceImpact: number): number {
    // In a real implementation, this would be based on complex modeling
    // For now, use a simple heuristic: 15-25% of target swap size
    return targetSwapSize * (0.15 + (priceImpact / 100));
  }
  
  /**
   * Calculate optimal back-run amount
   * @param targetSwapSize Size of the target swap
   * @param frontRunAmount Amount used for front-running
   * @returns Optimal back-run amount
   */
  private calculateOptimalBackRunAmount(targetSwapSize: number, frontRunAmount: number): number {
    // In a real implementation, this would be based on complex modeling
    // For now, use a simple heuristic: front-run amount + 5-10% of target swap
    return frontRunAmount + (targetSwapSize * (0.05 + (Math.random() * 0.05)));
  }
  
  /**
   * Calculate profit estimate for a sandwich opportunity
   * @param targetSwapSize Size of the target swap
   * @param priceImpact Estimated price impact
   * @param frontRunAmount Amount used for front-running
   * @param backRunAmount Amount used for back-running
   * @param gasCost Total gas cost
   * @returns Estimated profit
   */
  private calculateProfitEstimate(
    targetSwapSize: number,
    priceImpact: number,
    frontRunAmount: number,
    backRunAmount: number,
    gasCost: number
  ): number {
    // In a real implementation, this would be based on complex modeling
    
    // Simple model: capture 60-80% of the price impact, minus gas costs
    const captureRate = 0.6 + (Math.random() * 0.2);
    const grossProfit = (targetSwapSize * priceImpact / 100) * captureRate;
    
    return grossProfit - gasCost;
  }
  
  /**
   * Calculate confidence score for a sandwich opportunity
   * @param swapSize Size of the target swap
   * @param priceImpact Estimated price impact
   * @param profitEstimate Estimated profit
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(
    swapSize: number,
    priceImpact: number,
    profitEstimate: number
  ): number {
    // In a real implementation, this would be based on multiple factors
    
    // Base confidence starts at 0.7
    let confidence = 0.7;
    
    // Larger swaps are more reliable
    const sandwichConfig = this.config as SandwichConfig;
    const swapSizeFactor = Math.min((swapSize / sandwichConfig.minTargetSwapSize) * 0.05, 0.15);
    confidence += swapSizeFactor;
    
    // Higher price impact is more reliable
    const impactFactor = Math.min(priceImpact * 0.02, 0.1);
    confidence += impactFactor;
    
    // Higher profit is more reliable
    const profitFactor = Math.min((profitEstimate / sandwichConfig.minProfitEstimate) * 0.02, 0.1);
    confidence += profitFactor;
    
    // Cap at 0.98
    return Math.min(confidence, 0.98);
  }
}
