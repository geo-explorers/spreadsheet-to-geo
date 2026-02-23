/**
 * Publisher - publish operations to Geo protocol
 *
 * Operations are already in SDK format (Op[]) from the batch-builder,
 * so we just pass them directly to the SDK's publish functions.
 */

import { createPublicClient, http, parseEventLogs } from 'viem';
import {
  personalSpace,
  daoSpace,
  getSmartAccountWalletClient,
  type Op,
  type Network,
} from '@geoprotocol/geo-sdk';
import type { Metadata, PublishOptions } from '../config/types.js';
import type { OperationsBatch, PublishResult } from '../config/upsert-types.js';
import { logger } from '../utils/logger.js';

// MainVoting event ABI fragment — used to decode proposal info from receipt logs
const PublishEditsProposalCreatedEvent = {
  anonymous: false,
  inputs: [
    { indexed: true, internalType: 'uint256', name: 'proposalId', type: 'uint256' },
    { indexed: true, internalType: 'address', name: 'creator', type: 'address' },
    { indexed: false, internalType: 'uint64', name: 'startDate', type: 'uint64' },
    { indexed: false, internalType: 'uint64', name: 'endDate', type: 'uint64' },
    { indexed: false, internalType: 'string', name: 'editsContentUri', type: 'string' },
    { indexed: false, internalType: 'address', name: 'dao', type: 'address' },
  ],
  name: 'PublishEditsProposalCreated',
  type: 'event',
} as const;

// SpaceRegistry ABI fragment — used to resolve spaceId → contract address
const SpaceRegistryAbi = [
  {
    inputs: [{ internalType: 'bytes16', name: '_spaceId', type: 'bytes16' }],
    name: 'spaceIdToAddress',
    outputs: [{ internalType: 'address', name: '_account', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const SPACE_REGISTRY_ADDRESS = '0xB01683b2f0d38d43fcD4D9aAB980166988924132' as const;

// DAO Space ABI fragment — used to check caller's role (EDITOR vs MEMBER)
const DaoSpaceRoleAbi = [
  {
    inputs: [],
    name: 'EDITOR',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: '_role', type: 'bytes32' },
      { internalType: 'bytes16', name: '_spaceId', type: 'bytes16' },
    ],
    name: 'hasRole',
    outputs: [{ internalType: 'bool', name: '_hasRole', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Network configurations
const NETWORKS = {
  TESTNET: {
    rpcUrl: 'https://rpc-geo-test-zc16z3tcvf.t.conduit.xyz',
    apiUrl: 'https://testnet-api.geobrowser.io/graphql',
  },
  MAINNET: {
    rpcUrl: 'https://rpc.geo.xyz', // Placeholder - update with actual mainnet URL
    apiUrl: 'https://api.geobrowser.io/graphql',
  },
};

/**
 * Publish operations batch to Geo
 */
export async function publishToGeo(
  batch: OperationsBatch,
  metadata: Metadata,
  privateKey: string,
  options: PublishOptions
): Promise<PublishResult> {
  const network = NETWORKS[options.network];

  logger.section('Publishing to Geo');
  logger.keyValue('Network', options.network);
  logger.keyValue('Space ID', metadata.spaceId);
  logger.keyValue('Space Type', metadata.spaceType);
  logger.keyValue('Operations', batch.ops.length.toString());

  if (options.dryRun) {
    logger.info('DRY RUN - No changes will be made');
    return {
      success: true,
      summary: batch.summary,
    };
  }

  try {
    // Initialize wallet client
    logger.info('Initializing wallet...');
    const walletClient = await getSmartAccountWalletClient({
      privateKey: privateKey as `0x${string}`,
      rpcUrl: network.rpcUrl,
    });

    const walletAddress = walletClient.account.address;
    logger.keyValue('Wallet Address', walletAddress);

    // Operations are already in SDK format from batch-builder
    const ops = batch.ops;

    // Publish based on space type
    let result;
    if (metadata.spaceType === 'DAO') {
      result = await publishToDAOSpace(
        ops,
        metadata,
        walletClient,
        walletAddress,
        options
      );
    } else {
      result = await publishToPersonalSpace(
        ops,
        metadata,
        walletClient,
        walletAddress,
        options
      );
    }

    return {
      ...result,
      summary: batch.summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Publish failed', { error: message });

    return {
      success: false,
      error: message,
      summary: batch.summary,
    };
  }
}

/**
 * Publish to personal space
 */
async function publishToPersonalSpace(
  ops: Op[],
  metadata: Metadata,
  walletClient: Awaited<ReturnType<typeof getSmartAccountWalletClient>>,
  walletAddress: string,
  options: PublishOptions
): Promise<Omit<PublishResult, 'summary'>> {
  logger.info('Publishing to personal space...');

  // Use curator's personal space ID as author when provided, otherwise fall back to wallet
  const author = metadata.author || walletAddress;
  logger.keyValue('Author', metadata.author ? `${author} (from Metadata tab)` : `${author} (wallet — no author in Metadata)`);

  // Check if space exists, create if needed
  const hasSpace = await personalSpace.hasSpace({
    address: walletAddress as `0x${string}`,
  });

  if (!hasSpace) {
    logger.info('Creating personal space...');
    const { to, calldata } = personalSpace.createSpace();
    const txHash = await walletClient.sendTransaction({
      to,
      data: calldata,
    });
    logger.success('Personal space created', { txHash });
  }

  // Publish edit
  // Note: SDK currently only supports TESTNET
  const { cid, editId, to, calldata } = await personalSpace.publishEdit({
    name: `Spreadsheet import - ${new Date().toISOString()}`,
    spaceId: metadata.spaceId,
    ops,
    author,
    network: options.network as Network,
  });

  logger.info('Submitting transaction...');
  const txHash = await walletClient.sendTransaction({
    to,
    data: calldata,
  });

  // Wait for confirmation
  logger.info('Waiting for confirmation...');
  const publicClient = createPublicClient({
    transport: http(NETWORKS[options.network].rpcUrl),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === 'success') {
    logger.success('Published successfully!');
    return {
      success: true,
      editId,
      cid,
      transactionHash: txHash,
    };
  } else {
    return {
      success: false,
      error: 'Transaction reverted',
      transactionHash: txHash,
    };
  }
}

/**
 * Publish to DAO space (create proposal)
 *
 * Requires CALLER_SPACE_ID in environment variables (proposer's personal space ID).
 * The DAO space contract address is resolved on-chain from the space ID via SpaceRegistry.
 */
async function publishToDAOSpace(
  ops: Op[],
  metadata: Metadata,
  walletClient: Awaited<ReturnType<typeof getSmartAccountWalletClient>>,
  walletAddress: string,
  options: PublishOptions
): Promise<Omit<PublishResult, 'summary'>> {
  logger.info('Publishing to DAO space (creating proposal)...');

  // Use curator's personal space ID as author when provided, otherwise fall back to wallet
  const author = metadata.author || walletAddress;
  logger.keyValue('Author', metadata.author ? `${author} (from Metadata tab)` : `${author} (wallet — no author in Metadata)`);

  const callerSpaceId = process.env.CALLER_SPACE_ID as `0x${string}` | undefined;

  if (!callerSpaceId) {
    return {
      success: false,
      error: 'DAO space publishing requires CALLER_SPACE_ID environment variable (your personal space ID, bytes16 hex)',
    };
  }

  try {
    // Resolve DAO space contract address on-chain from space ID
    const publicClient = createPublicClient({
      transport: http(NETWORKS[options.network].rpcUrl),
    });

    const daoSpaceId = `0x${metadata.spaceId}` as `0x${string}`;
    logger.info('Resolving DAO space contract address from SpaceRegistry...');

    const daoSpaceAddress = await publicClient.readContract({
      address: SPACE_REGISTRY_ADDRESS,
      abi: SpaceRegistryAbi,
      functionName: 'spaceIdToAddress',
      args: [daoSpaceId],
    });

    if (!daoSpaceAddress || daoSpaceAddress === '0x0000000000000000000000000000000000000000') {
      return {
        success: false,
        error: `Could not resolve contract address for space ID ${metadata.spaceId} — is it registered on-chain?`,
      };
    }

    logger.keyValue('DAO Space Address', daoSpaceAddress);

    // Determine voting mode: EDITORs can use FAST, MEMBERs must use SLOW
    const editorRole = await publicClient.readContract({
      address: daoSpaceAddress,
      abi: DaoSpaceRoleAbi,
      functionName: 'EDITOR',
    });

    const isEditor = await publicClient.readContract({
      address: daoSpaceAddress,
      abi: DaoSpaceRoleAbi,
      functionName: 'hasRole',
      args: [editorRole, callerSpaceId],
    });

    const votingMode = isEditor ? 'FAST' : 'SLOW';
    logger.keyValue('Caller Role', isEditor ? 'EDITOR (fast path)' : 'MEMBER (slow path)');
    logger.keyValue('Voting Mode', votingMode);

    const { cid, editId, to, calldata } = await daoSpace.proposeEdit({
      name: `Spreadsheet import - ${new Date().toISOString()}`,
      ops,
      author,
      daoSpaceAddress,
      callerSpaceId,
      daoSpaceId,
      votingMode,
      network: options.network as Network,
    });

    logger.info('Submitting proposal transaction...');
    const txHash = await walletClient.sendTransaction({
      to,
      data: calldata,
    });

    // Wait for confirmation (reuse publicClient from above)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === 'success') {
      logger.success('Proposal created successfully!');
      logger.warn('Note: Proposal requires governance vote to execute');

      // Parse receipt logs to extract voting contract address + on-chain proposal ID
      const proposalEvents = parseEventLogs({
        abi: [PublishEditsProposalCreatedEvent],
        logs: receipt.logs,
      });

      if (proposalEvents.length > 0) {
        const event = proposalEvents[0];
        const votingContractAddress = event.address;
        const onchainProposalId = event.args.proposalId;
        const startDate = new Date(Number(event.args.startDate) * 1000);
        const endDate = new Date(Number(event.args.endDate) * 1000);

        logger.section('Proposal Details (save for cancellation)');
        logger.keyValue('Voting Contract', votingContractAddress);
        logger.keyValue('On-chain Proposal ID', onchainProposalId.toString());
        logger.keyValue('Creator', event.args.creator);
        logger.keyValue('Voting Start', startDate.toISOString());
        logger.keyValue('Voting End', endDate.toISOString());
      } else {
        logger.warn('Could not find PublishEditsProposalCreated event in receipt logs');
      }

      return {
        success: true,
        editId: editId.toString(),
        cid,
        transactionHash: txHash,
      };
    } else {
      return {
        success: false,
        error: 'Transaction reverted',
        transactionHash: txHash,
      };
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        success: false,
        error: `DAO proposal failed: ${error.message}`,
      };
    }
    throw error;
  }
}

/**
 * Validate private key format
 */
export function validatePrivateKey(key: string): boolean {
  if (!key) return false;

  // Should start with 0x
  if (!key.startsWith('0x')) return false;

  // Should be 66 characters (0x + 64 hex chars)
  if (key.length !== 66) return false;

  // Should be valid hex
  return /^0x[a-fA-F0-9]{64}$/.test(key);
}

/**
 * Get network configuration
 */
export function getNetworkConfig(network: 'TESTNET' | 'MAINNET') {
  return NETWORKS[network];
}
