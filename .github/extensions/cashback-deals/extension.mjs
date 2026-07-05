import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinSession } from '@github/copilot-sdk/extension';
import {
  formatDealsTable,
  importDealsFromText,
  summarizeImport,
} from '../../../scripts/deal-importer-core.mjs';

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(extensionDir, '../../..');

const session = await joinSession({
  tools: [
    {
      name: 'cashback_import_deals',
      description: 'Extract cashback/statement-credit offers from pasted full card-offer page text and optionally merge them into data/deals.json. Use this when the user pastes Chase/Amex/Citi offer page text and asks to update the rewards database.',
      parameters: {
        type: 'object',
        properties: {
          pageText: {
            type: 'string',
            description: 'Raw visible text copied from the card offer website/app page.',
          },
          cardId: {
            type: 'string',
            description: 'Optional card id override, e.g. chase-freedom-flex. If omitted, the tool tries to infer the card from pasted text.',
          },
          baseDate: {
            type: 'string',
            description: 'Optional YYYY-MM-DD date for relative expirations like "26d left". Defaults to today.',
          },
          writeToRepo: {
            type: 'boolean',
            description: 'When true, merge extracted offers into data/deals.json. When false, return a preview only.',
          },
          assumeActivated: {
            type: 'boolean',
            description: 'When true, treat pasted offers as activated unless text clearly says otherwise. Defaults to true.',
          },
        },
        required: ['pageText'],
      },
      handler: async (args) => {
        try {
          const result = await importDealsFromText({
            repoRoot,
            pageText: args.pageText,
            cardId: args.cardId,
            baseDate: args.baseDate ? parseBaseDate(args.baseDate) : new Date(),
            write: args.writeToRepo === true,
            assumeActivated: args.assumeActivated !== false,
            source: 'copilot-extension',
          });

          const warnings = result.warnings.length
            ? `\n\nWarnings:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}`
            : '';
          const nextStep = result.wrote
            ? '\n\nThe repo file was updated. Review git diff before committing.'
            : '\n\nPreview only. Call again with writeToRepo=true to update data/deals.json.';

          return `${summarizeImport(result)}\n\n${formatDealsTable(result.deals)}${warnings}${nextStep}`;
        } catch (error) {
          return {
            resultType: 'failure',
            textResultForLlm: `cashback_import_deals failed: ${error.message}`,
          };
        }
      },
    },
  ],
});

await session.log('Cashback deals extension loaded. Tool: cashback_import_deals', { ephemeral: true });

function parseBaseDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('baseDate must use YYYY-MM-DD.');
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

