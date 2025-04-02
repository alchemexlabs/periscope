import React, { useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  SortingState,
  getFilteredRowModel,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, Filter, Trash2 } from 'lucide-react';
import { Opportunity } from '../lib/api';
import { formatCurrency, timeAgo } from '../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';

interface OpportunitiesTableProps {
  opportunities: Opportunity[];
  onClearOpportunities?: (strategyName?: string) => Promise<void>;
}

const columnHelper = createColumnHelper<Opportunity>();

export function OpportunitiesTable({ opportunities, onClearOpportunities }: OpportunitiesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'timestamp', desc: true }
  ]);
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [minProfitFilter, setMinProfitFilter] = useState<number>(0);

  const columns = [
    columnHelper.accessor('strategy', {
      header: 'Strategy',
      cell: (info) => (
        <div className="flex items-center">
          <Badge 
            variant={info.getValue() === 'arbitrage' ? 'ton' : 'success'}
            className="capitalize"
          >
            {info.getValue()}
          </Badge>
        </div>
      ),
    }),
    columnHelper.accessor((row) => {
      if (row.strategy === 'arbitrage') {
        return row.details.tokenPair;
      } else if (row.strategy === 'sandwich') {
        return row.details.tokenPair;
      }
      return 'Unknown';
    }, {
      id: 'tokenPair',
      header: 'Token Pair',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    columnHelper.accessor('profitEstimate', {
      header: 'Profit',
      cell: (info) => (
        <span className="font-medium text-success">
          {formatCurrency(info.getValue(), 'TON')}
        </span>
      ),
      sortDescFirst: true,
    }),
    columnHelper.accessor('confidence', {
      header: 'Confidence',
      cell: (info) => (
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div 
            className="h-2 rounded-full bg-ton" 
            style={{ width: `${info.getValue() * 100}%` }}
          />
        </div>
      ),
    }),
    columnHelper.accessor('timestamp', {
      header: 'Time',
      cell: (info) => <span className="text-sm text-gray-500">{timeAgo(info.getValue())}</span>,
    }),
    columnHelper.accessor((row) => {
      if (row.strategy === 'arbitrage') {
        return row.details.executionPlan;
      } else if (row.strategy === 'sandwich') {
        return row.details.executionPlan;
      }
      return '';
    }, {
      id: 'executionPlan',
      header: 'Execution Plan',
      cell: (info) => <span className="text-sm monospace">{info.getValue()}</span>,
    }),
  ];

  const filteredOpportunities = React.useMemo(() => {
    return opportunities.filter(opp => {
      if (strategyFilter !== 'all' && opp.strategy !== strategyFilter) return false;
      if (opp.profitEstimate < minProfitFilter) return false;
      return true;
    });
  }, [opportunities, strategyFilter, minProfitFilter]);

  const table = useReactTable({
    data: filteredOpportunities,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const handleClearOpportunities = async (strategyName?: string) => {
    if (onClearOpportunities) {
      try {
        await onClearOpportunities(strategyName);
      } catch (error) {
        console.error('Failed to clear opportunities:', error);
      }
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle size="lg">Active MEV Opportunities</CardTitle>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Filter size={16} />
              <select 
                className="bg-transparent border border-gray-200 rounded px-2 py-1 text-sm"
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
              >
                <option value="all">All Strategies</option>
                <option value="arbitrage">Arbitrage</option>
                <option value="sandwich">Sandwich</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-sm">Min Profit:</span>
              <input 
                type="number" 
                className="w-20 bg-transparent border border-gray-200 rounded px-2 py-1 text-sm"
                value={minProfitFilter}
                onChange={(e) => setMinProfitFilter(Number(e.target.value))}
                min={0}
                step={0.01}
              />
            </div>
            {onClearOpportunities && (
              <div className="flex items-center space-x-2">
                <button
                  className="flex items-center space-x-1 text-sm text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  onClick={() => handleClearOpportunities()}
                  title="Clear all opportunities"
                >
                  <Trash2 size={16} />
                  <span>Clear All</span>
                </button>
                {strategyFilter !== 'all' && (
                  <button
                    className="flex items-center space-x-1 text-sm text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    onClick={() => handleClearOpportunities(strategyFilter)}
                    title={`Clear ${strategyFilter} opportunities`}
                  >
                    <Trash2 size={16} />
                    <span>Clear {strategyFilter}</span>
                  </button>
                )}
              </div>
            )}
            <Badge variant="ton">Live</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {table.getFlatHeaders().map((header) => (
                  <th 
                    key={header.id}
                    className="text-left p-3 border-b border-gray-200 bg-gray-50 text-gray-500 text-sm font-medium"
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={`flex items-center space-x-1 ${header.column.getCanSort() ? 'cursor-pointer select-none' : ''}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        {{
                          asc: <ChevronUp size={16} />,
                          desc: <ChevronDown size={16} />,
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-3 border-b border-gray-200">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="p-3 text-center text-gray-500">
                    No opportunities found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
