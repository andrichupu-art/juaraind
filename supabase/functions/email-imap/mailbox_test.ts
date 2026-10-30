import { findSentMailbox, findTrashMailbox, isTrashMailbox } from '../_shared/mailbox.ts';

Deno.test('finds the selectable mailbox marked with the IMAP Trash special-use attribute', () => {
  const trash = { path: 'INBOX.Deleted', name: 'Deleted', specialUse: '\\Trash' };
  const result = findTrashMailbox([
    { path: 'INBOX', name: 'INBOX' },
    { path: 'Deleted', name: 'Deleted', specialUse: '\\Noselect', flags: new Set(['\\Noselect']) },
    trash,
  ]);

  if (result !== trash) throw new Error('Expected the selectable Trash mailbox.');
});

Deno.test('recognizes common Trash mailbox names when special-use attributes are unavailable', () => {
  const trash = findTrashMailbox([
    { path: 'INBOX' },
    { path: 'INBOX.Sampah', name: 'Sampah' },
  ]);

  if (trash?.path !== 'INBOX.Sampah') throw new Error('Expected the Sampah mailbox.');
});

Deno.test('does not classify unrelated mailboxes as Trash', () => {
  if (isTrashMailbox({ path: 'INBOX.Archive', name: 'Archive' })) {
    throw new Error('Archive must not be classified as Trash.');
  }
});

Deno.test('recognizes a source mailbox as Trash before deciding how to delete', () => {
  if (!isTrashMailbox({ path: 'INBOX/Deleted Items' })) {
    throw new Error('Expected Deleted Items to be classified as Trash.');
  }
});

Deno.test('prefers the selectable mailbox marked with the IMAP Sent special-use attribute', () => {
  const sent = { path: 'INBOX.Sent Messages', specialUse: '\\Sent' };
  const result = findSentMailbox([
    { path: 'Sent', specialUse: '\\Noselect', flags: new Set(['\\Noselect']) },
    sent,
  ]);

  if (result !== sent) throw new Error('Expected the selectable Sent mailbox.');
});

Deno.test('recognizes the Indonesian Terkirim mailbox when special-use attributes are unavailable', () => {
  const result = findSentMailbox([
    { path: 'INBOX' },
    { path: 'INBOX.Terkirim', name: 'Terkirim' },
  ]);

  if (result?.path !== 'INBOX.Terkirim') throw new Error('Expected the Terkirim mailbox.');
});
