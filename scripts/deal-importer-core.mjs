import fs from 'node:fs/promises';
import path from 'node:path';

export async function importDealsFromText({
  repoRoot = process.cwd(),
  pageText,
  cardId,
  baseDate = new Date(),
  assumeActivated = true,
  write = false,
  source = 'agent-paste',
} = {}) {
  if (!pageText || !String(pageText).trim()) {
    throw new Error('pageText is required.');
  }

  const database = await loadDatabase(repoRoot);
  const parseResult = parseDealsFromText({
    text: pageText,
    cards: database.cards,
    merchants: database.merchants,
    cardId,
    baseDate,
    assumeActivated,
    source,
  });

  const merged = mergeDeals(database.deals, parseResult.deals);

  if (write) {
    await fs.writeFile(database.paths.deals, `${JSON.stringify(merged.deals, null, 2)}\n`);
  }

  return {
    ...parseResult,
    wrote: write,
    dealsPath: database.paths.deals,
    existingCount: database.deals.length,
    finalCount: merged.deals.length,
    addedCount: merged.addedCount,
    updatedCount: merged.updatedCount,
  };
}

export async function loadDatabase(repoRoot = process.cwd()) {
  const paths = {
    cards: path.join(repoRoot, 'data', 'cards.json'),
    merchants: path.join(repoRoot, 'data', 'merchants.json'),
    deals: path.join(repoRoot, 'data', 'deals.json'),
  };

  const [cards, merchants, deals] = await Promise.all([
    readJson(paths.cards),
    readJson(paths.merchants),
    readJson(paths.deals),
  ]);

  return { cards, merchants, deals, paths };
}

export function parseDealsFromText({
  text,
  cards = [],
  merchants = [],
  cardId,
  baseDate = new Date(),
  assumeActivated = true,
  source = 'agent-paste',
} = {}) {
  const warnings = [];
  const lines = cleanLines(text);
  const selectedCard = resolveCard({ text, cards, cardId });
  const activated = inferActivated(lines, assumeActivated);

  if (!selectedCard) {
    warnings.push('Could not infer card. Pass cardId or add card aliases in data/cards.json.');
  }

  const rawDeals = [
    ...parsePercentCashbackOffers({ lines, cards, merchants, selectedCard, baseDate, activated, source }),
    ...parseFlatCashbackOffers({ lines, cards, merchants, selectedCard, baseDate, activated, source }),
    ...parseSpendGetOffers({ text, cards, merchants, selectedCard, baseDate, activated, source }),
  ];
  const deals = dedupeDeals(rawDeals.map((deal) => normalizeDealForStorage(deal, merchants)));

  if (!deals.length) {
    warnings.push('No cashback offers were extracted. Paste visible offer text that includes merchant, reward, and expiry.');
  }

  for (const deal of deals) {
    if (!deal.expires) warnings.push(`${deal.merchantName || deal.title}: no expiration date found.`);
    if (!deal.cardId) warnings.push(`${deal.merchantName || deal.title}: no card assigned.`);
    if (!deal.merchantId) warnings.push(`${deal.merchantName || deal.title}: merchant is not in data/merchants.json; text matching will still work, but aliases/category may be weaker.`);
  }

  return { deals, warnings };
}

export function mergeDeals(existingDeals = [], newDeals = []) {
  const existingIds = new Set(existingDeals.map((deal) => deal.id));
  const byId = new Map(existingDeals.map((deal) => [deal.id, deal]));
  let addedCount = 0;
  let updatedCount = 0;

  for (const deal of newDeals) {
    if (existingIds.has(deal.id)) {
      updatedCount += 1;
    } else {
      addedCount += 1;
    }
    byId.set(deal.id, deal);
  }

  return {
    deals: [...byId.values()].sort(compareDeals),
    addedCount,
    updatedCount,
  };
}

export function formatDealsTable(deals = []) {
  if (!deals.length) return 'No deals extracted.';

  const rows = deals.map((deal) => ({
    Merchant: deal.merchantName || '',
    Card: deal.cardId || '',
    Offer: formatOffer(deal),
    Online: deal.onlineOnly ? 'yes' : 'no',
    Expires: deal.expires || '',
    Active: deal.activated ? 'yes' : 'no',
  }));
  const headers = Object.keys(rows[0]);
  const widths = Object.fromEntries(headers.map((header) => [
    header,
    Math.max(header.length, ...rows.map((row) => String(row[header]).length)),
  ]));

  const headerLine = headers.map((header) => header.padEnd(widths[header])).join(' | ');
  const divider = headers.map((header) => '-'.repeat(widths[header])).join('-|-');
  const body = rows.map((row) => headers.map((header) => String(row[header]).padEnd(widths[header])).join(' | '));

  return [headerLine, divider, ...body].join('\n');
}

export function summarizeImport(result) {
  const action = result.wrote ? 'updated' : 'previewed';
  return [
    `Extracted ${result.deals.length} deal${result.deals.length === 1 ? '' : 's'} and ${action} ${path.relative(process.cwd(), result.dealsPath) || result.dealsPath}.`,
    `Added: ${result.addedCount}; updated: ${result.updatedCount}; final deal count: ${result.finalCount}.`,
  ].join('\n');
}

function parsePercentCashbackOffers({ lines, merchants, selectedCard, baseDate, activated, source }) {
  const offers = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cashbackPercent = extractCashbackPercent(lines[index]);
    if (cashbackPercent === null) continue;

    const merchantLine = findMerchantLine(lines, index);
    if (!merchantLine) continue;

    const merchant = findMerchantByName(merchantLine, merchants);
    const merchantName = merchant?.name || merchantLine;
    const nearbyText = nearbyLines(lines, index, 4).join('\n');

    offers.push({
      cardId: selectedCard?.id || '',
      merchantId: merchant?.id || '',
      merchantName,
      merchantAliases: merchant?.aliases || [],
      title: `${formatNumber(cashbackPercent)}% cash back at ${merchantName}`,
      type: 'cashback_percent',
      cashbackPercent,
      maxBenefit: extractMaxBenefit(nearbyText),
      expires: findExpiryNear(lines, index, baseDate),
      activated,
      onlineOnly: nearbyLines(lines, index, 2).some(isOnlineOnlyLine),
      source,
    });
  }

  return offers;
}

function parseSpendGetOffers({ text, merchants, selectedCard, baseDate, activated, source }) {
  const offers = [];
  const compact = text.replace(/\s+/g, ' ');
  const spendGetPattern = /spend\s*\$?\s*([\d,.]+).{0,100}?(?:get|receive|earn)\s*\$?\s*([\d,.]+).{0,80}?(?:back|statement\s+credit|cash\s+back)/gi;
  let match;

  while ((match = spendGetPattern.exec(compact)) !== null) {
    const block = compact.slice(Math.max(0, match.index - 160), Math.min(compact.length, match.index + 260));
    const merchant = findMerchantInText(block, merchants) || findMerchantInText(text, merchants);
    const merchantName = merchant?.name || extractMerchantAfterAt(block) || '';

    offers.push({
      cardId: selectedCard?.id || '',
      merchantId: merchant?.id || '',
      merchantName,
      merchantAliases: merchant?.aliases || [],
      title: `Spend $${formatNumber(match[1])}, get $${formatNumber(match[2])} back${merchantName ? ` at ${merchantName}` : ''}`,
      type: 'statement_credit',
      minSpend: cleanNumber(match[1]),
      discountAmount: cleanNumber(match[2]),
      maxBenefit: cleanNumber(match[2]),
      expires: extractExpiryDate(block, baseDate) || extractExpiryDate(text, baseDate),
      activated,
      onlineOnly: isOnlineOnlyLine(block),
      source,
    });
  }

  return offers;
}

function parseFlatCashbackOffers({ lines, merchants, selectedCard, baseDate, activated, source }) {
  const offers = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cashbackAmount = extractFlatCashbackAmount(lines[index]);
    if (cashbackAmount === null) continue;

    const merchantLine = findMerchantLine(lines, index);
    if (!merchantLine) continue;

    const merchant = findMerchantByName(merchantLine, merchants);
    const merchantName = merchant?.name || merchantLine;

    offers.push({
      cardId: selectedCard?.id || '',
      merchantId: merchant?.id || '',
      merchantName,
      merchantAliases: merchant?.aliases || [],
      title: `$${formatNumber(cashbackAmount)} cash back at ${merchantName}`,
      type: 'statement_credit',
      minSpend: null,
      discountAmount: cashbackAmount,
      maxBenefit: cashbackAmount,
      expires: findExpiryNear(lines, index, baseDate),
      activated,
      onlineOnly: nearbyLines(lines, index, 2).some(isOnlineOnlyLine),
      source,
    });
  }

  return offers;
}

function normalizeDealForStorage(deal, merchants = []) {
  const merchant = deal.merchantId
    ? merchants.find((item) => item.id === deal.merchantId)
    : findMerchantByName(deal.merchantName, merchants);
  const merchantName = merchant?.name || String(deal.merchantName || '').trim();
  const normalized = {
    cardId: deal.cardId || '',
    merchantId: merchant?.id || deal.merchantId || '',
    merchantName,
    merchantAliases: merchant?.aliases || deal.merchantAliases || [],
    title: String(deal.title || '').trim(),
    type: deal.type || 'statement_credit',
    minSpend: numberOrNull(deal.minSpend),
    discountAmount: numberOrNull(deal.discountAmount),
    cashbackPercent: numberOrNull(deal.cashbackPercent),
    maxBenefit: numberOrNull(deal.maxBenefit),
    extraMultiplier: numberOrNull(deal.extraMultiplier),
    expires: deal.expires || '',
    activated: deal.activated !== false,
    onlineOnly: Boolean(deal.onlineOnly),
    source: deal.source || 'agent-paste',
    updatedAt: new Date().toISOString(),
  };

  return {
    id: makeDealId(
      normalized.cardId,
      normalized.merchantId || normalized.merchantName,
      normalized.type,
      normalized.minSpend,
      normalized.discountAmount,
      normalized.cashbackPercent,
      normalized.maxBenefit,
      normalized.extraMultiplier,
      normalized.expires,
      normalized.onlineOnly ? 'online' : 'store',
    ),
    ...normalized,
  };
}

async function readJson(filePath) {
  const value = await fs.readFile(filePath, 'utf8');
  return JSON.parse(value);
}

function resolveCard({ text, cards, cardId }) {
  if (cardId) {
    const requested = normalizeText(cardId);
    const exact = cards.find((card) => (
      normalizeText(card.id) === requested
      || normalizeText(card.name) === requested
      || (card.aliases || []).map(normalizeText).includes(requested)
    ));
    if (exact) return exact;
  }

  return findCardInText(text, cards);
}

function findCardInText(text, cards = []) {
  const normalizedText = normalizeText(text);
  const candidates = [];

  for (const card of cards) {
    for (const term of [card.id, card.name, ...(card.aliases || [])].map(normalizeText)) {
      if (term && normalizedText.includes(term)) {
        candidates.push({ card, length: term.length });
      }
    }
  }

  return candidates.sort((a, b) => b.length - a.length)[0]?.card || null;
}

function inferActivated(lines, assumeActivated) {
  if (lines.some((line) => /^added$/i.test(line) || /^activated$/i.test(line))) return true;
  if (lines.some((line) => /^expired$/i.test(line))) return false;
  return Boolean(assumeActivated);
}

function cleanLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractCashbackPercent(line) {
  const match = String(line).match(/(\d+(?:\.\d+)?)\s*%\s*(?:cash\s*back|cashback|back)/i);
  return match ? cleanNumber(match[1]) : null;
}

function extractFlatCashbackAmount(line) {
  const match = String(line).match(/^\$?\s*([\d,.]+)\s*cash\s*back$/i);
  return match ? cleanNumber(match[1]) : null;
}

function findMerchantLine(lines, rewardLineIndex) {
  for (let index = rewardLineIndex - 1; index >= Math.max(0, rewardLineIndex - 5); index -= 1) {
    const line = lines[index];
    if (!isNonMerchantLine(line)) return line;
  }

  return '';
}

function nearbyLines(lines, index, radius) {
  return lines.slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1));
}

function findExpiryNear(lines, index, baseDate) {
  for (const line of lines.slice(index, Math.min(lines.length, index + 5))) {
    const expires = extractExpiryDate(line, baseDate);
    if (expires) return expires;
  }

  for (let lineIndex = index - 1; lineIndex >= Math.max(0, index - 2); lineIndex -= 1) {
    const expires = extractExpiryDate(lines[lineIndex], baseDate);
    if (expires) return expires;
  }

  return '';
}

function extractExpiryDate(text, baseDate = new Date()) {
  const daysLeft = String(text).match(/(\d+)\s*d(?:ays?)?\s*left/i);
  if (daysLeft) return daysLeftToIso(daysLeft[1], baseDate);

  const patterns = [
    /(?:expires?|valid\s+through|valid\s+until)\s*(?:on)?\s*([a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?\,?\s+\d{4})/i,
    /(?:expires?|valid\s+through|valid\s+until)\s*(?:on)?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/,
  ];

  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (!match) continue;
    const parsed = parseDateToIso(match[1]);
    if (parsed) return parsed;
  }

  return '';
}

function extractMaxBenefit(text) {
  const match = String(text).match(/(?:up\s*to|max(?:imum)?(?:\s+of)?)\s*\$?\s*([\d,.]+)/i);
  return match ? cleanNumber(match[1]) : null;
}

function extractMerchantAfterAt(text) {
  const match = String(text).match(/\bat\s+([A-Z][A-Za-z0-9&+'. -]{2,80})(?:\.|,| expires?| valid | use |$)/);
  return match ? match[1].trim() : '';
}

function findMerchantByName(value, merchants = []) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  const exact = merchants.find((merchant) => (
    [merchant.name, ...(merchant.aliases || [])].map(normalizeText).includes(normalized)
  ));
  if (exact) return exact;

  return merchants.find((merchant) => (
    [merchant.name, ...(merchant.aliases || [])]
      .map(normalizeText)
      .some((term) => term && (normalized.includes(term) || term.includes(normalized)))
  )) || null;
}

function findMerchantInText(text, merchants = []) {
  const normalizedText = normalizeText(text);
  const candidates = [];

  for (const merchant of merchants) {
    for (const term of [merchant.name, ...(merchant.aliases || [])].map(normalizeText)) {
      if (term && normalizedText.includes(term)) {
        candidates.push({ merchant, length: term.length });
      }
    }
  }

  return candidates.sort((a, b) => b.length - a.length)[0]?.merchant || null;
}

function isOnlineOnlyLine(line) {
  return /use\s+online\s+only/i.test(line);
}

function isNonMerchantLine(line) {
  return /^(added|activated|redeemed|expiring soon|expired|home|offers wallet|chase shopping|more|choose account|total amount saved|use online only)$/i.test(line)
    || /^use only at\b/i.test(line)
    || /^skip\b/i.test(line)
    || /^sign out$/i.test(line)
    || /^accounts$/i.test(line)
    || /^pay & transfer$/i.test(line)
    || /^plan & track$/i.test(line)
    || /^investments$/i.test(line)
    || /^benefits & travel$/i.test(line)
    || /^security & privacy$/i.test(line)
    || /^explore products$/i.test(line)
    || /^chase offers$/i.test(line)
    || /^chase logo$/i.test(line)
    || /^\$[\d,.]+$/.test(line)
    || /^\d+d(?:ays?)?\s*left$/i.test(line)
    || extractCashbackPercent(line) !== null
    || extractFlatCashbackAmount(line) !== null
    || extractExpiryDate(line) !== '';
}

function daysLeftToIso(daysLeft, baseDate = new Date()) {
  const days = Number(daysLeft);
  if (!Number.isFinite(days)) return '';

  const date = new Date(baseDate);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return formatIsoDateLocal(date);
}

function parseDateToIso(value) {
  const cleaned = String(value).replace(/(\d)(st|nd|rd|th)/gi, '$1').replace(/\./g, '');
  const slash = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year.padStart(4, '0')}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return '';

  return formatIsoDateLocal(parsed);
}

function formatIsoDateLocal(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function compareDeals(a, b) {
  return String(a.expires || '').localeCompare(String(b.expires || ''))
    || String(a.cardId || '').localeCompare(String(b.cardId || ''))
    || String(a.merchantName || '').localeCompare(String(b.merchantName || ''));
}

function dedupeDeals(deals) {
  return [...new Map(deals.map((deal) => [deal.id, deal])).values()];
}

function formatOffer(deal) {
  if (deal.type === 'cashback_percent') {
    return `${formatNumber(deal.cashbackPercent)}% cash back${deal.maxBenefit ? `, max $${formatNumber(deal.maxBenefit)}` : ''}`;
  }
  if (deal.type === 'statement_credit') {
    if (deal.minSpend === null || deal.minSpend === undefined || Number(deal.minSpend) === 0) {
      return `$${formatNumber(deal.discountAmount)} cash back`;
    }
    return `Spend $${formatNumber(deal.minSpend)}, get $${formatNumber(deal.discountAmount)} back`;
  }
  if (deal.type === 'bonus_multiplier') {
    return `+${formatNumber(deal.extraMultiplier)}x`;
  }
  return deal.title || deal.type || '';
}

function formatNumber(value) {
  const cleaned = String(cleanNumber(value));
  return cleaned.includes('.') ? cleaned.replace(/\.?0+$/, '') : cleaned;
}

function makeDealId(...parts) {
  return slugify(parts.filter((part) => part !== null && part !== undefined && part !== '').join('-'));
}

function cleanNumber(value) {
  return String(value ?? '').replace(/[$,\s]/g, '');
}

function numberOrNull(value) {
  const cleaned = cleanNumber(value);
  if (cleaned === '') return null;

  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, '-').slice(0, 120) || 'deal';
}
