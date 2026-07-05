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
  hooks: {
    onUserPromptSubmitted: async (input) => {
      const prompt = String(input.prompt || '');
      if (!isLikelyOfferPage(prompt)) return;

      const baseDate = formatDate(input.timestamp ? new Date(input.timestamp) : new Date());
      const shouldWrite = shouldWriteOnDetectedPaste(prompt);

      return {
        additionalContext: [
          'The user prompt appears to include pasted credit-card offer webpage text.',
          'Use the cashback_import_deals tool instead of manually extracting offers.',
          `Call cashback_import_deals with baseDate="${baseDate}", assumeActivated=true, and writeToRepo=${shouldWrite ? 'true' : 'false'}.`,
          'Set pageText to the exact pasted offer-page text from the user prompt.',
          'After the tool runs, report the extracted merchant, offer, online-only flag, expiration date, and whether data/deals.json was updated.',
        ].join('\n'),
      };
    },
  },
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

function isLikelyOfferPage(prompt) {
  const text = String(prompt || '');
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  const hasCashbackOffer = /\d+(?:\.\d+)?\s*%\s*(?:cash\s*back|cashback|back)/i.test(text);
  const hasSpendGetOffer = /spend\s*\$?\s*[\d,.]+.{0,120}?(?:get|receive|earn)\s*\$?\s*[\d,.]+/is.test(text);
  const hasExpiry = /\d+\s*d(?:ays?)?\s*left/i.test(text)
    || /(?:expires?|valid\s+through|valid\s+until)/i.test(text);
  const hasOfferSiteMarker = /\b(?:chase offers|amex offers|citi offers|offers wallet|added|activated|redeemed|expiring soon)\b/i.test(text);

  return (hasCashbackOffer || hasSpendGetOffer) && hasExpiry && (hasOfferSiteMarker || lineCount >= 6);
}

function shouldWriteOnDetectedPaste(prompt) {
  const text = String(prompt || '');
  const explicitlyPreview = /\b(?:preview|dry run|do not write|don't write|no write|extract only)\b/i.test(text);
  if (explicitlyPreview) return false;

  const explicitlyWrite = /\b(?:update|import|save|write|merge|commit|database|repo|deals\.json)\b/i.test(text);
  if (explicitlyWrite) return true;

  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  const proseWordCount = text
    .replace(/\d+(?:\.\d+)?\s*%\s*(?:cash\s*back|cashback|back)/gi, '')
    .replace(/\d+\s*d(?:ays?)?\s*left/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .length;

  return lineCount >= 10 && proseWordCount >= 20;
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
