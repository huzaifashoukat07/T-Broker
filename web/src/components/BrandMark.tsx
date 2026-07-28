import { Box } from '@mui/material';
import { tokens } from '../theme/theme';

/** The NovaTrade wordmark, reused by the auth screen and the top bar. */
export default function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <Box component="span" sx={{ fontSize: size, fontWeight: 800, letterSpacing: '.5px' }}>
      Nova<Box component="span" sx={{ color: tokens.accent }}>Trade</Box>
    </Box>
  );
}
