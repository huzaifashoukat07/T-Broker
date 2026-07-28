import { Box, Typography } from '@mui/material';
import { useAppSelector } from '../app/store';

/**
 * Placeholder for the trading screen. The chart, asset list and trade panel
 * are the largest and most performance-sensitive part of the port (prices
 * tick twice a second), so they are migrated after the simpler screens.
 */
export default function TradePage() {
  const user = useAppSelector((s) => s.auth.user);
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>
        Welcome back, {user?.name}
      </Typography>
      <Typography color="text.secondary">
        The trading chart is still served by the current site. This screen proves the
        React shell: routing, session restore and the shared layout.
      </Typography>
    </Box>
  );
}
