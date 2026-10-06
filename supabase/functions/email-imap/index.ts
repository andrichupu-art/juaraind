// Edge Function: email-imap
// Membaca inbox cPanel lewat IMAP (toscana.id.rapidplex.com:993) untuk akun yang dipilih.
//
// body: { action: 'folders', account_id }
// body: { action: 'list',    account_id, folder?, limit? }
// body: { action: 'read',    account_id, folder?, uid }
// body: { action: 'unseen',  account_id, folder? }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1.0.98';
import { simpleParser } from 'npm:mailparser@3.7.1';
import { Buffer } from 'node:buffer';

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

async function getPooledClient(account_id: string, acc: { email: string; password: string; imap_host: string; imap_port: number }) {
  const cached = connectionPool.get(account_id);
  if (cached) {
    if (cached.usable) return cached;
    connectionPool.delete(account_id);
    try { cached.close(); } catch { /* noop */ }
  }
  const client = await openClientWithRetry(acc);
  connectionPool.set(account_id, client);
  return client;
}

function specialUseLabel(mbox: { path: string; name?: string; specialUse?: string }) {
  const use = mbox.specialUse;
  if (use === '\\Sent') return 'Terkirim';
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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
        .filter((f) => !f.flags?.has?.('\\Noselect'))
        .map((f) => ({ path: f.path, name: specialUseLabel(f) }));
      return jsonResponse({ folders });
    }

    if (action === 'unseen') {
      const folder = body.folder || 'INBOX';
      const status = await client.status(folder, { unseen: true, messages: true });
      return jsonResponse({ unseen: status.unseen || 0, total: status.messages || 0 });
    }

    if (action === 'list') {
      const folder = body.folder || 'INBOX';
      const limit = Math.min(body.limit || 50, 100);
      const lock = await client.getMailboxLock(folder);
      const messages: Array<Record<string, unknown>> = [];
      try {
        const total = client.mailbox && 'exists' in client.mailbox ? client.mailbox.exists : 0;
        if (total > 0) {
          const from = Math.max(1, total - limit + 1);
          for await (const msg of client.fetch(`${from}:*`, { envelope: true, flags: true, uid: true })) {
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
      return jsonResponse({ messages });
    }

    if (action === 'read') {
      const folder = body.folder || 'INBOX';
      const uid = body.uid;
      if (!uid) return jsonResponse({ error: 'uid wajib diisi.' }, 400);
      const lock = await client.getMailboxLock(folder);
      let result: Record<string, unknown> | null = null;
      try {
        const raw = await client.download(String(uid), undefined, { uid: true });
        if (!raw?.content || typeof raw.content[Symbol.asyncIterator] !== 'function') {
          return jsonResponse({
            error: 'Server IMAP tidak mengembalikan isi email ini. Muat ulang daftar email, lalu coba lagi.',
          }, 502);
        }
        const chunks: Uint8Array[] = [];
        for await (const chunk of raw.content) chunks.push(chunk as Uint8Array);
        const buf = Buffer.concat(chunks);

        const parsed = await simpleParser(buf);

        let html = parsed.html || (parsed.text ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(parsed.text)}</pre>` : '');
        const attachments = parsed.attachments || [];

        const usedCids = new Set<string>();
        for (const att of attachments) {
          if (att.cid && att.content) {
            const escapedCid = att.cid.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const cidPattern = new RegExp(`cid:${escapedCid}`, 'g');
            if (cidPattern.test(html)) {
              const dataUri = `data:${att.contentType};base64,${att.content.toString('base64')}`;
              html = html.replace(new RegExp(`cid:${escapedCid}`, 'g'), dataUri);
              usedCids.add(att.cid);
            }
          }
        }

        const looseImages = attachments.filter((att) => {
          if (!att.content) return false;
          if (att.cid && usedCids.has(att.cid)) return false;
          return att.contentType?.startsWith('image/') || !!guessImageMime(att.filename);
        });
        if (looseImages.length > 0) {
          html += looseImages
            .map((att) => {
              const mime = att.contentType?.startsWith('image/') ? att.contentType : (guessImageMime(att.filename) || att.contentType || 'application/octet-stream');
              const dataUri = `data:${mime};base64,${att.content!.toString('base64')}`;
              return `<div style="margin-top:12px"><img src="${dataUri}" alt="${escapeHtml(att.filename || 'lampiran gambar')}" style="max-width:100%;border-radius:8px" /></div>`;
            })
            .join('');
        }

        const attachmentsOut = attachments
          .filter((att) => !!att.content)
          .map((att) => ({
            filename: att.filename || 'lampiran',
            content_type: att.contentType || 'application/octet-stream',
            size: att.size ?? att.content!.length,
            content: att.content!.toString('base64'),
          }));

        result = {
          subject: parsed.subject || '',
          from: parsed.from?.text || '',
          from_email: parsed.from?.value?.[0]?.address || '',
          to: parsed.to && 'text' in parsed.to ? parsed.to.text : '',
          date: parsed.date || null,
          html: html || null,
          text: parsed.text || '',
          message_id: parsed.messageId || '',
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
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageDelete(String(uid), { uid: true });
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
