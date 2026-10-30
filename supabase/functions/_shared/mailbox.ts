export type MailboxInfo = {
  path: string;
  name?: string;
  specialUse?: string;
  flags?: Set<string>;
};

const TRASH_NAMES = new Set([
  'bin',
  'deleted',
  'deleted items',
  'deleted messages',
  'sampah',
  'trash',
]);

const SENT_NAMES = new Set([
  'sent',
  'sent items',
  'sent mail',
  'sent messages',
  'terkirim',
]);

function mailboxHasName(mailbox: Pick<MailboxInfo, 'path' | 'name'>, names: Set<string>): boolean {
  const name = mailbox.name?.trim().toLowerCase();
  const pathSegments = mailbox.path.split(/[/.]/).map((part) => part.trim().toLowerCase());
  return (name !== undefined && names.has(name)) || pathSegments.some((part) => names.has(part));
}

export function isTrashMailbox(mailbox: Pick<MailboxInfo, 'path' | 'name' | 'specialUse'>): boolean {
  return mailbox.specialUse === '\\Trash' ||
    mailboxHasName(mailbox, TRASH_NAMES);
}

export function findTrashMailbox(mailboxes: readonly MailboxInfo[]): MailboxInfo | undefined {
  return mailboxes.find((mailbox) =>
    !mailbox.flags?.has('\\Noselect') && isTrashMailbox(mailbox)
  );
}

export function findSentMailbox(mailboxes: readonly MailboxInfo[]): MailboxInfo | undefined {
  return mailboxes.find((mailbox) =>
    !mailbox.flags?.has('\\Noselect') && mailbox.specialUse === '\\Sent'
  ) ?? mailboxes.find((mailbox) =>
    !mailbox.flags?.has('\\Noselect') && mailboxHasName(mailbox, SENT_NAMES)
  );
}
