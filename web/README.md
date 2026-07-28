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

## Ported so far

- `/app/login` — sign up, log in, forgot password, OTP step, resend cooldown
- `/app/wallet` — balances and transaction history
- `/app/trade`, `/app/top`, `/app/deposit`, `/app/withdraw`, `/app/help`,
  `/app/admin` — placeholders, still served by the vanilla site at `/`

## Notes for the rest of the port

Every route is a real screen; nothing renders as an overlay above the chart.

The trading screen is the one piece that needs care: prices tick twice a
second for 16 assets. Keep that stream out of React state — feed the chart
imperatively through a ref and let only low-frequency values (selected asset,
stake, balances) live in Redux, or the whole tree re-renders 2x/second.
