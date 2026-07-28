import { Box, Stack } from '@mui/material';
import { NavLink, Outlet } from 'react-router-dom';
import {
  ShowChart, EmojiEvents, AccountBalanceWallet, HelpOutline, AdminPanelSettings,
} from '@mui/icons-material';
import BrandMark from './BrandMark';
import { tokens } from '../theme/theme';
import { useAppSelector } from '../app/store';

// `external: true` marks a screen still served by the original frontend, so
// it needs a real navigation rather than a client-side route. As each one is
// ported the flag comes off and the link becomes internal.
const NAV = [
  { to: '/trade', label: 'Trade', Icon: ShowChart, external: true },
  { to: '/top', label: 'Top', Icon: EmojiEvents, external: true },
  { to: '/wallet', label: 'Wallet', Icon: AccountBalanceWallet, external: true },
  { to: '/help', label: 'Help', Icon: HelpOutline, external: true },
];

/**
 * Shell shared by every signed-in screen: top bar + side navigation, with the
 * routed page filling the rest. Each page owns its whole area rather than
 * floating above the chart, so navigating away actually leaves the chart.
 */
export default function AppLayout() {
  const user = useAppSelector((s) => s.auth.user);
  const items = user?.isAdmin
    ? [...NAV, { to: '/admin', label: 'Admin', Icon: AdminPanelSettings, external: false }]
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
          {items.map(({ to, label, Icon, external }) => (
            <Box
              key={to}
              {...(external ? { component: 'a' as const, href: to } : { component: NavLink, to })}
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
