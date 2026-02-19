# Technology Stack

**Analysis Date:** 2026-02-19

## Languages

**Primary:**
- TypeScript 5.6.0 - All source code in `src/`

**Secondary:**
- JavaScript (ES2022 target) - Compiled output

## Runtime

**Environment:**
- Node.js 18.0.0 or higher (specified in `package.json` engines)

**Package Manager:**
- npm 10.x (implied by package-lock.json v3)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Commander 12.1.0 - CLI argument parsing and command structure

**Blockchain/Web3:**
- Viem 2.21.0 - Ethereum wallet and transaction client
- @geoprotocol/geo-sdk (latest) - Geo protocol SDK for publishing operations (custom submodule at `submodules/geo-sdk`)

**Build/Dev:**
- TypeScript 5.6.0 - Type checking and transpilation
- TSX 4.19.0 - TypeScript execution for `npm run dev` command

## Key Dependencies

**Critical:**
- xlsx 0.18.5 - Excel/CSV file parsing (handles Metadata, Types, Properties, and entity tabs)
- viem 2.21.0 - Handles wallet client initialization and blockchain transactions
- @geoprotocol/geo-sdk (latest) - Core publishing operations; defines Op[] types and transaction builders

**Infrastructure:**
- dotenv 16.4.5 - Environment variable loading from `.env` files
- chalk 5.3.0 - Terminal output formatting and colored logging

**Development:**
- @types/node 22.0.0 - Node.js type definitions
- typescript 5.6.0 - Language and type checking

## Configuration

**Environment:**
- Loads from `.env` file via dotenv (see `.env.example`)
- Required: `PRIVATE_KEY` (Ethereum private key with 0x prefix)
- Optional: `NETWORK` (TESTNET or MAINNET, defaults to TESTNET)
- Optional for DAO publishing: `DAO_SPACE_ADDRESS`, `CALLER_SPACE_ID`

**Build:**
- `tsconfig.json` - TypeScript compilation to ES2022/NodeNext modules
  - Output: `dist/` directory
  - Source: `src/` directory
  - Strict mode enabled, declaration maps and source maps generated

## Platform Requirements

**Development:**
- Node.js >= 18.0.0
- npm or compatible package manager

**Production:**
- Node.js >= 18.0.0
- Network access to:
  - Geo protocol RPC endpoints (testnet: `https://rpc-geo-test-zc16z3tcvf.t.conduit.xyz`, mainnet: `https://rpc.geo.xyz`)
  - Geo GraphQL API (testnet: `https://testnet-api.geobrowser.io/graphql`, mainnet: `https://api.geobrowser.io/graphql`)

## Build Output

**Executable:**
- Shebang line: `#!/usr/bin/env node` in `src/index.ts`
- Compiled to: `dist/index.js`
- Registered as CLI command: `geo-publish` (via `package.json` bin field)
- Can be executed: `node dist/index.js <file>` or installed globally as `geo-publish`

---

*Stack analysis: 2026-02-19*
