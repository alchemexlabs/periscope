/**
 * Strategy Manager for MEV strategies
 * Coordinates multiple strategies and aggregates their results
 */
import type { MempoolPacket } from "../searcher";
import { BaseStrategy } from "./base-strategy";
import type { MEVOpportunity, StrategyConfig } from "./base-strategy";
import { ArbitrageStrategy } from "./arbitrage-strategy";
import { SandwichStrategy } from "./sandwich-strategy";
import { logger } from "../client";
import { EventEmitter } from "events";

export class StrategyManager extends EventEmitter {
  private strategies: Map<string, BaseStrategy> = new Map();
  private opportunities: MEVOpportunity[] = [];
  private lastAnalysisTime: number = 0;

  constructor() {
    super();
    // Initialize with default strategies
    this.registerDefaultStrategies();
    logger.info("Strategy Manager initialized");
  }

  /**
   * Register default strategies
   */
  private registerDefaultStrategies(): void {
    // Register arbitrage strategy
    this.registerStrategy(new ArbitrageStrategy());
    
    // Register sandwich strategy
    this.registerStrategy(new SandwichStrategy());
  }

  /**
   * Register a new strategy
   * @param strategy Strategy to register
   */
  registerStrategy(strategy: BaseStrategy): void {
    const name = strategy.getName();
    this.strategies.set(name, strategy);
    logger.info({ strategy: name }, "Strategy registered");
  }

  /**
   * Unregister a strategy
   * @param strategyName Name of the strategy to unregister
   */
  unregisterStrategy(strategyName: string): void {
    if (this.strategies.has(strategyName)) {
      this.strategies.delete(strategyName);
      logger.info({ strategy: strategyName }, "Strategy unregistered");
    }
  }

  /**
   * Get a strategy by name
   * @param strategyName Name of the strategy to get
   * @returns The strategy or undefined if not found
   */
  getStrategy(strategyName: string): BaseStrategy | undefined {
    return this.strategies.get(strategyName);
  }

  /**
   * Get all registered strategies
   * @returns Array of all registered strategies
   */
  getAllStrategies(): BaseStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get all registered strategies with their configurations
   * @returns Array of strategy objects with name, enabled status, and config
   */
  getStrategies(): Array<{ name: string; enabled: boolean; [key: string]: any }> {
    return Array.from(this.strategies.values()).map(strategy => {
      const config = strategy.getConfig();
      return {
        name: strategy.getName(),
        enabled: strategy.isEnabled(),
        minConfidence: config.minConfidence,
        minProfitEstimate: config.minProfitEstimate,
        ...Object.entries(config)
          .filter(([key]) => !['enabled', 'minConfidence', 'minProfitEstimate'].includes(key))
          .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
      };
    });
  }

  /**
   * Update the configuration of a strategy
   * @param strategyName Name of the strategy to update
   * @param config New configuration (partial)
   */
  updateStrategyConfig(strategyName: string, config: Partial<StrategyConfig>): void {
    const strategy = this.strategies.get(strategyName);
    if (strategy) {
      strategy.updateConfig(config);
      logger.info({ strategy: strategyName, config }, "Strategy configuration updated");
    } else {
      logger.warn({ strategy: strategyName }, "Strategy not found for configuration update");
    }
  }

  /**
   * Analyze a mempool packet with all registered strategies
   * @param packet Mempool packet to analyze
   * @returns Array of all identified opportunities
   */
  analyzePacket(packet: MempoolPacket): MEVOpportunity[] {
    if (!packet || !packet.data) {
      logger.warn("Invalid mempool packet received for analysis");
      return [];
    }

    const startTime = Date.now();
    this.lastAnalysisTime = startTime;
    
    const newOpportunities: MEVOpportunity[] = [];
    
    // Run all strategies synchronously to avoid errors
    for (const strategy of this.strategies.values()) {
      try {
        // Log the strategy name before analysis
        logger.debug({ strategy: strategy.getName() }, "Analyzing packet with strategy");
        
        const strategyOpportunities = strategy.analyze(packet);
        
        if (strategyOpportunities.length > 0) {
          newOpportunities.push(...strategyOpportunities);
          this.opportunities.push(...strategyOpportunities);
        }
      } catch (error) {
        // Properly log the error details
        logger.error({ 
          error: error instanceof Error ? { 
            message: error.message,
            stack: error.stack,
            name: error.name
          } : String(error), 
          strategy: strategy.getName() 
        }, "Error running strategy");
      }
    }
    
    const endTime = Date.now();
    const analysisTime = endTime - startTime;
    
    if (newOpportunities.length > 0) {
      logger.info({ 
        opportunitiesCount: newOpportunities.length,
        analysisTime,
        packetId: packet.id
      }, "New MEV opportunities identified");
      
      // Emit event with new opportunities
      this.emit('opportunitiesUpdated', this.getOpportunities(20));
    } else {
      logger.debug({ 
        analysisTime,
        packetId: packet.id
      }, "No new MEV opportunities identified");
    }
    
    return newOpportunities;
  }

  /**
   * Get all identified opportunities
   * @param limit Maximum number of opportunities to return (0 for all)
   * @param strategyFilter Optional filter by strategy name
   * @returns Array of identified opportunities
   */
  getOpportunities(limit = 0, strategyFilter?: string): MEVOpportunity[] {
    let filteredOpportunities = this.opportunities;
    
    if (strategyFilter) {
      filteredOpportunities = filteredOpportunities.filter(
        opp => opp.strategy === strategyFilter
      );
    }
    
    // Sort by profit estimate (descending)
    filteredOpportunities.sort((a, b) => b.profitEstimate - a.profitEstimate);
    
    if (limit > 0 && filteredOpportunities.length > limit) {
      return filteredOpportunities.slice(0, limit);
    }
    
    return filteredOpportunities;
  }

  /**
   * Clear all identified opportunities
   * @param strategyFilter Optional filter by strategy name
   */
  clearOpportunities(strategyFilter?: string): void {
    if (strategyFilter) {
      this.opportunities = this.opportunities.filter(
        opp => opp.strategy !== strategyFilter
      );
      logger.info({ strategy: strategyFilter }, "Opportunities cleared for strategy");
    } else {
      this.opportunities = [];
      logger.info("All opportunities cleared");
    }
    
    // Emit event with updated opportunities
    this.emit('opportunitiesUpdated', this.getOpportunities(20));
  }

  /**
   * Get statistics about the strategies and opportunities
   * @returns Statistics object
   */
  getStatistics(): Record<string, unknown> {
    const strategyStats = Array.from(this.strategies.entries()).map(([name, strategy]) => {
      try {
        const opportunities = strategy.getOpportunities();
        const config = strategy.getConfig();
        const totalProfit = opportunities.reduce((sum, opp) => sum + opp.profitEstimate, 0);
        
        return {
          name,
          enabled: config?.enabled ?? true,
          opportunitiesCount: opportunities.length,
          totalProfit,
          averageProfit: opportunities.length > 0 ? totalProfit / opportunities.length : 0,
          config: config || {}
        };
      } catch (error) {
        logger.error({ 
          error: error instanceof Error ? { 
            message: error.message,
            stack: error.stack,
            name: error.name
          } : String(error),
          strategy: name 
        }, "Error getting strategy statistics");
        
        return {
          name,
          enabled: false,
          opportunitiesCount: 0,
          totalProfit: 0,
          averageProfit: 0,
          config: {},
          error: "Error getting strategy statistics"
        };
      }
    });
    
    return {
      totalStrategies: this.strategies.size,
      totalOpportunities: this.opportunities.length,
      lastAnalysisTime: this.lastAnalysisTime,
      strategies: strategyStats
    };
  }
}
