const DATA_FILES = {
  cards: './data/cards.json',
  merchants: './data/merchants.json',
  deals: './data/deals.json',
};

const LOCAL_DEALS_KEY = 'card-rewards-pwa.local-deals.v1';

const CATEGORY_LABELS = {
  default: 'Everything else',
  restaurant: 'Restaurants / dining',
  grocery: 'Grocery',
  gas: 'Gas',
  travel: 'Travel',
  drugstore: 'Drugstore',
  wholesale: 'Wholesale club',
  online: 'Online shopping',
  retail: 'Retail',
  electronics: 'Electronics',
  rideshare: 'Rideshare',
  transit: 'Transit',
};

const state = {
  cards: [],
  merchants: [],
  baseDeals: [],
  localDeals: [],
  parsedBulkDeals: [],
  selectedMerchant: null,
};

const dom = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindDom();
  bindEvents();
  registerServiceWorker();

  try {
    const [cards, merchants, deals] = await Promise.all([
      fetchJson(DATA_FILES.cards),
      fetchJson(DATA_FILES.merchants),
      fetchJson(DATA_FILES.deals),
    ]);

    state.cards = cards;
    state.merchants = merchants;
    state.baseDeals = deals;
    state.localDeals = loadLocalDeals();

    hydrateControls();
    renderDataStatus();
    renderLocalDeals();
    updateRecommendation();
  } catch (error) {
    dom.dataStatus.textContent = `Data load failed: ${error.message}`;
    dom.dataStatus.className = 'status-pill error';
  }
}

function bindDom() {
  dom.dataStatus = document.querySelector('#data-status');
  dom.merchantInput = document.querySelector('#merchant-input');
  dom.amountInput = document.querySelector('#amount-input');
  dom.categorySelect = document.querySelector('#category-select');
  dom.suggestions = document.querySelector('#merchant-suggestions');
  dom.summary = document.querySelector('#recommendation-summary');
  dom.results = document.querySelector('#recommendation-results');
  dom.screenshotInput = document.querySelector('#screenshot-input');
  dom.ocrStatus = document.querySelector('#ocr-status');
  dom.offerText = document.querySelector('#offer-text');
  dom.parseOffer = document.querySelector('#parse-offer');
  dom.clearOffer = document.querySelector('#clear-offer');
  dom.bulkOfferPreview = document.querySelector('#bulk-offer-preview');
  dom.dealForm = document.querySelector('#deal-form');
  dom.dealCard = document.querySelector('#deal-card');
  dom.dealMerchant = document.querySelector('#deal-merchant');
  dom.merchantOptions = document.querySelector('#merchant-options');
  dom.dealTitle = document.querySelector('#deal-title');
  dom.dealType = document.querySelector('#deal-type');
  dom.dealMinSpend = document.querySelector('#deal-min-spend');
  dom.dealDiscount = document.querySelector('#deal-discount');
  dom.dealPercent = document.querySelector('#deal-percent');
  dom.dealMaxBenefit = document.querySelector('#deal-max-benefit');
  dom.dealExtraMultiplier = document.querySelector('#deal-extra-multiplier');
  dom.dealExpires = document.querySelector('#deal-expires');
  dom.dealActivated = document.querySelector('#deal-activated');
  dom.resetDealForm = document.querySelector('#reset-deal-form');
  dom.downloadDeals = document.querySelector('#download-deals');
  dom.copyDeals = document.querySelector('#copy-deals');
  dom.clearLocalDeals = document.querySelector('#clear-local-deals');
  dom.localDeals = document.querySelector('#local-deals');
}

function bindEvents() {
  dom.merchantInput.addEventListener('input', () => {
    state.selectedMerchant = null;
    updateRecommendation();
  });
  dom.amountInput.addEventListener('input', updateRecommendation);
  dom.categorySelect.addEventListener('change', updateRecommendation);

  dom.suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-merchant-id]');
    if (!button) return;

    const merchant = state.merchants.find((item) => item.id === button.dataset.merchantId);
    if (!merchant) return;

    state.selectedMerchant = merchant;
    dom.merchantInput.value = merchant.name;
    updateRecommendation();
  });

  dom.screenshotInput.addEventListener('change', handleScreenshot);
  dom.parseOffer.addEventListener('click', parseOfferIntoForm);
  dom.clearOffer.addEventListener('click', () => {
    dom.offerText.value = '';
    clearBulkOfferPreview();
    dom.ocrStatus.textContent = 'Offer text cleared.';
  });
  dom.bulkOfferPreview.addEventListener('click', (event) => {
    const saveButton = event.target.closest('#save-bulk-offers');
    if (saveButton) {
      saveParsedBulkDeals();
      return;
    }

    const useButton = event.target.closest('[data-use-parsed-deal]');
    if (!useButton) return;

    const deal = state.parsedBulkDeals[Number(useButton.dataset.useParsedDeal)];
    if (deal) fillDealForm(deal);
  });

  dom.dealForm.addEventListener('submit', saveDealFromForm);
  dom.resetDealForm.addEventListener('click', resetDealForm);
  dom.downloadDeals.addEventListener('click', () => downloadJson('deals.json', getAllDeals()));
  dom.copyDeals.addEventListener('click', copyDealsJson);
  dom.clearLocalDeals.addEventListener('click', clearLocalDeals);

  dom.localDeals.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-deal]');
    if (!button) return;
    state.localDeals = state.localDeals.filter((deal) => deal.id !== button.dataset.deleteDeal);
    persistLocalDeals();
    renderDataStatus();
    renderLocalDeals();
    updateRecommendation();
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) {
    return;
  }

  navigator.serviceWorker.register('./service-worker.js').catch(() => {
    // Offline support is helpful but not required for core app behavior.
  });
}

function hydrateControls() {
  const categories = new Set(['restaurant', 'grocery', 'gas', 'travel', 'drugstore', 'wholesale', 'online', 'retail', 'electronics']);

  for (const merchant of state.merchants) {
    categories.add(merchant.category);
  }

  for (const card of state.cards) {
    for (const reward of card.rewards || []) {
      categories.add(reward.category);
    }
  }

  dom.categorySelect.innerHTML = '<option value="">Use merchant match</option>';
  for (const category of [...categories].filter(Boolean).sort()) {
    if (category === 'default') continue;
    dom.categorySelect.insertAdjacentHTML(
      'beforeend',
      `<option value="${escapeHtml(category)}">${escapeHtml(labelForCategory(category))}</option>`,
    );
  }

  dom.dealCard.innerHTML = state.cards
    .map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)}</option>`)
    .join('');

  dom.merchantOptions.innerHTML = state.merchants
    .map((merchant) => `<option value="${escapeHtml(merchant.name)}"></option>`)
    .join('');
}

function updateRecommendation() {
  if (!state.cards.length) return;

  const query = dom.merchantInput.value;
  const amount = parseMoney(dom.amountInput.value);
  const matches = searchMerchants(query).slice(0, 5);
  const merchant = resolveMerchant(query, matches);
  const category = merchant?.category || dom.categorySelect.value || (query.trim() ? 'default' : '');

  renderSuggestions(matches, query);

  if (!category) {
    dom.summary.innerHTML = 'Type a merchant or choose a fallback category to compare cards.';
    dom.results.innerHTML = '';
    return;
  }

  const recommendations = rankCards({ merchant, category, amount, query });
  renderSummary({ merchant, category, amount, query });
  renderRecommendations(recommendations, amount);
}

function resolveMerchant(query, matches) {
  if (state.selectedMerchant && merchantTextMatches(query, state.selectedMerchant)) {
    return state.selectedMerchant;
  }

  const best = matches[0];
  if (best && best.score >= 72) {
    return best.merchant;
  }

  return null;
}

function renderSuggestions(matches, query) {
  if (!query.trim() || !matches.length) {
    dom.suggestions.innerHTML = '';
    return;
  }

  dom.suggestions.innerHTML = matches
    .map(({ merchant, score }) => `
      <button class="suggestion" type="button" data-merchant-id="${escapeHtml(merchant.id)}">
        <strong>${escapeHtml(merchant.name)}</strong>
        <span>${escapeHtml(labelForCategory(merchant.category))}</span>
        <span>${score}%</span>
      </button>
    `)
    .join('');
}

function renderSummary({ merchant, category, amount, query }) {
  const merchantText = merchant
    ? `${merchant.name} (${labelForCategory(merchant.category)})`
    : `${query.trim() || 'Unknown merchant'} (${labelForCategory(category)})`;
  const amountText = amount ? ` for ${formatCurrency(amount)}` : '';

  dom.summary.innerHTML = `
    Comparing cards for <strong>${escapeHtml(merchantText)}</strong>${escapeHtml(amountText)}.
    ${merchant ? '' : ' Merchant was not confidently matched; fallback category is being used.'}
  `;
}

function renderRecommendations(recommendations, amount) {
  dom.results.innerHTML = recommendations
    .map((result, index) => {
      const rewardNotes = result.reward?.notes ? `<div class="meta">${escapeHtml(result.reward.notes)}</div>` : '';
      const capNotes = result.reward?.cap
        ? `<div class="meta">Cap: ${escapeHtml(formatCap(result.reward.cap))}</div>`
        : '';
      const dealList = result.dealBreakdown.length
        ? `<ul class="deal-list">${result.dealBreakdown.map((deal) => `<li>${escapeHtml(deal)}</li>`).join('')}</ul>`
        : '<div class="meta">No matching active deal found.</div>';
      const valueText = amount
        ? `${formatPercent(result.effectivePercent)} / ${formatCurrency(result.totalValue)}`
        : `${formatPercent(result.rankPercent)} value`;

      return `
        <article class="result-card ${index === 0 ? 'best' : ''}">
          <div class="result-topline">
            <div class="result-title">
              <h3>${index === 0 ? 'Best: ' : ''}${escapeHtml(result.card.name)}</h3>
              <div class="meta">${escapeHtml(result.card.issuer || '')} ${escapeHtml(result.card.pointCurrency || '')}</div>
            </div>
            <div class="score">${escapeHtml(valueText)}</div>
          </div>
          <div>
            Base reward: <strong>${escapeHtml(formatMultiplier(result.reward?.multiplier || 0))}</strong>
            x ${escapeHtml(formatPointValue(result.card.pointValueCents))}
            = <strong>${escapeHtml(formatPercent(result.basePercent))}</strong>
          </div>
          ${rewardNotes}
          ${capNotes}
          ${dealList}
        </article>
      `;
    })
    .join('');
}

function rankCards({ merchant, category, amount, query }) {
  const activeDeals = getAllDeals().filter(isDealCurrentlyActive);

  return state.cards
    .map((card) => {
      const reward = getRewardForCategory(card, category);
      const basePercent = (reward?.multiplier || 0) * (card.pointValueCents || 1);
      const baseValue = amount ? (amount * basePercent) / 100 : 0;
      const matchingDeals = activeDeals.filter((deal) => (
        dealMatchesCard(deal, card) && dealMatchesMerchantOrCategory(deal, merchant, category, query)
      ));
      const dealValues = matchingDeals.map((deal) => computeDealValue(deal, amount, card));
      const dealValue = dealValues.reduce((total, deal) => total + deal.value, 0);
      const dealPercent = dealValues.reduce((total, deal) => total + deal.percentEquivalent, 0);
      const totalValue = baseValue + dealValue;
      const effectivePercent = amount ? (totalValue / amount) * 100 : basePercent + dealPercent;

      return {
        card,
        reward,
        basePercent,
        totalValue,
        effectivePercent,
        rankPercent: effectivePercent,
        dealBreakdown: dealValues.map((deal) => deal.label),
      };
    })
    .sort((a, b) => b.rankPercent - a.rankPercent || b.totalValue - a.totalValue);
}

function getRewardForCategory(card, category) {
  return (
    card.rewards?.find((reward) => reward.category === category)
    || card.rewards?.find((reward) => reward.category === 'default')
    || { category: 'default', multiplier: 0 }
  );
}

function isDealCurrentlyActive(deal) {
  if (deal.activated === false) return false;
  if (!deal.expires) return true;

  const expires = new Date(`${deal.expires}T23:59:59`);
  return Number.isNaN(expires.getTime()) || expires >= new Date();
}

function dealMatchesCard(deal, card) {
  return !deal.cardId || deal.cardId === card.id;
}

function dealMatchesMerchantOrCategory(deal, merchant, category, query) {
  if (deal.category && deal.category === category) return true;
  if (merchant && deal.merchantId && deal.merchantId === merchant.id) return true;

  const searchText = normalizeText([query, merchant?.name, ...(merchant?.aliases || [])].filter(Boolean).join(' '));
  const dealTerms = [deal.merchantName, ...(deal.merchantAliases || [])].filter(Boolean).map(normalizeText);

  if (!searchText) return false;

  return dealTerms.some((term) => term && (searchText.includes(term) || term.includes(searchText)));
}

function computeDealValue(deal, amount, card) {
  const minSpend = Number(deal.minSpend || 0);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const title = deal.title || deal.merchantName || 'Deal';

  if (!hasAmount) {
    if (deal.type === 'cashback_percent' && deal.cashbackPercent) {
      return {
        value: 0,
        percentEquivalent: Number(deal.cashbackPercent),
        label: `${title}: ${formatPercent(Number(deal.cashbackPercent))} cashback${deal.maxBenefit ? `, max ${formatCurrency(deal.maxBenefit)}` : ''}`,
      };
    }

    if (deal.type === 'bonus_multiplier' && deal.extraMultiplier) {
      const percent = Number(deal.extraMultiplier) * (card.pointValueCents || 1);
      return {
        value: 0,
        percentEquivalent: percent,
        label: `${title}: +${formatMultiplier(deal.extraMultiplier)} = ${formatPercent(percent)} extra value`,
      };
    }

    return {
      value: 0,
      percentEquivalent: 0,
      label: `${title}: enter amount to value this fixed offer`,
    };
  }

  if (amount < minSpend) {
    return {
      value: 0,
      percentEquivalent: 0,
      label: `${title}: needs ${formatCurrency(minSpend - amount)} more spend`,
    };
  }

  if (deal.type === 'cashback_percent') {
    const rawValue = (amount * Number(deal.cashbackPercent || 0)) / 100;
    const value = deal.maxBenefit ? Math.min(rawValue, Number(deal.maxBenefit)) : rawValue;
    return {
      value,
      percentEquivalent: (value / amount) * 100,
      label: `${title}: ${formatCurrency(value)} cashback value`,
    };
  }

  if (deal.type === 'bonus_multiplier') {
    const extraPercent = Number(deal.extraMultiplier || 0) * (card.pointValueCents || 1);
    const value = (amount * extraPercent) / 100;
    return {
      value,
      percentEquivalent: extraPercent,
      label: `${title}: ${formatCurrency(value)} extra points value`,
    };
  }

  const value = Math.min(Number(deal.discountAmount || 0), amount);
  return {
    value,
    percentEquivalent: (value / amount) * 100,
    label: `${title}: ${formatCurrency(value)} statement credit value`,
  };
}

function searchMerchants(query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  return state.merchants
    .map((merchant) => ({ merchant, score: scoreMerchant(normalizedQuery, merchant) }))
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score || a.merchant.name.localeCompare(b.merchant.name));
}

function scoreMerchant(normalizedQuery, merchant) {
  const terms = [merchant.name, ...(merchant.aliases || [])].map(normalizeText).filter(Boolean);
  const queryInitials = initials(normalizedQuery);
  let best = 0;

  for (const term of terms) {
    if (term === normalizedQuery) best = Math.max(best, 100);
    if (term.startsWith(normalizedQuery)) best = Math.max(best, 92 - Math.min(term.length - normalizedQuery.length, 20));
    if (term.includes(normalizedQuery)) best = Math.max(best, 82 - Math.min(term.indexOf(normalizedQuery), 20));
    if (initials(term).startsWith(normalizedQuery) || queryInitials === term) best = Math.max(best, 76);
    if (isSubsequence(normalizedQuery, term)) best = Math.max(best, 58 + Math.min(normalizedQuery.length * 2, 16));

    if (normalizedQuery.length >= 4) {
      best = Math.max(best, Math.round(similarity(normalizedQuery, term) * 78));
    }
  }

  return Math.min(100, Math.max(0, best));
}

function merchantTextMatches(query, merchant) {
  if (!query.trim()) return false;
  return scoreMerchant(normalizeText(query), merchant) >= 82;
}

async function handleScreenshot() {
  const file = dom.screenshotInput.files?.[0];
  if (!file) return;

  if (!('TextDetector' in window) || !('createImageBitmap' in window)) {
    dom.ocrStatus.textContent = 'This browser does not expose built-in OCR. Paste the offer text manually.';
    return;
  }

  try {
    dom.ocrStatus.textContent = 'Reading screenshot with browser OCR...';
    const bitmap = await createImageBitmap(file);
    const detector = new window.TextDetector();
    const detected = await detector.detect(bitmap);
    const text = detected.map((item) => item.rawValue).filter(Boolean).join('\n');

    if (!text.trim()) {
      dom.ocrStatus.textContent = 'OCR did not find text. Paste the offer text manually.';
      return;
    }

    dom.offerText.value = [dom.offerText.value, text].filter(Boolean).join('\n\n');
    dom.ocrStatus.textContent = `OCR found ${detected.length} text block${detected.length === 1 ? '' : 's'}. Review before saving.`;
    parseOfferIntoForm();
  } catch (error) {
    dom.ocrStatus.textContent = `OCR failed: ${error.message}. Paste the offer text manually.`;
  }
}

function parseOfferIntoForm() {
  const text = dom.offerText.value.trim();
  if (!text) {
    dom.ocrStatus.textContent = 'Paste offer text first.';
    return;
  }

  const parsedDeals = parseOffersFromText(text);
  if (!parsedDeals.length) {
    clearBulkOfferPreview();
    dom.ocrStatus.textContent = 'No offers found. Try a cropped screenshot or paste the offer text manually.';
    return;
  }

  fillDealForm(parsedDeals[0]);

  if (parsedDeals.length > 1) {
    state.parsedBulkDeals = parsedDeals;
    renderBulkOfferPreview();
    dom.ocrStatus.textContent = `Parsed ${parsedDeals.length} offers. Review them before saving all locally.`;
    return;
  }

  clearBulkOfferPreview();
  dom.ocrStatus.textContent = 'Parsed best-effort fields. Review every value before saving.';
}

function parseOffersFromText(text, options = {}) {
  const chaseOffers = parseChaseOffersText(text, options);
  if (chaseOffers.length) return chaseOffers;

  const parsed = parseOfferText(text, options);
  return parsed.title || parsed.merchantName ? [parsed] : [];
}

function parseChaseOffersText(text, options = {}) {
  if (!looksLikeCashbackList(text)) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const card = findCardInText(text) || state.cards[0];
  const activated = lines.some((line) => /^added$/i.test(line));
  const offers = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cashback = parseCashbackLine(lines[index]);
    if (!cashback) continue;

    const merchantName = findRewardMerchantLine(lines, index);
    if (!merchantName || isNonMerchantLine(merchantName)) continue;

    const merchant = findMerchantByName(merchantName);
    const daysLeft = (lines[index + 1] || '').match(/^(\d+)\s*d(?:ays?)?\s*left$/i);
    const expires = daysLeft ? daysLeftToIso(daysLeft[1], options.baseDate) : '';

    const common = {
      cardId: card?.id || '',
      merchantId: merchant?.id || '',
      merchantName: merchant?.name || merchantName,
      merchantAliases: merchant?.aliases || [],
      minSpend: '',
      maxBenefit: '',
      extraMultiplier: '',
      expires,
      activated,
      onlineOnly: lines.slice(Math.max(0, index - 2), index).some(isOnlineOnlyLine),
      source: 'chase-offers-paste',
    };

    if (cashback.kind === 'percent') {
      offers.push({
        ...common,
        title: `${cashback.value}% cash back at ${merchant?.name || merchantName}`,
        type: 'cashback_percent',
        discountAmount: '',
        cashbackPercent: cashback.value,
      });
    } else {
      offers.push({
        ...common,
        title: `$${cashback.value} cash back at ${merchant?.name || merchantName}`,
        type: 'statement_credit',
        discountAmount: cashback.value,
        cashbackPercent: '',
        maxBenefit: cashback.value,
      });
    }
  }

  return offers;
}

function looksLikeCashbackList(text) {
  return /(?:\d+(?:\.\d+)?\s*%|\$\s*[\d,.]+)\s*cash\s*back/i.test(text) && /\d+\s*d(?:ays?)?\s*left/i.test(text);
}

function parseCashbackLine(line) {
  const percent = String(line).match(/^(\d+(?:\.\d+)?)\s*%\s*cash\s*back$/i);
  if (percent) return { kind: 'percent', value: cleanNumber(percent[1]) };

  const flat = String(line).match(/^\$?\s*([\d,.]+)\s*cash\s*back$/i);
  if (flat) return { kind: 'flat', value: cleanNumber(flat[1]) };

  return null;
}

function findRewardMerchantLine(lines, rewardLineIndex) {
  for (let index = rewardLineIndex - 1; index >= Math.max(0, rewardLineIndex - 5); index -= 1) {
    const line = lines[index];
    if (!isNonMerchantLine(line)) return line;
  }

  return '';
}

function isOnlineOnlyLine(line) {
  return /^use\s+online\s+only$/i.test(line);
}

function isNonMerchantLine(line) {
  return /^(added|redeemed|expiring soon|expired|home|offers wallet|chase shopping|more|choose account|total amount saved|use online only)$/i.test(line)
    || /^use only at\b/i.test(line)
    || /^skip\b/i.test(line)
    || /^sign out$/i.test(line)
    || /^\$[\d,.]+$/.test(line)
    || /^\d+d(?:ays?)?\s*left$/i.test(line)
    || parseCashbackLine(line) !== null;
}

function renderBulkOfferPreview() {
  if (!state.parsedBulkDeals.length) {
    dom.bulkOfferPreview.innerHTML = '';
    return;
  }

  dom.bulkOfferPreview.innerHTML = `
    <div class="bulk-card">
      <strong>Parsed ${state.parsedBulkDeals.length} offers</strong>
      <ul>
        ${state.parsedBulkDeals.map((deal, index) => `
          <li>
            ${escapeHtml(deal.title)}
            ${deal.onlineOnly ? ' · online only' : ''}
            ${deal.expires ? ` · expires ${escapeHtml(deal.expires)}` : ''}
            · ${escapeHtml(cardName(deal.cardId))}
            <button class="mini-button" type="button" data-use-parsed-deal="${index}">Edit</button>
          </li>
        `).join('')}
      </ul>
      <button class="button" id="save-bulk-offers" type="button">Save all parsed offers locally</button>
    </div>
  `;
}

function clearBulkOfferPreview() {
  state.parsedBulkDeals = [];
  dom.bulkOfferPreview.innerHTML = '';
}

function saveParsedBulkDeals() {
  if (!state.parsedBulkDeals.length) return;

  saveDealsLocally(state.parsedBulkDeals);
  const count = state.parsedBulkDeals.length;
  clearBulkOfferPreview();
  dom.ocrStatus.textContent = `Saved ${count} parsed offers locally. Download or copy deals.json when ready to commit.`;
}

function parseOfferText(text, options = {}) {
  const compact = text.replace(/\s+/g, ' ');
  const merchant = findMerchantInText(text);
  const card = findCardInText(text);
  const spendGet = compact.match(/spend\s*\$?\s*([\d,.]+).{0,100}?(?:get|receive|earn)\s*\$?\s*([\d,.]+)/i);
  const percent = compact.match(/(\d+(?:\.\d+)?)\s*%\s*(?:cash\s*back|cashback|back)/i);
  const flatCashback = compact.match(/(?:^|\s)\$?\s*([\d,.]+)\s*cash\s*back(?:\s|$)/i);
  const upTo = compact.match(/up\s*to\s*\$?\s*([\d,.]+)/i);
  const expiry = extractExpiryDate(compact, options.baseDate);
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);

  const parsed = {
    cardId: card?.id || state.cards[0]?.id || '',
    merchantName: merchant?.name || '',
    merchantId: merchant?.id || '',
    title: firstLine || 'Card-linked offer',
    type: 'statement_credit',
    minSpend: '',
    discountAmount: '',
    cashbackPercent: '',
    maxBenefit: '',
    extraMultiplier: '',
    expires: expiry || '',
    activated: true,
  };

  if (spendGet) {
    parsed.type = 'statement_credit';
    parsed.minSpend = cleanNumber(spendGet[1]);
    parsed.discountAmount = cleanNumber(spendGet[2]);
    parsed.title = `Spend ${formatCurrency(parsed.minSpend)}, get ${formatCurrency(parsed.discountAmount)} back`;
  } else if (percent) {
    parsed.type = 'cashback_percent';
    parsed.cashbackPercent = cleanNumber(percent[1]);
    parsed.maxBenefit = upTo ? cleanNumber(upTo[1]) : '';
    parsed.title = `${parsed.cashbackPercent}% back${parsed.maxBenefit ? `, up to ${formatCurrency(parsed.maxBenefit)}` : ''}`;
  } else if (flatCashback) {
    parsed.type = 'statement_credit';
    parsed.discountAmount = cleanNumber(flatCashback[1]);
    parsed.maxBenefit = cleanNumber(flatCashback[1]);
    parsed.title = `${formatCurrency(parsed.discountAmount)} cash back`;
  }

  return parsed;
}

function fillDealForm(deal) {
  dom.dealCard.value = deal.cardId || state.cards[0]?.id || '';
  dom.dealMerchant.value = deal.merchantName || '';
  dom.dealTitle.value = deal.title || '';
  dom.dealType.value = deal.type || 'statement_credit';
  dom.dealMinSpend.value = deal.minSpend || '';
  dom.dealDiscount.value = deal.discountAmount || '';
  dom.dealPercent.value = deal.cashbackPercent || '';
  dom.dealMaxBenefit.value = deal.maxBenefit || '';
  dom.dealExtraMultiplier.value = deal.extraMultiplier || '';
  dom.dealExpires.value = deal.expires || '';
  dom.dealActivated.checked = deal.activated !== false;
}

function saveDealFromForm(event) {
  event.preventDefault();

  const merchant = findMerchantByName(dom.dealMerchant.value);
  const title = dom.dealTitle.value.trim();
  const deal = normalizeDealForStorage({
    cardId: dom.dealCard.value,
    merchantId: merchant?.id || '',
    merchantName: merchant?.name || dom.dealMerchant.value.trim(),
    merchantAliases: merchant?.aliases || [],
    title,
    type: dom.dealType.value,
    minSpend: numberOrNull(dom.dealMinSpend.value),
    discountAmount: numberOrNull(dom.dealDiscount.value),
    cashbackPercent: numberOrNull(dom.dealPercent.value),
    maxBenefit: numberOrNull(dom.dealMaxBenefit.value),
    extraMultiplier: numberOrNull(dom.dealExtraMultiplier.value),
    expires: dom.dealExpires.value,
    activated: dom.dealActivated.checked,
    source: 'local-import',
  });

  saveDealsLocally([deal]);
  dom.ocrStatus.textContent = 'Deal saved locally. Download or copy deals.json when you are ready to commit it.';
}

function normalizeDealForStorage(deal) {
  const merchant = deal.merchantId
    ? state.merchants.find((item) => item.id === deal.merchantId)
    : findMerchantByName(deal.merchantName);
  const merchantName = merchant?.name || String(deal.merchantName || '').trim();

  return {
    id: deal.id || makeDealId(
      deal.cardId,
      merchantName,
      deal.expires,
      deal.title,
      deal.type,
      deal.minSpend,
      deal.discountAmount,
      deal.cashbackPercent,
      deal.maxBenefit,
      deal.extraMultiplier,
    ),
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
    source: deal.source || 'local-import',
    updatedAt: new Date().toISOString(),
  };
}

function saveDealsLocally(deals) {
  const byId = new Map(state.localDeals.map((deal) => [deal.id, deal]));
  for (const deal of deals.map(normalizeDealForStorage)) {
    byId.set(deal.id, deal);
  }

  state.localDeals = [...byId.values()];
  persistLocalDeals();
  renderDataStatus();
  renderLocalDeals();
  updateRecommendation();
}

function resetDealForm() {
  dom.dealForm.reset();
  dom.dealActivated.checked = true;
  if (state.cards[0]) dom.dealCard.value = state.cards[0].id;
}

function loadLocalDeals() {
  try {
    const value = localStorage.getItem(LOCAL_DEALS_KEY);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function persistLocalDeals() {
  localStorage.setItem(LOCAL_DEALS_KEY, JSON.stringify(state.localDeals, null, 2));
}

function clearLocalDeals() {
  if (!state.localDeals.length) return;
  state.localDeals = [];
  persistLocalDeals();
  renderDataStatus();
  renderLocalDeals();
  updateRecommendation();
}

function getAllDeals() {
  const byId = new Map();
  for (const deal of state.baseDeals) byId.set(deal.id, deal);
  for (const deal of state.localDeals) byId.set(deal.id, deal);
  return [...byId.values()].sort((a, b) => String(a.expires || '').localeCompare(String(b.expires || '')));
}

function renderDataStatus() {
  dom.dataStatus.textContent = `${state.cards.length} cards · ${state.merchants.length} merchants · ${getAllDeals().length} deals`;
  dom.dataStatus.className = 'status-pill ready';
}

function renderLocalDeals() {
  if (!state.localDeals.length) {
    dom.localDeals.innerHTML = '<p class="hint">No local deals yet.</p>';
    return;
  }

  dom.localDeals.innerHTML = state.localDeals
    .map((deal) => `
      <div class="local-deal">
        <div>
          <strong>${escapeHtml(deal.title)}</strong>
          <p>${escapeHtml(deal.merchantName || 'Unknown merchant')} · ${escapeHtml(cardName(deal.cardId))}${deal.onlineOnly ? ' · online only' : ''} · expires ${escapeHtml(deal.expires || 'unknown')}</p>
        </div>
        <button class="mini-button" type="button" data-delete-deal="${escapeHtml(deal.id)}">Delete</button>
      </div>
    `)
    .join('');
}

async function copyDealsJson() {
  const text = JSON.stringify(getAllDeals(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    dom.dataStatus.textContent = 'Copied deals JSON';
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    dom.dataStatus.textContent = 'Copied deals JSON';
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function findMerchantByName(value) {
  const normalized = normalizeText(value);
  return state.merchants.find((merchant) => (
    [merchant.name, ...(merchant.aliases || [])].map(normalizeText).includes(normalized)
  ));
}

function findMerchantInText(text) {
  const normalizedText = normalizeText(text);
  const candidates = [];

  for (const merchant of state.merchants) {
    for (const term of [merchant.name, ...(merchant.aliases || [])].map(normalizeText)) {
      if (term && normalizedText.includes(term)) {
        candidates.push({ merchant, length: term.length });
      }
    }
  }

  return candidates.sort((a, b) => b.length - a.length)[0]?.merchant || null;
}

function findCardInText(text) {
  const normalizedText = normalizeText(text);
  return state.cards.find((card) => (
    [card.name, ...(card.aliases || [])].map(normalizeText).some((term) => term && normalizedText.includes(term))
  ));
}

function extractExpiryDate(text, baseDate) {
  const daysLeft = text.match(/(\d+)\s*d(?:ays?)?\s*left/i);
  if (daysLeft) return daysLeftToIso(daysLeft[1], baseDate);

  const patterns = [
    /(?:expires?|valid\s+through|valid\s+until)\s*(?:on)?\s*([a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?\,?\s+\d{4})/i,
    /(?:expires?|valid\s+through|valid\s+until)\s*(?:on)?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseDateToIso(match[1]);
      if (parsed) return parsed;
    }
  }

  return '';
}

function daysLeftToIso(daysLeft, baseDate = new Date()) {
  const days = Number(daysLeft);
  if (!Number.isFinite(days)) return '';

  const date = new Date(baseDate);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return formatIsoDateLocal(date);
}

function formatIsoDateLocal(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function parseDateToIso(value) {
  const cleaned = value.replace(/(\d)(st|nd|rd|th)/gi, '$1').replace(/\./g, '');
  const slash = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year.padStart(4, '0')}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return '';

  return formatIsoDateLocal(parsed);
}

function makeDealId(...parts) {
  return slugify(parts.filter((part) => part !== null && part !== undefined && part !== '').join('-'));
}

function cardName(cardId) {
  return state.cards.find((card) => card.id === cardId)?.name || cardId || 'Unknown card';
}

function labelForCategory(category) {
  return CATEGORY_LABELS[category] || titleCase(category);
}

function formatCap(cap) {
  if (!cap) return '';
  const amount = cap.amount ? formatCurrency(cap.amount) : '';
  const period = cap.period || '';
  return [amount, period, cap.notes].filter(Boolean).join(' / ');
}

function formatMultiplier(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? `${number}` : number.toFixed(2);
}

function formatPointValue(value) {
  return `${Number(value || 0).toFixed(2).replace(/\.?0+$/, '')} cents/point`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function parseMoney(value) {
  const cleaned = cleanNumber(value);
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function cleanNumber(value) {
  return String(value || '').replace(/[$,\s]/g, '');
}

function numberOrNull(value) {
  const number = Number(cleanNumber(value));
  return Number.isFinite(number) && cleanNumber(value) !== '' ? number : null;
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
  return normalizeText(value).replace(/\s+/g, '-').slice(0, 80) || 'deal';
}

function titleCase(value) {
  return String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function initials(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('');
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - levenshtein(a, b) / maxLength;
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
