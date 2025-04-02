import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { formatCurrency, formatPercent } from '../lib/utils';

interface StrategyMetric {
  name: string;
  value: number;
  change: number;
  data: { timestamp: number; value: number }[];
}

interface StrategyPerformanceData {
  name: string;
  enabled: boolean;
  metrics: {
    profitPerHour: StrategyMetric;
    successRate: StrategyMetric;
    gasUsed: StrategyMetric;
  };
}

interface StrategyPerformanceProps {
  strategies: StrategyPerformanceData[];
}

export function StrategyPerformance({ strategies }: StrategyPerformanceProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Strategy Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {strategies.map((strategy) => (
            <div key={strategy.name} className="border border-gray-100 rounded-md p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">{strategy.name}</h3>
                <Badge variant={strategy.enabled ? 'success' : 'default'}>
                  {strategy.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-500">Profit/Hour</p>
                  <p className="text-xl font-semibold text-success">
                    {formatCurrency(strategy.metrics.profitPerHour.value, 'TON')}
                  </p>
                  <p className={`text-xs ${strategy.metrics.profitPerHour.change >= 0 ? 'text-success' : 'text-danger'}`}>
                    {strategy.metrics.profitPerHour.change >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(strategy.metrics.profitPerHour.change))}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Success Rate</p>
                  <p className="text-xl font-semibold">
                    {formatPercent(strategy.metrics.successRate.value)}
                  </p>
                  <p className={`text-xs ${strategy.metrics.successRate.change >= 0 ? 'text-success' : 'text-danger'}`}>
                    {strategy.metrics.successRate.change >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(strategy.metrics.successRate.change))}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Gas Used</p>
                  <p className="text-xl font-semibold">
                    {strategy.metrics.gasUsed.value.toFixed(2)}
                  </p>
                  <p className={`text-xs ${strategy.metrics.gasUsed.change <= 0 ? 'text-success' : 'text-danger'}`}>
                    {strategy.metrics.gasUsed.change <= 0 ? '↓' : '↑'} {formatPercent(Math.abs(strategy.metrics.gasUsed.change))}
                  </p>
                </div>
              </div>
              
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={strategy.metrics.profitPerHour.data}>
                    <defs>
                      <linearGradient id={`gradient-${strategy.name}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="timestamp" hide />
                    <YAxis hide />
                    <Tooltip 
                      formatter={(value: number) => [formatCurrency(value, 'TON'), 'Profit']}
                      labelFormatter={() => ''}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="value" 
                      stroke="#10B981" 
                      fillOpacity={1} 
                      fill={`url(#gradient-${strategy.name})`} 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
