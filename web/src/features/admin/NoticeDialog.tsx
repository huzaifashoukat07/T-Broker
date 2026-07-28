import { useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { fetchTemplates, sendNotice, type AdminUser } from './adminSlice';
import { tokens } from '../../theme/theme';

/** Emails a branded account notice; templates come from the server. */
export default function NoticeDialog({
  user, onClose,
}: { user: AdminUser | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const templates = useAppSelector((s) => s.admin.templates);
  const [template, setTemplate] = useState('reinstated');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!templates.length) dispatch(fetchTemplates());
  }, [templates.length, dispatch]);

  useEffect(() => {
    if (user) { setText(''); setSent(null); setTemplate(templates[0]?.id ?? 'reinstated'); }
  }, [user, templates]);

  if (!user) return null;

  const submit = async () => {
    setSending(true);
    const res = await dispatch(sendNotice({ userId: user.id, template, message: text }));
    setSending(false);
    if (sendNotice.fulfilled.match(res)) setSent(res.payload.email);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Send notice</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1.5} alignItems="center"
          sx={{ mb: 2.5, p: 1.5, bgcolor: tokens.bg2, borderRadius: 2 }}>
          <Avatar sx={{ bgcolor: tokens.accent, width: 34, height: 34, fontWeight: 800 }}>
            {user.name.charAt(0).toUpperCase()}
          </Avatar>
          <Box>
            <Typography fontSize={13.5} fontWeight={700}>{user.name}</Typography>
            <Typography fontSize={12} color="text.secondary">{user.email}</Typography>
          </Box>
        </Stack>

        {sent ? (
          <Alert severity="success">Email sent to {sent}.</Alert>
        ) : (
          <Stack spacing={2}>
            <TextField select label="Template" value={template}
              onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
            </TextField>
            <TextField
              label="Your message" multiline minRows={5} value={text}
              onChange={(e) => setText(e.target.value)}
              helperText={`${text.length} characters — optional, added inside the email`}
              placeholder="Add anything specific for this user."
            />
            <Alert severity="info" icon={false}>
              Sends from <b>info@nova-market.trade</b> with the NovaTrade signature and the
              automated-message footer. Your own email address and IP are never exposed.
            </Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{sent ? 'Close' : 'Cancel'}</Button>
        {!sent && (
          <Button variant="contained" onClick={submit}
            disabled={sending || (template === 'custom' && !text.trim())}>
            {sending ? 'Sending…' : 'Send email'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
