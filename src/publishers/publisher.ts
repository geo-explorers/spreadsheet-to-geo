/**
 * Publisher - publish operations to Geo protocol
 *
 * Operations are already in SDK format (Op[]) from the batch-builder,
 * so we just pass them directly to the SDK's publish functions.
 */

import { createPublicClient, http } from 'viem';
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
 * Note: DAO space publishing requires additional parameters:
 * - DAO_SPACE_ADDRESS: The DAO space contract address
 * - CALLER_SPACE_ID: The proposer's personal space ID
 *
 * These should be provided in environment variables.
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

  // DAO space publishing requires additional configuration
  const daoSpaceAddress = process.env.DAO_SPACE_ADDRESS as `0x${string}` | undefined;
  const callerSpaceId = process.env.CALLER_SPACE_ID as `0x${string}` | undefined;

  if (!daoSpaceAddress || !callerSpaceId) {
    return {
      success: false,
      error: 'DAO space publishing requires DAO_SPACE_ADDRESS and CALLER_SPACE_ID environment variables',
    };
  }

  try {
    // Note: SDK currently only supports TESTNET
    const { cid, editId, to, calldata } = await daoSpace.proposeEdit({
      name: `Spreadsheet import - ${new Date().toISOString()}`,
      ops,
      author,
      daoSpaceAddress,
      callerSpaceId,
      daoSpaceId: metadata.spaceId as `0x${string}`,
      network: options.network as Network,
    });

    logger.info('Submitting proposal transaction...');
    const txHash = await walletClient.sendTransaction({
      to,
      data: calldata,
    });

    // Wait for confirmation
    const publicClient = createPublicClient({
      transport: http(NETWORKS[options.network].rpcUrl),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === 'success') {
      logger.success('Proposal created successfully!');
      logger.warn('Note: Proposal requires governance vote to execute');
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
