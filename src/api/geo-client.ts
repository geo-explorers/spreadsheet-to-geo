/**
 * Geo GraphQL API client for searching existing entities, types, and properties
 */

import { SystemIds } from '@geoprotocol/geo-sdk';
import { logger } from '../utils/logger.js';
import { normalizeEntityName } from '../utils/cell-parsers.js';

// API Endpoints
const API_ENDPOINTS = {
  TESTNET: 'https://testnet-api.geobrowser.io/graphql',
  MAINNET: 'https://api.geobrowser.io/graphql',
} as const;

// Root space ID from SDK
const ROOT_SPACE_ID = SystemIds.ROOT_SPACE_ID;

/**
 * Entity returned from Geo API search
 */
export interface GeoEntity {
  id: string;
  name: string;
  types: Array<{ id: string; name: string }>;
  spaceIds: string[];
}

/**
 * Type info from Geo API
 */
export interface GeoType {
  id: string;
  name: string;
}

/**
 * Property info from Geo API
 */
export interface GeoProperty {
  id: string;
  name: string;
  dataTypeId: string;
  dataTypeName: string;
}

/**
 * GraphQL query for entity search
 */
const SEARCH_QUERY = `
  query Search($query: String!, $spaceId: UUID, $limit: Int) {
    search(query: $query, spaceId: $spaceId, first: $limit) {
      id
      name
      spaceIds
      types {
        id
        name
      }
    }
  }
`;

/**
 * GraphQL query for getting entities by filter
 */
const ENTITIES_QUERY = `
  query Entities($filter: EntityFilter, $spaceId: UUID, $limit: Int) {
    entities(filter: $filter, spaceId: $spaceId, first: $limit) {
      id
      name
      spaceIds
      types {
        id
        name
      }
    }
  }
`;

/**
 * Execute a GraphQL query against the Geo API
 */
async function executeQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  network: 'TESTNET' | 'MAINNET'
): Promise<T> {
  const endpoint = API_ENDPOINTS[network];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
  }

  return result.data as T;
}

/**
 * Search for a single entity by exact name match
 */
export async function searchEntityByName(
  name: string,
  spaceId: string | null,
  network: 'TESTNET' | 'MAINNET'
): Promise<GeoEntity | null> {
  try {
    const data = await executeQuery<{ search: GeoEntity[] }>(
      SEARCH_QUERY,
      { query: name, spaceId, limit: 10 },
      network
    );

    // Filter for exact name match (case-insensitive)
    const normalizedSearch = normalizeEntityName(name);
    const match = data.search?.find(
      entity => normalizeEntityName(entity.name) === normalizedSearch
    );

    return match || null;
  } catch (error) {
    logger.warn(`Failed to search for entity "${name}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Search for entities by names across Root space and target space
 * Returns a map of normalized name -> GeoEntity for found entities
 */
export async function searchEntitiesByNames(
  names: string[],
  targetSpaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<Map<string, GeoEntity>> {
  const results = new Map<string, GeoEntity>();

  if (names.length === 0) {
    return results;
  }

  logger.info(`Searching for ${names.length} entities in Geo...`);

  // Only search target space if a real space ID is provided
  const isValidTargetSpace =
    !!targetSpaceId &&
    targetSpaceId !== 'placeholder_space_id_for_dry_run' &&
    /^[0-9a-f]{32}$/i.test(targetSpaceId);

  if (!isValidTargetSpace) {
    logger.debug('No valid target space ID — searching Root space only');
  }

  // Search in batches to avoid overwhelming the API
  const batchSize = 20;
  let processed = 0;

  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);

    // Always search Root space; only search target space if ID is valid
    const searchPromises = batch.flatMap(name =>
      isValidTargetSpace
        ? [searchEntityByName(name, ROOT_SPACE_ID, network), searchEntityByName(name, targetSpaceId, network)]
        : [searchEntityByName(name, ROOT_SPACE_ID, network)]
    );

    const searchResults = await Promise.all(searchPromises);

    // Process results - prefer target space match over Root space
    const stride = isValidTargetSpace ? 2 : 1;
    for (let j = 0; j < batch.length; j++) {
      const name = batch[j];
      const normalized = normalizeEntityName(name);
      const rootResult = searchResults[j * stride];
      const targetResult = isValidTargetSpace ? searchResults[j * stride + 1] : null;

      // Prefer target space result, fall back to root space
      const result = targetResult || rootResult;
      if (result) {
        results.set(normalized, result);
      }
    }

    processed += batch.length;
    if (names.length > batchSize) {
      logger.debug(`Searched ${processed}/${names.length} entities...`);
    }
  }

  logger.success(`Found ${results.size}/${names.length} existing entities`);

  return results;
}

/**
 * Search for types by names
 * Types are typically in the Root space
 */
export async function searchTypesByNames(
  names: string[],
  network: 'TESTNET' | 'MAINNET'
): Promise<Map<string, GeoType>> {
  const results = new Map<string, GeoType>();

  if (names.length === 0) {
    return results;
  }

  logger.info(`Searching for ${names.length} types in Geo...`);

  // Search each type name
  for (const name of names) {
    const entity = await searchEntityByName(name, ROOT_SPACE_ID, network);
    if (entity) {
      const normalized = normalizeEntityName(name);
      results.set(normalized, {
        id: entity.id,
        name: entity.name,
      });
    }
  }

  logger.success(`Found ${results.size}/${names.length} existing types`);

  return results;
}

/**
 * Search for properties by names
 * Properties are typically in the Root space
 */
export async function searchPropertiesByNames(
  names: string[],
  network: 'TESTNET' | 'MAINNET'
): Promise<Map<string, GeoProperty>> {
  const results = new Map<string, GeoProperty>();

  if (names.length === 0) {
    return results;
  }

  logger.info(`Searching for ${names.length} properties in Geo...`);

  // Search each property name
  for (const name of names) {
    const entity = await searchEntityByName(name, ROOT_SPACE_ID, network);
    if (entity) {
      const normalized = normalizeEntityName(name);
      // Note: We're treating properties as entities here
      // The actual property lookup would need a different query
      results.set(normalized, {
        id: entity.id,
        name: entity.name,
        dataTypeId: '', // Would need property-specific query
        dataTypeName: '', // Would need property-specific query
      });
    }
  }

  logger.success(`Found ${results.size}/${names.length} existing properties`);

  return results;
}

/**
 * Test API connectivity
 */
export async function testApiConnection(network: 'TESTNET' | 'MAINNET'): Promise<boolean> {
  try {
    const data = await executeQuery<{ __typename: string }>(
      '{ __typename }',
      {},
      network
    );
    return !!data;
  } catch (error) {
    logger.error(`API connection test failed for ${network}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
