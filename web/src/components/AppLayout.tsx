import { Box, Stack } from '@mui/material';
import { NavLink, Outlet } from 'react-router-dom';
import {
  ShowChart, EmojiEvents, AccountBalanceWallet, HelpOutline, AdminPanelSettings,
} from '@mui/icons-material';
import BrandMark from './BrandMark';
import { tokens } from '../theme/theme';
import { useAppSelector } from '../app/store';

const NAV = [
  { to: '/app/trade', label: 'Trade', Icon: ShowChart },
  { to: '/app/top', label: 'Top', Icon: EmojiEvents },
  { to: '/app/wallet', label: 'Wallet', Icon: AccountBalanceWallet },
  { to: '/app/help', label: 'Help', Icon: HelpOutline },
];

/**
 * Shell shared by every signed-in screen: top bar + side navigation, with the
 * routed page filling the rest. Each page owns its whole area rather than
 * floating above the chart, so navigating away actually leaves the chart.
 */
export default function AppLayout() {
  const user = useAppSelector((s) => s.auth.user);
  const items = user?.isAdmin
    ? [...NAV, { to: '/app/admin', label: 'Admin', Icon: AdminPanelSettings }]
    : NAV;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <Box
        component="header"
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, px: 2, height: 56, flex: 'none',
          bgcolor: tokens.panel, borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <BrandMark />
        <Box sx={{ flex: 1 }} />
        <Box sx={{ fontSize: 13, color: tokens.muted }}>{user?.email}</Box>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Stack
          component="nav"
          sx={{
            width: 68, flex: 'none', py: 1, gap: 0.5, alignItems: 'stretch',
            bgcolor: tokens.panel, borderRight: `1px solid ${tokens.border}`,
          }}
        >
          {items.map(({ to, label, Icon }) => (
            <Box
              key={to}
              component={NavLink}
              to={to}
              sx={{
                textDecoration: 'none', color: tokens.muted, textAlign: 'center',
                py: 1.2, mx: 0.75, borderRadius: 2, fontSize: 11, fontWeight: 700,
                '&:hover': { bgcolor: 'rgba(255,255,255,.04)' },
                '&.active': { bgcolor: 'rgba(47,124,246,.14)', color: tokens.accent },
              }}
            >
              <Icon sx={{ display: 'block', mx: 'auto', fontSize: 22 }} />
              {label}
            </Box>
          ))}
        </Stack>

        <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
