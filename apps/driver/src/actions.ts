import type { Order } from '@multigo/api-client';

export type DriverAction =
  | { kind: 'status'; status: 'PICKED_UP'; label: string }
  | { kind: 'delivery'; action: 'PICKED_UP' | 'DELIVERED'; label: string };

/**
 * Mirrors the backend: ASSIGNED -> PICKED_UP via POST /orders/:id/status; PICKED_UP -> IN_TRANSIT and
 * IN_TRANSIT -> DELIVERED via POST /orders/:id/delivery (which requires exactly those current statuses).
 */
export function nextDriverAction(status: Order['status']): DriverAction | null {
  switch (status) {
    case 'ASSIGNED': return { kind: 'status', status: 'PICKED_UP', label: 'Confirm pickup' };
    case 'PICKED_UP': return { kind: 'delivery', action: 'PICKED_UP', label: 'Start delivery' };
    case 'IN_TRANSIT': return { kind: 'delivery', action: 'DELIVERED', label: 'Mark delivered' };
    default: return null;
  }
}

export const ACTIVE_STATUSES: readonly Order['status'][] = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];
