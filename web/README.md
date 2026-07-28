# NovaTrade — React frontend

React 18 + TypeScript + Redux Toolkit + MUI, built with Vite. It is served at
`/app` by the existing Express server, so the current vanilla site at `/` keeps
running while pages are ported one at a time. Both share the same API and the
same `tb_token` in localStorage.

    npm install
    npm run dev      # localhost:5173, proxies /api and /ws to :3000
    npm run build    # outputs to ../public/app

## Layout

    src/app/        store (Redux Toolkit) + typed hooks, API client
    src/features/   one slice per domain (auth so far)
    src/components/ reusable pieces (AppLayout, RequireAuth, BrandMark)
    src/pages/      one component per route — each is a full screen
    src/theme/      MUI theme built from the existing design tokens

## Routing during the migration

A page moves to React by adding its real path to `REACT_ROUTES` in
`server/index.js`; everything else keeps falling through to the original
frontend. Sign-in has already made that move and owns `/login` outright.
Screens not yet live sit under `/app/*` as a preview.

- `/login` — **live**: sign up, log in, forgot password, OTP, resend cooldown.
  Hands off to `/trade` on the original frontend once authenticated.
- `/admin` — **live**: pending requests, account management, balance
  adjustments, block/unblock, branded notice emails. Counts stay live via the
  server's `admin_refresh` push.
- `/deposit` — **live**: payment-method tiles, amount, first-deposit promo,
  on-chain address with QR and copy, pending-deposit banner
- `/withdraw` — **live**: available balance excluding bonus, per-method address
  validation, 2-per-24h and single-pending limits, bonus-forfeit warning
- `/app/wallet` — preview: balances and transaction history
- `/app/trade`, `/app/top`, `/app/deposit`, `/app/withdraw`, `/app/help` —
  placeholders; the originals still serve these paths

## Notes for the rest of the port

Every route is a real screen; nothing renders as an overlay above the chart.

The trading screen is the one piece that needs care: prices tick twice a
second for 16 assets. Keep that stream out of React state — feed the chart
imperatively through a ref and let only low-frequency values (selected asset,
stake, balances) live in Redux, or the whole tree re-renders 2x/second.
