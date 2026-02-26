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
 * Full entity details returned from entity detail queries
 * Includes properties, relations (with their own IDs for deletion), and backlinks
 */
export interface EntityDetails {
  id: string;
  name: string | null;
  typeIds: string[];
  values: Array<{
    propertyId: string;
    text: string | null;
    boolean: boolean | null;
    integer: number | null;
    float: number | null;
    date: string | null;
    time: string | null;
    datetime: string | null;
    point: string | null;
    schedule: string | null;
  }>;
  relations: Array<{
    id: string;        // Relation's own ID -- needed for deleteRelation()
    typeId: string;
    toEntity: { id: string; name: string | null };
  }>;
  backlinks: Array<{
    id: string;        // Backlink relation's own ID -- needed for deleteRelation()
    typeId: string;
    fromEntity: { id: string; name: string | null };
  }>;
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
 * GraphQL query for fetching full entity details
 * Uses `relations` connection (NOT `relationsList`) to get the relation row's own ID,
 * which is required for Graph.deleteRelation({ id }).
 * Same pattern for `backlinks` connection.
 */
const ENTITY_DETAILS_QUERY = `
  query EntityDetails($id: UUID!, $spaceId: UUID!) {
    entity(id: $id) {
      id
      name
      typeIds
      valuesList(filter: { spaceId: { is: $spaceId } }) {
        propertyId
        text
        boolean
        integer
        float
        date
        time
        datetime
        point
        schedule
      }
      relations(filter: { spaceId: { is: $spaceId } }) {
        nodes {
          id
          typeId
          toEntity {
            id
            name
          }
        }
      }
      backlinks(filter: { spaceId: { is: $spaceId } }) {
        nodes {
          id
          typeId
          fromEntity {
            id
            name
          }
        }
      }
    }
  }
`;

/**
 * GraphQL query for fetching property details (dataType) by IDs.
 * Uses the `properties` root query which returns dataTypeName/dataTypeId
 * without needing to traverse DATA_TYPE relations manually.
 */
const PROPERTY_DETAILS_QUERY = `
  query PropertyDetails($ids: [UUID!]!) {
    properties(filter: { id: { in: $ids } }) {
      id
      name
      dataTypeName
      dataTypeId
    }
  }
`;

/**
 * Execute a GraphQL query against the Geo API
 */
async function executeQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  network: 'TESTNET' | 'MAINNET',
  maxRetries = 3
): Promise<T> {
  const endpoint = API_ENDPOINTS[network];
  const timeoutMs = 30_000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Retry on server errors (5xx)
      if (response.status >= 500 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        logger.debug(`API returned ${response.status}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };

      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }

      return result.data as T;
    } catch (error) {
      clearTimeout(timer);

      // Retry on network errors and timeouts
      const isRetryable =
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.includes('fetch failed'));

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        logger.debug(`API request failed (${error instanceof Error ? error.message : 'unknown'}), retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error('executeQuery: exhausted all retries');
}

/**
 * Search for a single entity by exact name match
 */
export async function searchEntityByName(
  name: string,
  spaceId: string | null,
  network: 'TESTNET' | 'MAINNET',
  expectedTypes?: string[]
): Promise<GeoEntity | null> {
  try {
    const data = await executeQuery<{ search: GeoEntity[] }>(
      SEARCH_QUERY,
      { query: name, spaceId, limit: 10 },
      network
    );

    // Filter for exact name match (case-insensitive)
    const normalizedSearch = normalizeEntityName(name);
    const exactMatches = data.search?.filter(
      entity => normalizeEntityName(entity.name) === normalizedSearch
    ) ?? [];

    if (exactMatches.length === 0) return null;

    // When expected types are provided, prefer a result whose type matches
    if (expectedTypes && expectedTypes.length > 0 && exactMatches.length > 1) {
      const normalizedExpected = expectedTypes.map(t => normalizeEntityName(t));
      const typeMatch = exactMatches.find(entity =>
        entity.types.some(t => normalizedExpected.includes(normalizeEntityName(t.name)))
      );
      if (typeMatch) return typeMatch;
    }

    // Fall back to first exact match (original behavior)
    return exactMatches[0];
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
  network: 'TESTNET' | 'MAINNET',
  typeHints?: Map<string, string[]>
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
    const searchPromises = batch.flatMap(name => {
      const normalized = normalizeEntityName(name);
      const expectedTypes = typeHints?.get(normalized);
      return isValidTargetSpace
        ? [searchEntityByName(name, ROOT_SPACE_ID, network, expectedTypes), searchEntityByName(name, targetSpaceId, network, expectedTypes)]
        : [searchEntityByName(name, ROOT_SPACE_ID, network, expectedTypes)];
    });

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
      logger.info(`Searched ${processed}/${names.length} entities...`);
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

  // Search types in parallel batches (same pattern as entities)
  const batchSize = 20;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const searchResults = await Promise.all(
      batch.map(name => searchEntityByName(name, ROOT_SPACE_ID, network))
    );

    for (let j = 0; j < batch.length; j++) {
      const entity = searchResults[j];
      if (entity) {
        results.set(normalizeEntityName(batch[j]), {
          id: entity.id,
          name: entity.name,
        });
      }
    }
  }

  logger.success(`Found ${results.size}/${names.length} existing types`);

  return results;
}

/**
 * Search for properties by names
 * Searches Root space first, then target space for custom properties
 */
export async function searchPropertiesByNames(
  names: string[],
  network: 'TESTNET' | 'MAINNET',
  targetSpaceId?: string
): Promise<Map<string, GeoProperty>> {
  const results = new Map<string, GeoProperty>();

  if (names.length === 0) {
    return results;
  }

  logger.info(`Searching for ${names.length} properties in Geo...`);

  const isValidTargetSpace =
    !!targetSpaceId &&
    targetSpaceId !== 'placeholder_space_id_for_dry_run' &&
    /^[0-9a-f]{32}$/i.test(targetSpaceId);

  // Step 1: Search property names in parallel batches (Root + target space)
  const batchSize = 20;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const searchPromises = batch.flatMap(name =>
      isValidTargetSpace
        ? [searchEntityByName(name, ROOT_SPACE_ID, network), searchEntityByName(name, targetSpaceId, network)]
        : [searchEntityByName(name, ROOT_SPACE_ID, network)]
    );

    const searchResults = await Promise.all(searchPromises);

    const stride = isValidTargetSpace ? 2 : 1;
    for (let j = 0; j < batch.length; j++) {
      const rootResult = searchResults[j * stride];
      const targetResult = isValidTargetSpace ? searchResults[j * stride + 1] : null;
      // Prefer target space result (custom property), fall back to root
      const entity = targetResult || rootResult;
      if (entity) {
        results.set(normalizeEntityName(batch[j]), {
          id: entity.id,
          name: entity.name,
          dataTypeId: '',
          dataTypeName: '',
        });
      }
    }
  }

  // Step 2: Batch-query property details to get dataType info
  const foundIds = Array.from(results.values()).map(p => p.id);
  if (foundIds.length > 0) {
    logger.debug(`Querying data types for ${foundIds.length} properties...`);
    try {
      const batchSize = 50;
      for (let i = 0; i < foundIds.length; i += batchSize) {
        const batch = foundIds.slice(i, i + batchSize);
        const data = await executeQuery<{
          properties: Array<{ id: string; name: string; dataTypeName: string | null; dataTypeId: string | null }>;
        }>(PROPERTY_DETAILS_QUERY, { ids: batch }, network);

        // Update results with dataType info
        for (const prop of data.properties ?? []) {
          // Find the result entry by ID
          for (const [, val] of results) {
            if (val.id === prop.id) {
              val.dataTypeId = prop.dataTypeId ?? '';
              val.dataTypeName = prop.dataTypeName ?? '';
              break;
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch property data types (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.success(`Found ${results.size}/${names.length} existing properties`);

  return results;
}

/**
 * Query entity by exact name in a specific space using the live entities index
 * (not the search index, which has indexing delay).
 * Used as a fallback when search finds a type-mismatched entity.
 */
export async function findEntityInSpace(
  name: string,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<GeoEntity | null> {
  try {
    const data = await executeQuery<{ entities: GeoEntity[] }>(
      ENTITIES_QUERY,
      { filter: { name: { is: name } }, spaceId, limit: 5 },
      network
    );

    const normalizedSearch = normalizeEntityName(name);
    const match = data.entities?.find(
      entity => normalizeEntityName(entity.name) === normalizedSearch
    );

    return match || null;
  } catch {
    return null;
  }
}

/**
 * Fetch existing relations for a set of entity IDs in a given space.
 * Returns a Set of dedup keys: "fromEntityId:toEntityId:typeId"
 */
export async function fetchExistingRelations(
  entityIds: string[],
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<Set<string>> {
  const dedupKeys = new Set<string>();

  if (entityIds.length === 0 || !spaceId) {
    return dedupKeys;
  }

  logger.info(`Checking for existing relations in space (dedup)...`);

  // Query outgoing relations for each entity in the target space.
  // Note: root query is `relations` (not `relationsList` which is an entity field).
  const RELATIONS_QUERY = `
    query EntityRelations($entityId: UUID!, $spaceId: UUID!) {
      relations(filter: { fromEntityId: { is: $entityId }, spaceId: { is: $spaceId } }) {
        fromEntityId
        toEntityId
        typeId
      }
    }
  `;

  const batchSize = 10;
  for (let i = 0; i < entityIds.length; i += batchSize) {
    const batch = entityIds.slice(i, i + batchSize);

    const promises = batch.map(entityId =>
      executeQuery<{
        relations: Array<{ fromEntityId: string; toEntityId: string; typeId: string }>;
      }>(RELATIONS_QUERY, { entityId, spaceId }, network).catch(() => ({
        relations: [] as Array<{ fromEntityId: string; toEntityId: string; typeId: string }>,
      }))
    );

    const results = await Promise.all(promises);

    for (const result of results) {
      for (const rel of result.relations ?? []) {
        dedupKeys.add(`${rel.fromEntityId}:${rel.toEntityId}:${rel.typeId}`);
      }
    }
  }

  if (dedupKeys.size > 0) {
    logger.info(`Found ${dedupKeys.size} existing relations in space`);
  }

  return dedupKeys;
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

/**
 * Fetch full details for an entity by ID
 * Returns properties, outgoing relations (with their own IDs), incoming relations (backlinks),
 * type assignments, and name. Returns null for non-existent entities.
 */
export async function fetchEntityDetails(
  entityId: string,
  spaceId: string,
  network: 'TESTNET' | 'MAINNET'
): Promise<EntityDetails | null> {
  try {
    const data = await executeQuery<{
      entity: {
        id: string;
        name: string | null;
        typeIds: string[];
        valuesList: EntityDetails['values'];
        relations: { nodes: EntityDetails['relations'] };
        backlinks: { nodes: EntityDetails['backlinks'] };
      } | null;
    }>(ENTITY_DETAILS_QUERY, { id: entityId, spaceId }, network);

    if (!data.entity) return null;

    return {
      id: data.entity.id,
      name: data.entity.name,
      typeIds: data.entity.typeIds,
      values: data.entity.valuesList,
      relations: data.entity.relations.nodes,
      backlinks: data.entity.backlinks.nodes,
    };
  } catch (error) {
    logger.warn(`Failed to fetch entity details for "${entityId}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
