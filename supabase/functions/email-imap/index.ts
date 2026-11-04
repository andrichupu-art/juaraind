// Edge Function: email-imap
// Membaca inbox cPanel lewat IMAP (toscana.id.rapidplex.com:993) untuk akun yang dipilih.
//
// body: { action: 'folders', account_id }
// body: { action: 'list',    account_id, folder?, page?, page_size?, query? }
// body: { action: 'read',    account_id, folder?, uid }
// body: { action: 'attachment', account_id, folder?, uid, part }
// body: { action: 'unseen',  account_id, folder? }
// body: { action: 'delete',  account_id, folder?, uid }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1.0.98';
import { Buffer } from 'node:buffer';
import { requireAdmin } from '../_shared/auth.ts';
import {
  getMessageParts,
  isWithinAttachmentLimits,
  MAX_ATTACHMENT_BYTES,
  MAX_EMAIL_BODY_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  partFilename,
  type MessageStructure,
} from '../_shared/email-message.ts';
import { findTrashMailbox, isSentMailbox, isTrashMailbox, type MailboxInfo } from '../_shared/mailbox.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('EMAIL_ENC_KEY');
  if (!raw) throw new Error('EMAIL_ENC_KEY belum diset di Supabase Secrets.');
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error('EMAIL_ENC_KEY harus 32 byte.');
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function decryptPassword(encoded: string): Promise<string> {
  const key = await getKey();
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function getAccount(account_id: string) {
  const { data, error } = await admin
    .from('email_accounts')
    .select('id, email, password_enc, imap_host, imap_port')
    .eq('id', account_id)
    .single();
  if (error || !data) throw new Error('Akun email tidak ditemukan.');
  const password = await decryptPassword(data.password_enc);
  return { ...data, password };
}

async function openClient(acc: { email: string; password: string; imap_host: string; imap_port: number }) {
  const client = new ImapFlow({
    host: acc.imap_host || 'toscana.id.rapidplex.com',
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.email, pass: acc.password },
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  await client.connect();
  return client;
}

async function openClientWithRetry(acc: { email: string; password: string; imap_host: string; imap_port: number }) {
  try {
    return await openClient(acc);
  } catch (err) {
    console.error('Percobaan pertama koneksi IMAP gagal, mencoba ulang sekali:', err);
    return await openClient(acc);
  }
}

const connectionPool = new Map<string, ImapFlow>();
const connectionPoolPending = new Map<string, Promise<ImapFlow>>();

async function getPooledClient(account_id: string, acc: { email: string; password: string; imap_host: string; imap_port: number }) {
  const cached = connectionPool.get(account_id);
  if (cached) {
    if (cached.usable) return cached;
    connectionPool.delete(account_id);
    try { cached.close(); } catch { /* noop */ }
  }
  let pending = connectionPoolPending.get(account_id);
  if (!pending) {
    pending = openClientWithRetry(acc);
    connectionPoolPending.set(account_id, pending);
  }
  try {
    const client = await pending;
    if (connectionPoolPending.get(account_id) === pending) {
      connectionPool.set(account_id, client);
      connectionPoolPending.delete(account_id);
    }
    return client;
  } catch (err) {
    if (connectionPoolPending.get(account_id) === pending) connectionPoolPending.delete(account_id);
    throw err;
  }
}

function specialUseLabel(mbox: { path: string; name?: string; specialUse?: string }) {
  const use = mbox.specialUse;
  if (isSentMailbox(mbox)) return 'Terkirim';
  if (use === '\\Trash') return 'Sampah';
  if (use === '\\Drafts') return 'Draf';
  if (use === '\\Junk') return 'Spam';
  if (use === '\\Archive') return 'Arsip';
  if (mbox.path === 'INBOX') return 'Kotak Masuk';
  return mbox.name || mbox.path;
}

function formatAddr(a?: { name?: string; address?: string }) {
  if (!a) return '';
  return a.name ? `${a.name} <${a.address}>` : (a.address || '');
}

// FIX: format daftar alamat (array) jadi string, dipakai untuk field To
function formatAddrList(list?: Array<{ name?: string; address?: string }>) {
  if (!list || list.length === 0) return '';
  return list.map(formatAddr).filter(Boolean).join(', ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function guessImageMime(filename?: string): string | null {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'svg': return 'image/svg+xml';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    default: return null;
  }
}

async function collectDownload(content: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of content) {
    const remaining = maxBytes - size;
    if (remaining <= 0) break;
    const limitedChunk = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    chunks.push(Buffer.from(limitedChunk));
    size += limitedChunk.byteLength;
  }
  return Buffer.concat(chunks, size);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method tidak didukung.' }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let client: ImapFlow | null = null;
  let account_id_used: string | null = null;
  try {
    const body = await req.json();
    const { action, account_id } = body;
    if (!account_id) return jsonResponse({ error: 'account_id wajib diisi.' }, 400);
    account_id_used = account_id;

    const acc = await getAccount(account_id);
    client = await getPooledClient(account_id, acc);

    if (action === 'folders') {
      const list = await client.list();
      const folders = list
        .filter((f: { flags?: Set<string> }) => !f.flags?.has?.('\\Noselect'))
        .map((f: { path: string; name?: string; specialUse?: string }) => ({ path: f.path, name: specialUseLabel(f) }));
      return jsonResponse({ folders });
    }

    if (action === 'unseen') {
      const folder = body.folder || 'INBOX';
      const status = await client.status(folder, { unseen: true, messages: true });
      return jsonResponse({ unseen: status.unseen || 0, total: status.messages || 0 });
    }

    if (action === 'list') {
      const folder = body.folder || 'INBOX';
      const pageSizeValue = Number(body.page_size ?? body.limit ?? 50);
      if (!Number.isInteger(pageSizeValue) || pageSizeValue < 1) {
        return jsonResponse({ error: 'page_size harus berupa bilangan bulat positif.' }, 400);
      }
      const pageSize = Math.min(pageSizeValue, 100);
      const requestedPage = Number(body.page ?? 1);
      if (!Number.isInteger(requestedPage) || requestedPage < 1) {
        return jsonResponse({ error: 'page harus berupa bilangan bulat positif.' }, 400);
      }
      const query = typeof body.query === 'string' ? body.query.trim() : '';
      const lock = await client.getMailboxLock(folder);
      const messages: Array<Record<string, unknown>> = [];
      let total = 0;
      let page = requestedPage;
      try {
        const mailboxTotal = client.mailbox && 'exists' in client.mailbox ? client.mailbox.exists : 0;
        let range: string | number[] | null = null;
        let useUid = false;
        if (query) {
          const matchingUids: number[] = await client.search({
            or: [{ from: query }, { to: query }, { subject: query }],
          }, { uid: true }) || [];
          matchingUids.sort((a, b) => b - a);
          total = matchingUids.length;
          const totalPages = Math.max(1, Math.ceil(total / pageSize));
          page = Math.min(requestedPage, totalPages);
          range = matchingUids.slice((page - 1) * pageSize, page * pageSize);
          useUid = true;
        } else {
          total = mailboxTotal;
          const totalPages = Math.max(1, Math.ceil(total / pageSize));
          page = Math.min(requestedPage, totalPages);
          if (total > 0) {
            const to = total - (page - 1) * pageSize;
            const from = Math.max(1, to - pageSize + 1);
            range = `${from}:${to}`;
          }
        }
        if (range && (typeof range === 'string' || range.length > 0)) {
          const fetchOptions = { envelope: true, flags: true, uid: true };
          const fetchIterator = useUid
            ? client.fetch(range as number[], fetchOptions, { uid: true })
            : client.fetch(range as string, fetchOptions);
          for await (const msg of fetchIterator) {
            messages.push({
              uid: msg.uid,
              subject: msg.envelope?.subject || '',
              from: formatAddr(msg.envelope?.from?.[0]),
              // FIX: sertakan field 'to' supaya folder Terkirim bisa tampilkan alamat tujuan
              to: formatAddrList(msg.envelope?.to),
              date: msg.envelope?.date || null,
              seen: msg.flags?.has?.('\\Seen') || false,
            });
          }
        }
      } finally {
        lock.release();
      }
      messages.sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());
      return jsonResponse({
        messages,
        total,
        page,
        page_size: pageSize,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    if (action === 'attachment') {
      const folder = body.folder || 'INBOX';
      const uid = body.uid;
      const partId = typeof body.part === 'string' ? body.part : '';
      if (!uid) return jsonResponse({ error: 'uid wajib diisi.' }, 400);
      if (!/^\d+(?:\.\d+)*$/.test(partId)) return jsonResponse({ error: 'Bagian lampiran tidak valid.' }, 400);

      const lock = await client.getMailboxLock(folder);
      try {
        const fetched = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
        if (!fetched?.bodyStructure) {
          return jsonResponse({ error: 'Struktur isi email tidak tersedia dari server IMAP.' }, 502);
        }
        const attachment = getMessageParts(fetched.bodyStructure as MessageStructure)
          .attachments.find((part) => part.part === partId);
        if (!attachment) return jsonResponse({ error: 'Lampiran tidak ditemukan.' }, 404);
        if (!isWithinAttachmentLimits(attachment.size, 0)) {
          return jsonResponse({ error: 'Lampiran melebihi batas unduhan 1 MB.' }, 413);
        }

        const downloaded = await client.download(String(uid), attachment.part, {
          uid: true,
          maxBytes: MAX_ATTACHMENT_BYTES,
        });
        if (!downloaded?.content || typeof downloaded.content[Symbol.asyncIterator] !== 'function') {
          return jsonResponse({ error: 'Isi lampiran tidak tersedia dari server IMAP.' }, 502);
        }
        const content = await collectDownload(downloaded.content, MAX_ATTACHMENT_BYTES);
        return jsonResponse({
          attachment: {
            filename: partFilename(attachment) || 'lampiran',
            content_type: attachment.type || 'application/octet-stream',
            size: attachment.size || content.length,
            content: content.toString('base64'),
          },
        });
      } finally {
        lock.release();
      }
    }

    if (action === 'read') {
      const folder = body.folder || 'INBOX';
      const uid = body.uid;
      if (!uid) return jsonResponse({ error: 'uid wajib diisi.' }, 400);
      const lock = await client.getMailboxLock(folder);
      let result: Record<string, unknown> | null = null;
      try {
        const fetched = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true });
        if (!fetched?.bodyStructure) {
          return jsonResponse({ error: 'Struktur isi email tidak tersedia dari server IMAP.' }, 502);
        }

        const structure = fetched.bodyStructure as MessageStructure;
        const parts = getMessageParts(structure);
        let bodyContent = '';
        let html = '';
        if (parts.body) {
          const downloadedBody = await client.download(String(uid), parts.body.part, {
            uid: true,
            maxBytes: MAX_EMAIL_BODY_BYTES,
          });
          if (downloadedBody?.content && typeof downloadedBody.content[Symbol.asyncIterator] === 'function') {
            const bodyBuffer = await collectDownload(downloadedBody.content, MAX_EMAIL_BODY_BYTES);
            bodyContent = new TextDecoder().decode(bodyBuffer);
            if (parts.body.type.toLowerCase() === 'text/html') html = bodyContent;
          }
        }
        if (!html && bodyContent) {
          html = `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(bodyContent)}</pre>`;
        }
        if (!parts.body && !bodyContent) {
          bodyContent = parts.attachments.length
            ? '(Email ini tidak memiliki bagian teks yang dapat ditampilkan.)'
            : '(tidak ada isi)';
        }

        let capturedAttachmentBytes = 0;
        for (const attachment of parts.relatedImages) {
          const cid = attachment.id?.replace(/^<|>$/g, '');
          if (!cid || !new RegExp(`cid:${cid.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i').test(html)) continue;
          if (!isWithinAttachmentLimits(attachment.size, capturedAttachmentBytes)) continue;
          const downloaded = await client.download(String(uid), attachment.part, {
            uid: true,
            maxBytes: Math.min(MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES - capturedAttachmentBytes),
          });
          const content = downloaded?.content &&
              typeof downloaded.content[Symbol.asyncIterator] === 'function'
            ? await collectDownload(
              downloaded.content,
              Math.min(MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES - capturedAttachmentBytes),
            )
            : undefined;
          if (content) capturedAttachmentBytes += content.length;
          if (cid && content) {
            const escapedCid = cid.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const mime = attachment.type.toLowerCase() || guessImageMime(partFilename(attachment)) ||
              'application/octet-stream';
            html = html.replace(
              new RegExp(`cid:${escapedCid}`, 'gi'),
              `data:${mime};base64,${content.toString('base64')}`,
            );
          }
        }

        const attachmentsOut = parts.attachments.map((part) => ({
          part: part.part,
          filename: partFilename(part) || 'lampiran',
          content_type: part.type || 'application/octet-stream',
          size: part.size || 0,
          downloadable: isWithinAttachmentLimits(part.size, 0),
        }));

        result = {
          subject: fetched.envelope?.subject || '',
          from: formatAddr(fetched.envelope?.from?.[0]),
          from_email: fetched.envelope?.from?.[0]?.address || '',
          to: formatAddrList(fetched.envelope?.to),
          date: fetched.envelope?.date || null,
          html: html || null,
          text: bodyContent,
          message_id: fetched.envelope?.messageId || '',
          attachments: attachmentsOut,
        };
        try {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        } catch (flagErr) {
          console.error('Gagal menandai pesan sebagai sudah dibaca:', flagErr);
        }
      } finally {
        lock.release();
      }
      return jsonResponse({ message: result });
    }

    if (action === 'delete') {
      const folder = body.folder || 'INBOX';
      const uid = body.uid;
      if (!uid) return jsonResponse({ error: 'uid wajib diisi.' }, 400);
      const mailboxes = await client.list();
      const sourceMailbox = mailboxes.find((mailbox: MailboxInfo) => mailbox.path === folder) ?? { path: folder };
      const trashMailbox = findTrashMailbox(mailboxes);
      const lock = await client.getMailboxLock(folder);
      try {
        if (isTrashMailbox(sourceMailbox)) {
          await client.messageDelete(String(uid), { uid: true });
        } else {
          if (!trashMailbox) {
            throw new Error('Folder Sampah tidak ditemukan di server email; email tidak dihapus.');
          }
          await client.messageMove(String(uid), trashMailbox.path, { uid: true });
        }
      } finally {
        lock.release();
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Aksi tidak dikenal.' }, 400);
  } catch (err) {
    console.error('email-imap error:', err);
    if (account_id_used) connectionPool.delete(account_id_used);
    if (client) { try { client.close(); } catch { /* noop */ } }
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message || 'Terjadi kesalahan.' }, 500);
  }
});
