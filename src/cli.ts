/**
 * CLI router - Commander.js subcommand structure for geo-publish
 *
 * Registers subcommands: upsert, delete (stub), update (stub)
 * Each subcommand delegates to its own handler in src/commands/
 */

import { program } from 'commander';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

program
  .name('geo-publish')
  .description('Bulk operations for Geo protocol')
  .version('1.0.0');

// Upsert subcommand
program
  .command('upsert <file>')
  .description('Create or link entities from an Excel spreadsheet')
  .option('-n, --network <network>', 'Network to publish to (TESTNET or MAINNET)')
  .option('--dry-run', 'Validate and preview without publishing', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (file: string, opts: {
    network?: string;
    dryRun: boolean;
    output: string;
    verbose: boolean;
    yes: boolean;
  }) => {
    const { upsertCommand } = await import('./commands/upsert.js');
    await upsertCommand(file, opts);
  });

// Delete subcommand (stub for Phase 2)
const deleteCmd = program
  .command('delete')
  .argument('[file]', 'Path to Excel (.xlsx) file with entity IDs')
  .description('Delete entities listed in an Excel file')
  .option('-n, --network <network>', 'Network to publish to (TESTNET or MAINNET)')
  .option('--dry-run', 'Validate and preview without deleting', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (file?: string) => {
    if (!file) {
      deleteCmd.help();
      return;
    }
    console.error('Delete command is not yet implemented. Coming in Phase 2.');
    process.exit(1);
  });

// Update subcommand (stub for Phase 3)
const updateCmd = program
  .command('update')
  .argument('[file]', 'Path to Excel (.xlsx) file with entity updates')
  .description('Update entity properties from an Excel spreadsheet')
  .option('-n, --network <network>', 'Network to publish to (TESTNET or MAINNET)')
  .option('--dry-run', 'Validate and preview without updating', false)
  .option('-o, --output <dir>', 'Output directory for reports', './reports')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (file?: string) => {
    if (!file) {
      updateCmd.help();
      return;
    }
    console.error('Update command is not yet implemented. Coming in Phase 3.');
    process.exit(1);
  });

program.parse();
