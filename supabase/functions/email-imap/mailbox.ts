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

export function isTrashMailbox(mailbox: Pick<MailboxInfo, 'path' | 'name' | 'specialUse'>): boolean {
  if (mailbox.specialUse === '\\Trash') return true;

  const pathSegments = mailbox.path.split(/[/.]/).map((part) => part.trim().toLowerCase());
  const name = mailbox.name?.trim().toLowerCase();
  return (name !== undefined && TRASH_NAMES.has(name)) ||
    pathSegments.some((part) => TRASH_NAMES.has(part));
}

export function findTrashMailbox(mailboxes: readonly MailboxInfo[]): MailboxInfo | undefined {
  return mailboxes.find((mailbox) =>
    !mailbox.flags?.has('\\Noselect') && isTrashMailbox(mailbox)
  );
}
