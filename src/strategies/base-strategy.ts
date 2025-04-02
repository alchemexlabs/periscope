/**
 * Base interface for MEV strategies
 * All concrete strategies should implement this interface
 */
import type { MempoolPacket } from "../searcher";
import { logger } from "../client";

export interface MEVOpportunity {
  id: string;
  strategy: string;
  timestamp: number;
  profitEstimate: number; // Estimated profit in TON
  confidence: number; // 0-1 scale
  details: Record<string, unknown>;
  rawData: Record<string, unknown>;
}

export interface StrategyConfig {
  enabled: boolean;
  minConfidence: number; // 0-1 scale
  minProfitEstimate: number; // Minimum profit in TON to consider an opportunity
  [key: string]: unknown;
}

export abstract class BaseStrategy {
  protected name: string;
  protected config: StrategyConfig;
  protected opportunities: MEVOpportunity[] = [];

  constructor(name: string, config: StrategyConfig) {
    this.name = name;
    this.config = config;
    logger.info({ strategy: this.name, config: this.config }, "Strategy initialized");
  }

  /**
   * Process a mempool packet and identify potential MEV opportunities
   * @param packet The mempool packet to analyze
   * @returns Array of identified MEV opportunities
   */
  abstract analyze(packet: MempoolPacket): MEVOpportunity[];

  /**
   * Get the name of the strategy
   * @returns Strategy name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Check if the strategy is enabled
   * @returns Whether the strategy is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled !== false;
  }

  /**
   * Get the configuration of the strategy
   * @returns Strategy configuration
   */
  getConfig(): StrategyConfig {
    return this.config;
  }

  /**
   * Update the configuration of the strategy
   * @param config New configuration (partial)
   */
  updateConfig(config: Partial<StrategyConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    logger.info({ strategy: this.name, config: this.config }, "Strategy configuration updated");
  }

  /**
   * Get all identified opportunities
   * @returns Array of identified MEV opportunities
   */
  getOpportunities(): MEVOpportunity[] {
    return this.opportunities;
  }

  /**
   * Clear all identified opportunities
   */
  clearOpportunities(): void {
    this.opportunities = [];
    logger.info({ strategy: this.name }, "Opportunities cleared");
  }

  /**
   * Check if a potential opportunity meets the minimum criteria
   * @param opportunity The opportunity to check
   * @returns Whether the opportunity meets the minimum criteria
   */
  protected meetsMinimumCriteria(opportunity: MEVOpportunity): boolean {
    return (
      opportunity.confidence >= this.config.minConfidence &&
      opportunity.profitEstimate >= this.config.minProfitEstimate
    );
  }
}
