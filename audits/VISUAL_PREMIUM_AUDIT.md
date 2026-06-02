# Visual Premium Audit - Dashboard

## Scope

Visual-only revision of EMRR 2.0 / Tendencias after Phase 2 Vercel validation.

No financial logic, formulas, scoring, ranking, conviction values, risk values,
momentum values, trailing calculations, APIs, engines, providers, databases or
algorithms were changed.

## Reference Analysis

The supplied references point toward a premium institutional style:

- dark executive dashboard surfaces,
- deep blue/black backgrounds,
- old gold / amber accent lines,
- cleaner information hierarchy,
- investment research tone,
- stronger metric hierarchy,
- less raw technical density.

The references were used only as visual inspiration. No layout was copied.

## Problems Found

- The previous green CTA felt too aggressive and less institutional, but green
  must remain available for positive semantic states.
- TOP 8 cards exposed too many technical fields at the same visual level.
- `RS`, `EMA20`, `EMA50`, `RVOL`, `ATR`, `ATR%` and `Slope` created visual noise
  inside the cards.
- Conviction did not have enough prominence.
- Trailing labels were too technical and could visually collide:
  `trailing_adjusted`, `trailing_medium`, `trailing_wide`.
- The visible UI mixed Spanish and English.
- Card spacing and hierarchy made the dashboard feel more technical than
  commercial.
- TOP 8 grid cards caused long statuses such as `CLOSED_CONTEXT` to overflow or
  collide visually.
- The rank order was less obvious in a four-column card grid than in a vertical
  institutional ranking list.

## Changes Applied

- Rebuilt the CSS theme around deep black, blue-black, anthracite, old gold and
  amber variables.
- Kept old gold / amber as the premium brand layer for surfaces, borders and
  main CTA.
- Preserved semantic colors for data/status meaning:
  - `GREEN_HARD`: very positive,
  - `GREEN_SOFT`: moderately positive,
  - `YELLOW`: neutral / caution,
  - `WHITE_GREY`: technical neutral,
  - `ORANGE`: early deterioration,
  - `RED`: elevated risk.
- Made `SCAN FULL` a larger, premium CTA with old-gold gradient styling.
- Kept `exportar resultados` and `exportar código` exact and secondary.
- Converted visible dashboard labels to English, except the two secondary
  button labels that must remain exact.
- Removed from TOP 8 visual cards only:
  - `RS`
  - `EMA20`
  - `EMA50`
  - `RVOL`
  - `ATR`
  - `ATR%`
  - `Slope`
- Kept internal fields available in mock data/export logic.
- Rebuilt TOP 8 cards as investment cards with priority:
  - Rank
  - Ticker
  - Score
  - Conviction
  - Risk
  - Momentum
  - Trend
  - Trailing
- Increased Conviction prominence.
- Simplified Trend presentation to institutional labels.
- Replaced visual trailing labels with:
  - Tight
  - Medium
  - Wide
- Preserved the three existing trailing values and calculations.
- Added separate visual market state display for Europe and United States in
  the header and System Status mock UI.
- Rebuilt TOP 8 again as a vertical ranking list from 1 to 8.
- Replaced long visual status `CLOSED_CONTEXT` with `CLOSED` while preserving
  the internal action value.
- Added thin analytical meter bars for `Score` and `Conviction`.
- Reduced box-heavy visual density in TOP 8 and moved toward a cleaner
  investment research list.
- Added TOP 8 price percentage change beside price, green for positive and red
  for negative, using mock data only. Future real data must come from EODHD
  first and Finnhub as fallback.
- Refined sector leadership rows so sector name and period percentage share the
  same visual line, with semantic state pills: strong green for `LEADING`, soft
  green for `ACCELERATING`, amber/orange warning for `WEAKENING`, and red for
  `FALLING`.
- Sorted sectors by period percentage descending and changed sector percentage
  color to green for positive values and red for negative values.
- Moved visible currency labels behind TOP 8 prices, including `EUR` rendered
  as `€`.
- Updated the visual system with deeper executive-dashboard panels, indigo/navy
  volume, subtle cyan accents, stronger shadows, and mock vertical bars in
  Master Indicators. These bars are decorative/mock only and do not change any
  financial logic or scoring.
- Removed the visible UTC time block from the main header, leaving only local
  system/browser time. Added a compact mock technical console for EODHD/Finnhub
  status, cache entries, API calls, blocked calls, US/Europe ticker counts and
  total analysed universe.
- Added truncation/wrapping rules to prevent text overlap in ticker names,
  status badges, trend labels, timestamps and trailing values.

## Files Changed

- `src/styles.css`
- `src/components/ActionButtons.tsx`
- `src/components/FearGreedPanel.tsx`
- `src/components/MasterIndicatorsGrid.tsx`
- `src/components/ScanStatusPanel.tsx`
- `src/components/SectorLeaders.tsx`
- `src/components/SystemStatusCards.tsx`
- `src/components/StickyMiniHeader.tsx`
- `src/components/TechnicalHeader.tsx`
- `src/components/Top8Grid.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/utils/export.ts`

## Verification Needed

- Run `npm run build`.
- Deploy or redeploy on Vercel.
- Check desktop layout.
- Check iPhone/mobile layout.
- Confirm TOP 8 has no technical field clutter.
- Confirm trailing labels no longer overlap.
- Confirm `SCAN FULL` remains dominant.
- Confirm Europe and United States market states are visible separately.
- Confirm TOP 8 is rendered as vertical ranking rows, not a card grid.
- Confirm long labels do not overflow or overlap.

## Future Recommendations

- Add lightweight chart/sparkline components only when real data phases allow it.
- Add user timezone display settings in the future `timezoneEngine`.
- Implement real Europe/US market-hours logic by exchange timezone in
  `marketHoursEngine`, including automatic user device/browser date and time.
- Consider a compact/expanded TOP 8 card mode after real users test the UI.
- Consider a small design token file if the palette grows beyond CSS variables.
