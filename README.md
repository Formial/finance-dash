# Formial Finance Dashboard

Monthly Rx counts, COGS, R&D / marketing / other costs and cost trends for Formial Labs Pharmacy.

## Run
1. `npm install`
2. Copy `.env.example` to `.env` and set `MONGODB_URI` (same cluster as the pharmacy dashboard).
3. `npm start`, then open http://localhost:3000 and press **Sync MongoDB**.

`npm run sync` does the same sync from the command line. Figures are stored in `data.json` (git-ignored).
Without MongoDB the page still works as a manual-entry dashboard.

## Notes
- `lib/formulas.js` and `lib/cogs.js` are copies of the pharmacy dashboard's COGS engine, so synced numbers match its Inventory report. Re-copy them if those formulas change.
- Sync fills Rx counts and COGS; revenue, notes, the manual COGS override and the expense ledger are never overwritten.
