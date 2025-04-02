import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * Combines class names with Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a number as currency
 */
export function formatCurrency(amount: number, currency = 'TON', digits = 2): string {
  return `${amount.toFixed(digits)} ${currency}`;
}

/**
 * Formats a percentage
 */
export function formatPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

/**
 * Formats a date in a readable format
 */
export function formatDate(date: Date | number | string): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' 
    ? new Date(date) 
    : date;
  
  return format(dateObj, 'MMM dd, yyyy HH:mm:ss');
}

/**
 * Returns a relative time string (e.g., "2 minutes ago")
 */
export function timeAgo(date: Date | number | string): string {
  const dateObj = typeof date === 'string' || typeof date === 'number' 
    ? new Date(date) 
    : date;
  
  return formatDistanceToNow(dateObj, { addSuffix: true });
}

/**
 * Truncates a string to a specified length
 */
export function truncate(str: string, length = 20): string {
  if (str.length <= length) return str;
  return `${str.substring(0, length)}...`;
}

/**
 * Formats a hash for display
 */
export function formatHash(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 12) return hash;
  return `${hash.substring(0, 6)}...${hash.substring(hash.length - 6)}`;
}

/**
 * Debounces a function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return function(...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Generates a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
