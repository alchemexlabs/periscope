import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: 'default' | 'ton' | 'success' | 'warning' | 'danger';
}

export function Badge({ 
  className, 
  children, 
  variant = 'default',
  ...props 
}: BadgeProps) {
  return (
    <span 
      className={cn(
        'badge',
        {
          'bg-gray-100 text-dark-gray': variant === 'default',
          'badge-ton': variant === 'ton',
          'badge-success': variant === 'success',
          'badge-warning': variant === 'warning',
          'badge-danger': variant === 'danger',
        },
        className
      )} 
      {...props}
    >
      {children}
    </span>
  );
}
