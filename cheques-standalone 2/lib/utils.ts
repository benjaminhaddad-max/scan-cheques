import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditionnel de classes Tailwind (helper shadcn/ui standard).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
