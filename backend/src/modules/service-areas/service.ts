import type { Pool, PoolClient } from 'pg';
import type { DeliveryAddress } from './types.js';

export async function getActiveDeliveryArea(db: Pool | PoolClient, stateCode: string, postalCode: string) {
  const result = await db.query<{ city_name: string }>(
    `SELECT city_name
     FROM delivery_service_areas
     WHERE state_code=$1 AND postal_code=$2 AND active=true`,
    [stateCode, postalCode],
  );
  return result.rows[0];
}

export async function requireActiveDeliveryArea(db: PoolClient, address: DeliveryAddress): Promise<void> {
  const result = await db.query(
    `SELECT 1
     FROM delivery_service_areas
     WHERE state_code=$1 AND postal_code=$2 AND active=true
     FOR SHARE`,
    [address.stateCode, address.postalCode],
  );
  if (!result.rowCount) throw new Error('DELIVERY_AREA_UNAVAILABLE');
}
