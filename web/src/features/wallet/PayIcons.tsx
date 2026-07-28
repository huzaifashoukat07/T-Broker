import { Box } from '@mui/material';

const BINANCE_GOLD = '#F0B90B';
const TRON_RED = '#EF0027';
const TETHER_GREEN = '#26A17B';

/** Official Binance diamond mark. */
export function BinanceIcon({ size = 26 }: { size?: number }) {
  return (
    <Box
      component="svg" viewBox="0 0 126.61 126.61" aria-hidden
      sx={{ width: size, height: size, flex: 'none', fill: BINANCE_GOLD }}
    >
      <path d="M38.73 53.2L63.31 28.62l24.59 24.6 14.3-14.31L63.31 0 24.43 38.9l14.3 14.3zM0 63.31l14.3-14.31 14.31 14.3-14.31 14.31L0 63.31zm38.73 10.11l24.58 24.58 24.59-24.59 14.31 14.29-.01.01-38.89 38.9-38.88-38.87-.02-.02 14.32-14.3zm59.28-10.1l14.3-14.31 14.31 14.3-14.31 14.31-14.3-14.3z" />
      <path d="M77.83 63.3L63.31 48.78 52.58 59.51l-1.23 1.24-2.54 2.54-.2.02.02.02 14.48 14.5 14.52-14.52.01-.01z" />
    </Box>
  );
}

/** Tether mark, ringed in the colour of the network it is sent over. */
export function UsdtIcon({ network, size = 26 }: { network: 'bep20' | 'trc20'; size?: number }) {
  const ring = network === 'bep20' ? BINANCE_GOLD : TRON_RED;
  return (
    <Box
      sx={{
        width: size, height: size, flex: 'none', borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        bgcolor: TETHER_GREEN, border: `2px solid ${ring}`,
        color: '#fff', fontWeight: 800, fontSize: size * 0.55, lineHeight: 1,
      }}
    >
      ₮
    </Box>
  );
}

export function CardIcon({ size = 26 }: { size?: number }) {
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

export function BankIcon({ size = 26 }: { size?: number }) {
  return (
    <Box
      component="svg" viewBox="0 0 24 24" aria-hidden
      sx={{ width: size, height: size, flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }}
    >
      <path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M2 19h20M12 3l9 5H3l9-5z" strokeLinejoin="round" />
    </Box>
  );
}
