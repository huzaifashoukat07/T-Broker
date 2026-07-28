import { createTheme } from '@mui/material/styles';

// Design tokens lifted from the existing stylesheet so the React pages are
// visually identical to the vanilla ones during the migration.
export const tokens = {
  bg: '#0b0f19',
  bg2: '#10182a',
  panel: '#141c30',
  panel2: '#1a2440',
  border: '#232f4e',
  text: '#e7ecf5',
  muted: '#8493b3',
  accent: '#2f7cf6',
  up: '#0ecb81',
  down: '#f6465d',
  gold: '#f7b32b',
};

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: tokens.bg, paper: tokens.panel },
    primary: { main: tokens.accent },
    success: { main: tokens.up },
    error: { main: tokens.down },
    warning: { main: tokens.gold },
    text: { primary: tokens.text, secondary: tokens.muted },
    divider: tokens.border,
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    button: { textTransform: 'none', fontWeight: 700 },
  },
  shape: { borderRadius: 10 },
  components: {
    // MUI's defaults are built for light Material surfaces; these overrides
    // pull inputs and buttons back to the trading-panel look.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: tokens.bg2,
          '& fieldset': { borderColor: tokens.border },
          '&:hover fieldset': { borderColor: tokens.border },
          '&.Mui-focused fieldset': { borderColor: tokens.accent },
        },
        input: {
          // Chrome paints saved credentials with its own pale background and
          // near-black text, which is unreadable on a dark form. There is no
          // way to set that background directly, so cover it with an inset
          // shadow and force the text colour. The absurd transition delay
          // stops Chrome animating its colour back in on focus.
          '&:-webkit-autofill, &:-webkit-autofill:hover, &:-webkit-autofill:focus, &:-webkit-autofill:active': {
            WebkitBoxShadow: `0 0 0 100px ${tokens.bg2} inset`,
            WebkitTextFillColor: tokens.text,
            caretColor: tokens.text,
            borderRadius: 'inherit',
            transition: 'background-color 600000s 0s, color 600000s 0s',
          },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        // Keep the floating label legible where it sits over the border
        root: { '&.Mui-focused': { color: tokens.accent } },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10, paddingBlock: 11, fontSize: 15 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', border: `1px solid ${tokens.border}` },
      },
    },
  },
});
