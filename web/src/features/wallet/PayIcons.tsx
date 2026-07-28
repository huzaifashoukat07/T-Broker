import { Box } from '@mui/material';

const BINANCE_GOLD = '#F0B90B';
const BINANCE_DARK = '#181A20';
const TETHER_GREEN = '#26A17B';
const COIN_RIM = '#EDF0F4';
const COIN_RIM_SHADE = '#BFC4CC';

/** The Binance diamond, as its own path so it can be reused at any size. */
const BINANCE_PATH =
  'M38.73 53.2L63.31 28.62l24.59 24.6 14.3-14.31L63.31 0 24.43 38.9l14.3 14.3zM0 63.31l14.3-14.31 '
  + '14.31 14.3-14.31 14.31L0 63.31zm38.73 10.11l24.58 24.58 24.59-24.59 14.31 14.29-.01.01-38.89 '
  + '38.9-38.88-38.87-.02-.02 14.32-14.3zm59.28-10.1l14.3-14.31 14.31 14.3-14.31 14.31-14.3-14.3z';
const BINANCE_INNER =
  'M77.83 63.3L63.31 48.78 52.58 59.51l-1.23 1.24-2.54 2.54-.2.02.02.02 14.48 14.5 14.52-14.52.01-.01z';

export function BinanceIcon({ size = 28 }: { size?: number }) {
  return (
    <Box
      component="svg" viewBox="0 0 126.61 126.61" aria-hidden
      sx={{ width: size, height: size, flex: 'none', fill: BINANCE_GOLD }}
    >
      <path d={BINANCE_PATH} />
      <path d={BINANCE_INNER} />
    </Box>
  );
}

/**
 * Tether coin. The BEP20 variant carries a Binance badge in the corner, the
 * way wallets and exchanges mark which chain a token sits on — drawn rather
 * than bitmapped so it stays sharp at any size.
 */
export function UsdtIcon({ network, size = 28 }: { network: 'bep20' | 'trc20'; size?: number }) {
  const badged = network === 'bep20';
  return (
    <Box
      component="svg" viewBox="0 0 40 40" aria-hidden
      sx={{ width: size, height: size, flex: 'none' }}
    >
      {/* coin: light rim, subtle inner shade, then the green face */}
      <circle cx="18" cy="18" r="17.5" fill={COIN_RIM} />
      <circle cx="18" cy="18" r="16" fill={COIN_RIM_SHADE} />
      <circle cx="18" cy="18" r="15" fill={TETHER_GREEN} />
      {/* the tether mark: crossbar, stem, and the ring through it */}
      <g fill="#fff">
        <rect x="8.4" y="9" width="19.2" height="3.6" rx="0.3" />
        <rect x="16" y="9" width="4" height="17.5" rx="0.3" />
      </g>
      <ellipse
        cx="18" cy="15.6" rx="9" ry="3.1"
        fill="none" stroke="#fff" strokeWidth="1.9"
      />
      {/* re-draw the stem over the ring so the mark reads as one shape */}
      <rect x="16" y="9" width="4" height="17.5" rx="0.3" fill="#fff" />

      {badged && (
        <>
          <circle cx="31.5" cy="31.5" r="8.5" fill={COIN_RIM} />
          <circle cx="31.5" cy="31.5" r="7.4" fill={BINANCE_DARK} />
          <svg x="26.4" y="26.4" width="10.2" height="10.2" viewBox="0 0 126.61 126.61">
            <path d={BINANCE_PATH} fill={BINANCE_GOLD} />
            <path d={BINANCE_INNER} fill={BINANCE_GOLD} />
          </svg>
        </>
      )}
    </Box>
  );
}

export function CardIcon({ size = 28 }: { size?: number }) {
  return (
    <Box
      component="svg" viewBox="0 0 24 24" aria-hidden
      sx={{ width: size, height: size, flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }}
    >
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </Box>
  );
}

export function BankIcon({ size = 28 }: { size?: number }) {
  return (
    <Box
      component="svg" viewBox="0 0 24 24" aria-hidden
      sx={{ width: size, height: size, flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }}
    >
      <path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M2 19h20M12 3l9 5H3l9-5z" strokeLinejoin="round" />
    </Box>
  );
}
