# Delivery Forecast Studio

Fictional portfolio app: a fixed-seed Monte Carlo forecast of launch date, final cost and delivery risk for a customer-onboarding system replacement. **All data is invented.**

```bash
npm start      # http://localhost:4173
npm test       # model tests (node:test)
```

- `src/model.js` — pure simulation (critical-path engine, cost model, sensitivity)
- `src/app.js` — UI, charts (hand-written SVG), executive brief
- `tests/model.test.mjs` — determinism, joint-probability consistency, contractor/phasing rules, control directions
