import { io, Socket } from 'socket.io-client';

export interface Opportunity {
  id: string;
  strategy: string;
  timestamp: number;
  profitEstimate: number;
  confidence: number;
  details: {
    [key: string]: any;
  };
  rawData?: {
    packetId: string;
    timestamp: number;
    fallbackGenerated?: boolean;
  };
}

export interface StrategyConfig {
  name: string;
  enabled: boolean;
  minConfidence?: number;
  minProfitEstimate?: number;
  [key: string]: any;
}

export interface SystemStats {
  uptime: number;
  lastPacketReceived: number;
  activeSubscriptions: string[];
  mempoolStats: {
    [dex: string]: number;
  };
}

class ApiService {
  private baseUrl: string;
  private socket: Socket | null = null;
  
  constructor(baseUrl = 'http://localhost:8087') {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize WebSocket connection
   */
  public initializeSocket(onConnect?: () => void, onError?: (error: Error) => void): void {
    this.socket = io(this.baseUrl, {
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      console.log('Connected to WebSocket server');
      if (onConnect) onConnect();
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      if (onError) onError(error);
    });
  }

  /**
   * Subscribe to real-time opportunities
   */
  public subscribeToOpportunities(callback: (opportunities: Opportunity[]) => void): () => void {
    if (!this.socket) {
      throw new Error('Socket not initialized. Call initializeSocket first.');
    }

    this.socket.on('opportunities', callback);
    
    return () => {
      this.socket?.off('opportunities', callback);
    };
  }

  /**
   * Subscribe to system stats
   */
  public subscribeToSystemStats(callback: (stats: SystemStats) => void): () => void {
    if (!this.socket) {
      throw new Error('Socket not initialized. Call initializeSocket first.');
    }

    this.socket.on('systemStats', callback);
    
    return () => {
      this.socket?.off('systemStats', callback);
    };
  }

  /**
   * Fetch all opportunities
   */
  public async getOpportunities(): Promise<Opportunity[]> {
    const response = await fetch(`${this.baseUrl}/opportunities`);
    const data = await response.json();
    return data.opportunities;
  }

  /**
   * Fetch all strategies
   */
  public async getStrategies(): Promise<StrategyConfig[]> {
    const response = await fetch(`${this.baseUrl}/strategies`);
    const data = await response.json();
    return data.strategies;
  }

  /**
   * Update a strategy configuration
   */
  public async updateStrategy(name: string, config: Partial<StrategyConfig>): Promise<StrategyConfig> {
    const response = await fetch(`${this.baseUrl}/strategies/${name}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });
    const data = await response.json();
    return data.config;
  }

  /**
   * Clear opportunities
   */
  public async clearOpportunities(strategyName?: string): Promise<void> {
    const url = strategyName 
      ? `${this.baseUrl}/opportunities?strategy=${strategyName}` 
      : `${this.baseUrl}/opportunities`;
    
    await fetch(url, {
      method: 'DELETE',
    });
  }

  /**
   * Fetch system stats
   */
  public async getSystemStats(): Promise<SystemStats> {
    const response = await fetch(`${this.baseUrl}/system/stats`);
    const data = await response.json();
    return data;
  }

  /**
   * Get health status
   */
  public async getHealth(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    const data = await response.json();
    return data;
  }
}

export const apiService = new ApiService();
export default apiService;
