/**
 * Cancel a DAO proposal by its on-chain proposal ID.
 *
 * Usage:
 *   npx tsx src/cancel-proposal.ts <votingContractAddress> <onchainProposalId>
 *
 * Example:
 *   npx tsx src/cancel-proposal.ts 0xAbCd...1234 42
 *
 * Requires PRIVATE_KEY in .env (same wallet that created the proposal).
 */

import 'dotenv/config';
import { createPublicClient, encodeFunctionData, http } from 'viem';
import { getSmartAccountWalletClient } from '@geoprotocol/geo-sdk';

const CancelProposalAbi = [
  {
    inputs: [{ internalType: 'uint256', name: '_proposalId', type: 'uint256' }],
    name: 'cancelProposal',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const RPC_URL = 'https://rpc-geo-test-zc16z3tcvf.t.conduit.xyz';

async function main() {
  const [votingContract, proposalIdStr] = process.argv.slice(2);

  if (!votingContract || !proposalIdStr) {
    console.error('Usage: npx tsx src/cancel-proposal.ts <votingContractAddress> <onchainProposalId>');
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY not found in .env');
    process.exit(1);
  }

  const proposalId = BigInt(proposalIdStr);
  console.log(`\nCancelling proposal...`);
  console.log(`  Voting contract: ${votingContract}`);
  console.log(`  Proposal ID:     ${proposalId}`);

  const walletClient = await getSmartAccountWalletClient({
    privateKey: privateKey as `0x${string}`,
    rpcUrl: RPC_URL,
  });

  console.log(`  Wallet:          ${walletClient.account.address}`);

  const calldata = encodeFunctionData({
    abi: CancelProposalAbi,
    functionName: 'cancelProposal',
    args: [proposalId],
  });

  console.log('\nSubmitting cancel transaction...');
  const txHash = await walletClient.sendTransaction({
    to: votingContract as `0x${string}`,
    data: calldata,
  });

  console.log(`  TX hash: ${txHash}`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === 'success') {
    console.log('\n  Proposal cancelled successfully!');
  } else {
    console.error('\n  Transaction reverted — are you the proposal creator?');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
