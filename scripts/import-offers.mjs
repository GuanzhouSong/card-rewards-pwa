#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';
import {
  formatDealsTable,
  importDealsFromText,
  summarizeImport,
} from './deal-importer-core.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const pageText = args.input
    ? await fs.readFile(args.input, 'utf8')
    : await readStdin();

  const result = await importDealsFromText({
    repoRoot: args.repoRoot || process.cwd(),
    pageText,
    cardId: args.card,
    baseDate: args.baseDate ? parseBaseDate(args.baseDate) : new Date(),
    assumeActivated: args.assumeActivated !== false,
    write: Boolean(args.write),
    source: 'cli-import',
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${summarizeImport(result)}\n\n`);
    process.stdout.write(`${formatDealsTable(result.deals)}\n`);
    if (result.warnings.length) {
      process.stdout.write(`\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}\n`);
    }
    if (!result.wrote) {
      process.stdout.write('\nPreview only. Re-run with --write to update data/deals.json.\n');
    }
  }
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = { assumeActivated: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--input' || arg === '-i') parsed.input = requireValue(argv, ++index, arg);
    else if (arg === '--repo-root') parsed.repoRoot = requireValue(argv, ++index, arg);
    else if (arg === '--card') parsed.card = requireValue(argv, ++index, arg);
    else if (arg === '--base-date') parsed.baseDate = requireValue(argv, ++index, arg);
    else if (arg === '--write') parsed.write = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--not-activated') parsed.assumeActivated = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function parseBaseDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('--base-date must use YYYY-MM-DD.');
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function printHelp() {
  process.stdout.write(`Import pasted credit-card offer pages into data/deals.json.

Usage:
  node scripts/import-offers.mjs --input /tmp/chase-offers.txt --base-date 2026-07-05
  pbpaste | node scripts/import-offers.mjs --card chase-freedom-flex --write

Options:
  -i, --input <file>       Read pasted page text from a file. Defaults to stdin.
      --repo-root <path>   Repo root containing data/*.json. Defaults to current directory.
      --card <card-id>     Override/inject card id, e.g. chase-freedom-flex.
      --base-date <date>   Date used for "26d left" math, in YYYY-MM-DD.
      --write              Merge extracted offers into data/deals.json.
      --json               Print machine-readable result JSON.
      --not-activated      Mark extracted offers inactive unless page text says activated/added.
`);
}

