# Data schema

Edit these files directly in the repo:

- `cards.json`: card reward rules, point values, aliases
- `merchants.json`: merchant names, categories, aliases for fuzzy search
- `deals.json`: active cashback or statement-credit deals

## Card reward math

`multiplier * pointValueCents = effective percent`.

Example: `4x * 1.5 cents = 6%`.

## Deal types

```json
{
  "type": "statement_credit",
  "minSpend": 50,
  "discountAmount": 10
}
```

```json
{
  "type": "cashback_percent",
  "cashbackPercent": 10,
  "maxBenefit": 25,
  "onlineOnly": true
}
```

Flat cashback offers without visible minimum spend are stored as statement credits:

```json
{
  "type": "statement_credit",
  "discountAmount": 30,
  "maxBenefit": 30
}
```

```json
{
  "type": "bonus_multiplier",
  "extraMultiplier": 2
}
```
