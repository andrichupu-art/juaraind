// Edge Function: email-send
// Mengirim email baru / balasan lewat SMTP, lalu append ke folder Sent via IMAP.
// Cara build raw message: pakai nodemailer streamTransport (bukan buildMessage
// yang tidak tersedia di versi ini).

import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.14';
import { ImapFlow } from 'npm:imapflow@1.0.98';
import { Buffer } from 'node:buffer';
import { requireAdmin } from '../_shared/auth.ts';

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

const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024;

interface IncomingAttachment {
  filename?: string;
  content_type?: string;
  content?: string;
}

function decodeAttachments(list: unknown): { filename: string; content: Uint8Array; contentType: string }[] {
  if (!list) return [];
  if (!Array.isArray(list)) throw new Error('Format attachments tidak valid.');
  let totalBytes = 0;
  return list.map((raw: IncomingAttachment, i: number) => {
    if (!raw || typeof raw.content !== 'string' || !raw.content)
      throw new Error(`Lampiran ke-${i + 1} tidak memiliki konten.`);
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(raw.content), (c) => c.charCodeAt(0)); }
    catch { throw new Error(`Lampiran "${raw.filename || i + 1}" gagal didekode.`); }
    totalBytes += bytes.length;
    if (totalBytes > MAX_ATTACHMENTS_BYTES) throw new Error('Total ukuran lampiran melebihi batas 15MB.');
    return { filename: raw.filename || `lampiran-${i + 1}`, content: bytes, contentType: raw.content_type || 'application/octet-stream' };
  });
}

// Build raw RFC822 message menggunakan nodemailer streamTransport
async function buildRawMessage(mail: Record<string, unknown>): Promise<Buffer> {
  const streamTransporter = nodemailer.createTransport({ streamTransport: true, newline: 'unix' });
  const info = await streamTransporter.sendMail(mail);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    // deno-lint-ignore no-explicit-any
    const stream = (info as any).message;
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

async function appendToSent(
  acc: { email: string; password: string; imap_host: string; imap_port: number },
  rawMessage: Buffer
): Promise<void> {
  const client = new ImapFlow({
    host: acc.imap_host || 'toscana.id.rapidplex.com',
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.email, pass: acc.password },
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  await client.connect();
  try {
    const list: Array<{ specialUse?: string; path: string; name?: string }> = await client.list();
    const sentFolder =
      list.find((f) => f.specialUse === '\\Sent') ??
      list.find((f) => /^sent/i.test(f.path)) ??
      list.find((f) => /sent/i.test(f.name || ''));
    const folder = sentFolder?.path || 'Sent';
    console.log('append ke folder:', folder);
    await client.append(folder, rawMessage, ['\\Seen'], new Date());
  } finally {
    try { client.logout(); } catch { /* noop */ }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method tidak didukung.' }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { account_id, to, subject, message, in_reply_to, references, attachments } = body;
    if (!account_id || !to) {
      return jsonResponse({ error: 'account_id dan to wajib diisi.' }, 400);
    }

    const parsedAttachments = decodeAttachments(attachments);

    const { data: acc, error } = await admin
      .from('email_accounts')
      .select('email, password_enc, smtp_host, smtp_port, imap_host, imap_port')
      .eq('id', account_id)
      .single();
    if (error || !acc) throw new Error('Akun email tidak ditemukan.');

    const password = await decryptPassword(acc.password_enc);
    const port = acc.smtp_port || 465;

    const transporter = nodemailer.createTransport({
      host: acc.smtp_host || 'toscana.id.rapidplex.com',
      port,
      secure: port === 465,
      auth: { user: acc.email, pass: password },
    });

    const mail: Record<string, unknown> = {
      from: acc.email,
      to,
      subject: subject || '(tanpa subjek)',
      text: message || '',
    };
    if (in_reply_to) mail.inReplyTo = in_reply_to;
    if (references) mail.references = references;
    if (parsedAttachments.length) {
      mail.attachments = parsedAttachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }));
    }

    // Kirim via SMTP
    const info = await transporter.sendMail(mail);

    // Append ke folder Sent — non-fatal
    try {
      const rawMessage = await buildRawMessage(mail);
      await appendToSent(
        { email: acc.email, password, imap_host: acc.imap_host, imap_port: acc.imap_port },
        rawMessage
      );
      console.log('append ke Sent berhasil');
    } catch (appendErr) {
      console.error('append ke Sent gagal (non-fatal):', appendErr);
    }

    return jsonResponse({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: (err as Error).message || 'Terjadi kesalahan.' }, 500);
  }
});
