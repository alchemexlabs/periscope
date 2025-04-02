import React from 'react';
import { Command, Settings, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { apiService } from '../lib/api';

interface DashboardLayoutProps {
  children: React.ReactNode;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
}

export function DashboardLayout({ children, connectionStatus = 'connecting' }: DashboardLayoutProps) {
  const handleClearOpportunities = async () => {
    try {
      await apiService.clearOpportunities();
      alert('Opportunities cleared successfully');
    } catch (error) {
      console.error('Failed to clear opportunities:', error);
      alert('Failed to clear opportunities');
    }
  };

  const handleRefresh = async () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-md bg-ton flex items-center justify-center">
              <span className="text-white font-semibold">P</span>
            </div>
            <h1 className="text-xl font-semibold text-dark-gray">Periscope MEV Dashboard</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Connection status indicator */}
            <div className="flex items-center space-x-1 px-3 py-1.5 rounded-md">
              {connectionStatus === 'connected' ? (
                <div className="flex items-center space-x-1 text-green-500">
                  <Wifi size={16} />
                  <span className="text-sm">Connected</span>
                </div>
              ) : connectionStatus === 'disconnected' ? (
                <div className="flex items-center space-x-1 text-red-500">
                  <WifiOff size={16} />
                  <span className="text-sm">Disconnected</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1 text-yellow-500">
                  <Wifi size={16} className="animate-pulse" />
                  <span className="text-sm">Connecting...</span>
                </div>
              )}
            </div>
            
            <button className="flex items-center space-x-1 text-sm text-dark-gray-light px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors">
              <Command size={16} />
              <span>⌘K</span>
            </button>
            
            <button 
              className="flex items-center space-x-1 text-sm text-dark-gray-light px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
              onClick={handleClearOpportunities}
            >
              <Trash2 size={16} />
              <span>Clear</span>
            </button>
            
            <button 
              className="flex items-center space-x-1 text-sm text-dark-gray-light px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
              onClick={handleRefresh}
            >
              <RefreshCw size={16} />
              <span>Refresh</span>
            </button>
            
            <button className="flex items-center space-x-1 text-sm text-dark-gray-light px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors">
              <Settings size={16} />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-12 gap-6">
          {children}
        </div>
      </main>
      
      <footer className="border-t border-gray-200 py-4">
        <div className="container mx-auto px-6 text-center text-sm text-gray-500">
          Periscope MEV Operator Dashboard • {new Date().getFullYear()} • TON Blockchain
        </div>
      </footer>
    </div>
  );
}
