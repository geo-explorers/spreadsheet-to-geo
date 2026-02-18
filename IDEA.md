# Spreadsheet-to-Geo Publishing Script - Algorithm Overview

## Purpose

This CLI tool parses Excel spreadsheets and publishes structured data to the Geo protocol. It handles entity deduplication by querying the Geo API to find existing entities before creating new ones.

## High-Level Flow

`Excel File → Parse → Validate → Query API → Build Operations → Publish`

## Detailed Algorithm

### Step 1: Structure Check

**File:** src/parsers/excel-parser.ts

- Verify required tabs exist: `Metadata`, `Types`, `Properties`
- Any other tab is treated as an entity tab (tab name = entity type)

### Step 2: Parse Spreadsheet

**File:** src/parsers/excel-parser.ts

`For each tab:
  Metadata tab → Extract space ID, space type, author info
  Types tab    → Extract type definitions (name, description)
  Properties tab → Extract property definitions (name, dataType, pointsToTypes)
  Entity tabs  → For each non-special tab:
    - Tab name becomes the default type
    - Parse each row as an entity
    - Separate regular properties from RELATION properties
    - RELATION columns → stored in entity.relations as arrays of target names
    - Other columns → stored in entity.properties as key-value pairs`

### Step 3: Validate Data

**File:** src/parsers/validators.ts

`Validation checks:
  - Metadata: Space ID present, valid space type (Personal/DAO)
  - Types: No duplicates, names required
  - Properties: Valid data types, RELATION properties have target types
  - Entities: Names required, types reference known types
  - References: Relation targets exist (warning if not - may exist in Geo)`

### Step 4: Build Entity Map (API Queries)

**Files:** src/processors/entity-processor.ts, src/api/geo-client.ts

This is the core deduplication step:

`1. Collect all unique names:
   - All entity names from entity tabs
   - All relation target names (referenced entities)

2. Query Geo GraphQL API in parallel:
   - searchEntitiesByNames() → Search Root space + target space
   - searchTypesByNames() → Search Root space for types
   - searchPropertiesByNames() → Search Root space for properties

3. For each type in spreadsheet:
   IF found in API → action='LINK', use existing ID
   ELSE → action='CREATE', generate new UUID

4. For each property in spreadsheet:
   IF found in API → action='LINK', use existing ID
   ELSE → action='CREATE', generate new UUID

5. For each entity (including relation targets):
   IF found in API → action='LINK', use existing ID, inherit types from API
   ELSE → action='CREATE', generate new UUID, use spreadsheet types

Result: EntityMap with resolved IDs and actions for everything`

### Step 5: Build Relations

**File:** src/processors/relation-builder.ts

`For each entity in spreadsheet:
  IF entity.action == 'LINK':
    SKIP (can't modify entities in other spaces)
  
  For each relation property on entity:
    For each target name in relation:
      Create RelationToCreate {
        fromEntityId, toEntityId, propertyId
      }`

### Step 6: Build Operations Batch

**File:** src/processors/batch-builder.ts

Uses Geo SDK's `Graph` module to create operations:

`Phase 1: Properties
  For each property WHERE action='CREATE':
    ops.push(...Graph.createProperty({ id, name, dataType }))

Phase 2: Types  
  For each type WHERE action='CREATE':
    ops.push(...Graph.createType({ id, name, description }))

Phase 3: Entities
  For each entity WHERE action='CREATE':
    - Convert property values to SDK TypedValue format
    - ops.push(...Graph.createEntity({ id, name, types, values }))

Phase 4: Relations
  For each relation:
    ops.push(...Graph.createRelation({ fromEntity, toEntity, type }))`

### Step 7: Publish

**File:** src/publishers/publisher.ts

`IF dry-run:
  Stop here, show summary

ELSE:
  1. Initialize wallet from PRIVATE_KEY
  2. Based on space type:
     Personal → personalSpace.publishEdit()
     DAO → daoSpace.proposeEdit()
  3. Submit transaction
  4. Wait for confirmation
  5. Generate report`

## Key Data Structures

`// After parsing
ParsedSpreadsheet {
  metadata: { spaceId, spaceType, author }
  types: [{ name, description }]
  properties: [{ name, dataType, pointsToTypes }]
  entities: [{ name, types, properties, relations, sourceTab }]
}

// After API resolution
EntityMap {
  entities: Map<normalizedName, ResolvedEntity>
  types: Map<normalizedName, ResolvedType>
  properties: Map<normalizedName, ResolvedProperty>
}

ResolvedEntity {
  name, id, types, typeIds,
  action: 'CREATE' | 'LINK'  // Key field
}`

## Deduplication Logic

The script avoids creating duplicates by:

1. **Exact name matching** - Normalizes names (lowercase, trim, collapse whitespace) for comparison
2. **Search scope** - Queries both Root space (common types/entities) and target space
3. **Link vs Create** - Existing entities get `LINK` action, new ones get `CREATE`
4. **Skip modifications** - Linked entities don't get properties or relations added (they already exist elsewhere)