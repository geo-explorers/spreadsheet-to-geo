# External Integrations

**Analysis Date:** 2026-02-19

## APIs & External Services

**Geo Protocol GraphQL API:**
- Geo API for entity/type/property lookup
  - SDK/Client: Native fetch-based GraphQL client in `src/api/geo-client.ts`
  - Endpoints:
    - Testnet: `https://testnet-api.geobrowser.io/graphql`
    - Mainnet: `https://api.geobrowser.io/graphql`
  - Auth: None (public read queries only)
  - Used by: `src/processors/entity-processor.ts` for searching existing entities, types, and properties before publishing

**Geo RPC Network Endpoints:**
- Ethereum-compatible RPC for transaction submission
  - Testnet: `https://rpc-geo-test-zc16z3tcvf.t.conduit.xyz`
  - Mainnet: `https://rpc.geo.xyz` (placeholder - update with actual mainnet URL)
  - Used by: `src/publishers/publisher.ts` via viem's `http` transport

## Data Storage

**Databases:**
- None - this is a stateless CLI tool

**File Storage:**
- Local filesystem only
  - Input: Excel (.xlsx) or CSV files provided as CLI argument in `src/index.ts`
  - Output: JSON reports saved to `reports/` directory (or custom via `-o` option) via `src/publishers/publish-report.ts`

**Caching:**
- None - all queries made on each run

## Authentication & Identity

**Auth Provider:**
- Ethereum private key-based auth (custom)
  - Implementation: `src/publishers/publisher.ts` line 64-67
  - Private key: `PRIVATE_KEY` environment variable
  - Wallet client initialized via: `getSmartAccountWalletClient()` from `@geoprotocol/geo-sdk`
  - Validation: `validatePrivateKey()` function checks format (0x-prefixed 64 hex chars)

**Smart Account:**
- Uses Geo SDK's smart account wallet for transaction signing
- Automatically creates personal space if needed: `personalSpace.hasSpace()` and `personalSpace.createSpace()` (lines 128-140 in `src/publishers/publisher.ts`)

## Monitoring & Observability

**Error Tracking:**
- None - errors logged to console only

**Logs:**
- Console-based structured logging via `src/utils/logger.ts`
- Uses chalk for colored terminal output
- Log levels: debug, info, warn, error, success
- Verbose mode enabled via `--verbose` CLI flag
- Reports saved as JSON to filesystem

## CI/CD & Deployment

**Hosting:**
- N/A (CLI tool, self-hosted execution)

**CI Pipeline:**
- None detected (no GitHub Actions, CircleCI, etc.)

## Environment Configuration

**Required env vars:**
- `PRIVATE_KEY` - Ethereum private key for transaction signing (format: 0x followed by 64 hex characters)

**Optional env vars:**
- `NETWORK` - TESTNET or MAINNET (defaults to TESTNET if not set)
- `DAO_SPACE_ADDRESS` - Required only for DAO space publishing (optional feature)
- `CALLER_SPACE_ID` - Required only for DAO space publishing (optional feature)

**Secrets location:**
- `.env` file in project root (loaded by dotenv in `src/index.ts` line 33)
- `.env.example` provides template (private key must include 0x prefix, no actual secrets in example)

## Webhooks & Callbacks

**Incoming:**
- None - CLI tool has no incoming webhook support

**Outgoing:**
- None - no outgoing webhooks triggered by this tool

## Transaction Publishing

**Geo Protocol Publishing Methods:**

1. **Personal Space Publishing:**
   - Function: `publishToPersonalSpace()` in `src/publishers/publisher.ts` lines 114-181
   - Uses: `personalSpace.publishEdit()` from Geo SDK
   - Creates edit batch and submits transaction via wallet client
   - Waits for transaction confirmation via viem's `waitForTransactionReceipt()`

2. **DAO Space Publishing:**
   - Function: `publishToDAOSpace()` in `src/publishers/publisher.ts` lines 192-266
   - Uses: `daoSpace.proposeEdit()` from Geo SDK
   - Requires: `DAO_SPACE_ADDRESS` and `CALLER_SPACE_ID` environment variables
   - Creates proposal that requires governance vote to execute
   - Also waits for transaction confirmation

## Data Flow

**API Search Flow:**
1. Parse spreadsheet (xlsx library in `src/parsers/excel-parser.ts`)
2. Query Geo API for existing entities via `searchEntitiesByNames()` in `src/api/geo-client.ts`
3. Query for types via `searchTypesByNames()`
4. Query for properties via `searchPropertiesByNames()`
5. Build entity map with CREATE/LINK actions in `src/processors/entity-processor.ts`

**Publishing Flow:**
1. Build operations batch in `src/processors/batch-builder.ts` (creates Op[] array)
2. Initialize wallet via `getSmartAccountWalletClient()` (uses PRIVATE_KEY)
3. Call appropriate publish function:
   - Personal space: `personalSpace.publishEdit()` → `walletClient.sendTransaction()`
   - DAO space: `daoSpace.proposeEdit()` → `walletClient.sendTransaction()`
4. Wait for transaction receipt via `publicClient.waitForTransactionReceipt()`
5. Generate and save JSON report

---

*Integration audit: 2026-02-19*
