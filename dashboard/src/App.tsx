import { useEffect, useState } from 'react';
import { DashboardLayout } from './components/dashboard-layout';
import { OpportunitiesTable } from './components/opportunities-table';
import { StrategyPerformance } from './components/strategy-performance';
import { SystemHealth } from './components/system-health';
import { MempoolHeatmap } from './components/mempool-heatmap';
import { apiService, Opportunity, StrategyConfig, SystemStats } from './lib/api';
import './index.css';

function App() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [strategies, setStrategies] = useState<StrategyConfig[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats>({
    uptime: 0,
    lastPacketReceived: Date.now(),
    activeSubscriptions: [],
    mempoolStats: {},
  });
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [error, setError] = useState<string | null>(null);

  // Mock data for strategy performance
  const mockStrategyPerformance = strategies.map(strategy => ({
    name: strategy.name,
    enabled: strategy.enabled,
    metrics: {
      profitPerHour: {
        name: 'Profit/Hour',
        value: Math.random() * 10,
        change: (Math.random() * 20) - 10,
        data: Array.from({ length: 24 }, (_, i) => ({
          timestamp: Date.now() - (23 - i) * 3600000,
          value: Math.random() * 10,
        })),
      },
      successRate: {
        name: 'Success Rate',
        value: Math.random() * 100,
        change: (Math.random() * 20) - 10,
        data: Array.from({ length: 24 }, (_, i) => ({
          timestamp: Date.now() - (23 - i) * 3600000,
          value: Math.random() * 100,
        })),
      },
      gasUsed: {
        name: 'Gas Used',
        value: Math.random() * 5,
        change: (Math.random() * 20) - 10,
        data: Array.from({ length: 24 }, (_, i) => ({
          timestamp: Date.now() - (23 - i) * 3600000,
          value: Math.random() * 5,
        })),
      },
    },
  }));

  useEffect(() => {
    // Initialize WebSocket connection
    apiService.initializeSocket(
      () => setConnectionStatus('connected'),
      (error) => {
        setError(`Connection error: ${error.message}`);
        setConnectionStatus('disconnected');
      }
    );

    // Subscribe to real-time opportunities
    const unsubscribeOpportunities = apiService.subscribeToOpportunities((newOpportunities) => {
      setOpportunities(prev => {
        // Merge new opportunities with existing ones, avoiding duplicates
        const opportunityMap = new Map(prev.map(opp => [opp.id, opp]));
        newOpportunities.forEach(opp => opportunityMap.set(opp.id, opp));
        return Array.from(opportunityMap.values());
      });
    });

    // Subscribe to system stats
    const unsubscribeSystemStats = apiService.subscribeToSystemStats((stats) => {
      setSystemStats(stats);
    });

    // Fetch initial data
    const fetchInitialData = async () => {
      try {
        const [opportunitiesData, strategiesData, systemStatsData] = await Promise.all([
          apiService.getOpportunities(),
          apiService.getStrategies(),
          apiService.getSystemStats(),
        ]);
        
        setOpportunities(opportunitiesData);
        setStrategies(strategiesData);
        setSystemStats(systemStatsData);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        setError('Failed to fetch initial data. Please refresh the page.');
      }
    };

    fetchInitialData();

    // Cleanup subscriptions on unmount
    return () => {
      unsubscribeOpportunities();
      unsubscribeSystemStats();
    };
  }, []);

  // If there's a connection error, show an error message
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-6 rounded-md shadow-sm max-w-md">
          <h2 className="text-xl font-semibold text-red-500 mb-4">Connection Error</h2>
          <p className="text-gray-700 mb-4">{error}</p>
          <button 
            className="bg-blue-500 text-white px-4 py-2 rounded-md"
            onClick={() => window.location.reload()}
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout connectionStatus={connectionStatus}>
      {/* Top row: System health and mempool activity */}
      <div className="col-span-12 md:col-span-4">
        <SystemHealth stats={systemStats} />
      </div>
      <div className="col-span-12 md:col-span-8">
        <MempoolHeatmap stats={systemStats} />
      </div>
      
      {/* Middle row: Strategy performance */}
      <div className="col-span-12">
        <StrategyPerformance strategies={mockStrategyPerformance} />
      </div>
      
      {/* Bottom row: Opportunities table */}
      <div className="col-span-12">
        <OpportunitiesTable 
          opportunities={opportunities} 
          onClearOpportunities={async (strategyName?: string) => {
            try {
              await apiService.clearOpportunities(strategyName);
            } catch (error) {
              console.error('Failed to clear opportunities:', error);
            }
          }}
        />
      </div>
    </DashboardLayout>
  );
}

export default App;
