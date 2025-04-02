import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { timeAgo } from '../lib/utils';
import { SystemStats } from '../lib/api';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';

interface SystemHealthProps {
  stats: SystemStats;
}

export function SystemHealth({ stats }: SystemHealthProps) {
  const isHealthy = Date.now() - stats.lastPacketReceived < 10000; // 10 seconds
  const hasLatencyWarning = Date.now() - stats.lastPacketReceived > 500; // 500ms

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle size="md">System Health</CardTitle>
          <Badge variant={isHealthy ? 'success' : 'danger'}>
            {isHealthy ? 'Healthy' : 'Warning'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-md">
            <Clock size={20} className="text-ton" />
            <div>
              <div className="text-sm text-gray-500">Uptime</div>
              <div className="font-medium">
                {Math.floor(stats.uptime / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-md">
            {hasLatencyWarning ? (
              <AlertTriangle size={20} className="text-warning" />
            ) : (
              <CheckCircle size={20} className="text-success" />
            )}
            <div>
              <div className="text-sm text-gray-500">Last Packet</div>
              <div className="font-medium">
                {timeAgo(stats.lastPacketReceived)}
              </div>
              {hasLatencyWarning && (
                <div className="text-xs text-warning">High latency detected</div>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-md">
            <div className="w-5 h-5 rounded-full bg-ton flex items-center justify-center text-white text-xs">
              {stats.activeSubscriptions.length}
            </div>
            <div>
              <div className="text-sm text-gray-500">Active Subscriptions</div>
              <div className="font-medium">
                {stats.activeSubscriptions.join(', ')}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
