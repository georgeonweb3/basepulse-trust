# BasePulse Trust — MVP API

Zero cost to run. Read-only, no gas, no required signups.

## Run locally in Termux
```
pkg install nodejs -y
npm install
npm start
```

Then test from another Termux session or curl:
```
curl http://localhost:3000/score/0xYOUR_ADDRESS_HERE
```

## Optional: better accuracy (still free)
Sign up for a free Etherscan API key at etherscan.io/apis (no cost, no card).
Then set it before starting:
```
export ETHERSCAN_API_KEY=your_key_here
npm start
```
Without this key, wallet age and contract diversity default to 0 — everything
else (tx count, balance, EAS attestations) still works with zero setup.

## Deploy free (same flow you used for the Spark bot)
1. Push this folder to a GitHub repo.
2. Render.com → New Web Service → connect repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add ETHERSCAN_API_KEY as an env var on Render if you want it (optional).
6. Free tier is enough for this — it's just read calls.

## Next step
Wire your existing TrustCard component from BasePulse to fetch
`/score/:address` and render score + breakdown. Score is 0–100, breakdown
returns age/activity/contracts/attestations/balance/notEmpty as separate
point values you can map to the gauge.
