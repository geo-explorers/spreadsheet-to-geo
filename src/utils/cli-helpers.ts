/**
 * Shared CLI helper functions used by multiple command handlers (upsert, update, etc.)
 *
 * Extracted from src/commands/upsert.ts to enable reuse across commands.
 */

import * as readline from 'readline';

/**
 * Resolve network from --network flag, GEO_NETWORK env var, or default to TESTNET.
 * Flag takes precedence over env var, env var over default.
 */
export function resolveNetwork(flagValue?: string): 'TESTNET' | 'MAINNET' {
  const network = (flagValue || process.env.GEO_NETWORK || 'TESTNET').toUpperCase();
  if (network !== 'TESTNET' && network !== 'MAINNET') {
    throw new Error(`Invalid network: "${network}". Must be TESTNET or MAINNET.`);
  }
  return network as 'TESTNET' | 'MAINNET';
}

/**
 * Interactive yes/no confirmation prompt using Node.js readline.
 * Throws if stdin is not a TTY (pipe, CI) -- use --yes to skip in those environments.
 */
export async function confirmAction(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation required. Use --yes to skip confirmation in non-interactive environments.');
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}
