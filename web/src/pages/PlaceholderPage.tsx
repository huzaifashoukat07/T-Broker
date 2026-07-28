import { Box, Typography } from '@mui/material';

/** Stands in for pages not yet ported, so routing can be exercised end to end. */
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h5" fontWeight={800} gutterBottom>{title}</Typography>
      <Typography color="text.secondary">
        This screen has not been ported to React yet — it still lives on the current site.
      </Typography>
    </Box>
  );
}
