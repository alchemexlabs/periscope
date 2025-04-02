import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { SystemStats } from '../lib/api';

interface MempoolHeatmapProps {
  stats: SystemStats;
}

export function MempoolHeatmap({ stats }: MempoolHeatmapProps) {
  const maxVolume = Math.max(...Object.values(stats.mempoolStats));
  
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle size="md">Mempool Activity (Last 5m)</CardTitle>
          <Badge variant="ton">Live</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2">
          {Object.entries(stats.mempoolStats).map(([dex, volume]) => {
            const intensity = volume / maxVolume;
            const width = `${Math.max(5, intensity * 100)}%`;
            
            return (
              <div key={dex} className="flex items-center space-x-3">
                <div className="w-24 text-sm font-medium truncate">{dex}</div>
                <div className="flex-1 bg-gray-100 h-6 rounded-sm overflow-hidden">
                  <div 
                    className="h-full bg-ton transition-all duration-500 ease-out"
                    style={{ width }}
                  />
                </div>
                <div className="w-12 text-right text-sm font-mono">{volume}</div>
              </div>
            );
          })}
          
          {Object.keys(stats.mempoolStats).length === 0 && (
            <div className="text-center py-4 text-gray-500">
              No mempool activity detected
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
