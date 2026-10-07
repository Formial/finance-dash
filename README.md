# Formial Finance Dashboard

Monthly pump counts, cost per pump, COGS and cost trends for Formial Labs Pharmacy.

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
- Total COGS = Rx cost (pump counts x the saved cost per pump: packaging + API) + manual usage (the R&D / marketing / others ledger).
- Sync only fills pump counts (new / refill / foam) from the pharmacy's daily Rx log. Lotion counts, notes, the manual Rx-cost override, cost per pump and the ledger are never overwritten.
