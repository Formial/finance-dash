# Formial Finance Dashboard

Monthly Rx counts, COGS, R&D / marketing / other costs and cost trends for Formial Labs Pharmacy.

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and set `MONGODB_URI` (same cluster as the pharmacy dashboard).
3. `npm start`, then open http://localhost:3000 and press **Sync MongoDB**.

`npm run sync` does the same sync from the command line. Restart `npm start` after changing server code.

## Deploy (Vercel)
Set these environment variables for Production, then redeploy:
- `MONGODB_URI` - same as the pharmacy dashboard
- `DASHBOARD_PASSWORD` - the shared password for the page. Without it the API stays locked.

Figures (revenue, notes, ledger, synced numbers) are stored in the `financeDashboard` collection of the same database, so the deployed site and a local run share one set of data.

## Notes
- `lib/formulas.js` and `lib/cogs.js` are copies of the pharmacy dashboard's COGS engine, so synced numbers match its Inventory report. Re-copy them if those formulas change.
- Sync fills Rx counts and COGS; revenue, notes, the manual COGS override and the expense ledger are never overwritten.
