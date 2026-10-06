// Edge Function: email-accounts
// Kelola daftar akun email (label, alamat, host IMAP/SMTP). Password selalu
// dienkripsi sebelum disimpan dan TIDAK PERNAH dikirim balik ke klien.
//
// body: { action: 'list' }
// body: { action: 'add', label, email, password, imap_host?, imap_port?, smtp_host?, smtp_port? }
// body: { action: 'update_password', id, password }
// body: { action: 'delete', id }
// body: { action: 'toggle_watch', id, watch_notif }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1.0.98';
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
  if (keyBytes.length !== 32) throw new Error('EMAIL_ENC_KEY harus 32 byte (hasil dari: openssl rand -base64 32).');
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptPassword(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...combined));
}

// FIX: sebelum kredensial disimpan (baik saat tambah akun baru maupun ganti
// password), coba login IMAP dulu dengan kredensial tsb. Kalau salah/gagal,
// tolak permintaan supaya tidak ada lagi akun tersimpan dengan password yang
// sebenarnya tidak valid di server mail (baru ketahuan belakangan saat buka inbox).
//
// FIX #2: ImapFlow melempar error dengan `err.message` yang cuma "Command failed"
// generik untuk SEMUA jenis kegagalan command IMAP (bukan cuma auth) — detail
// sebenarnya (mis. AUTHENTICATIONFAILED) ada di properti lain pada objek error
// (authenticationFailed, serverResponseCode, responseText, response), BUKAN di
// dalam string err.message. Sebelumnya kita cuma mengecek err.message, jadi
// kasus auth gagal malah tampil sebagai "Command failed" yang membingungkan.
//
// FIX #3: pesan disederhanakan jadi singkat/ringkas sesuai permintaan admin
// ("Password salah"), bukan kalimat panjang berisi jargon teknis.
interface ImapLikeError {
  message?: string;
  authenticationFailed?: boolean;
  serverResponseCode?: string;
  responseText?: string;
  response?: string;
  code?: string;
}
async function verifyImapCredentials(opts: { email: string; password: string; imap_host: string; imap_port: number }): Promise<void> {
  const client = new ImapFlow({
    host: opts.imap_host || 'mail.juaraind.com',
    port: opts.imap_port || 993,
    secure: true,
    auth: { user: opts.email, pass: opts.password },
    logger: false,
    connectionTimeout: 12000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await client.connect();
  } catch (rawErr) {
    const err = rawErr as ImapLikeError;
    const isAuthFailure =
      err?.authenticationFailed === true ||
      err?.serverResponseCode === 'AUTHENTICATIONFAILED' ||
      /AUTHENTICATIONFAILED|Authentication failed/i.test(err?.responseText || '') ||
      /AUTHENTICATIONFAILED|Authentication failed/i.test(err?.response || '') ||
      /AUTHENTICATIONFAILED|Authentication failed/i.test(err?.message || '');
    const isNetworkFailure =
      err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' ||
      /timed?\s?out|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(err?.message || '');
    let friendly: string;
    if (isAuthFailure) {
      friendly = 'Password salah';
    } else if (isNetworkFailure) {
      friendly = 'Server mail tidak bisa dihubungi';
    } else {
      friendly = 'Gagal terhubung ke server mail';
    }
    throw new Error(friendly);
  } finally {
    try { await client.logout(); } catch { /* noop */ }
    try { client.close(); } catch { /* noop */ }
  }
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method tidak didukung.' }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const action = body?.action;

    if (action === 'list') {
      const { data, error } = await admin
        .from('email_accounts')
        .select('id, label, email, imap_host, imap_port, smtp_host, smtp_port, watch_notif, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return jsonResponse({ accounts: data });
    }

    if (action === 'add') {
      const { label, email, password, imap_host, imap_port, smtp_host, smtp_port } = body;
      if (!email || !password) {
        return jsonResponse({ error: 'Email dan kata sandi wajib diisi.' }, 400);
      }
      const host = imap_host || 'mail.juaraind.com';
      const port = imap_port || 993;
      try {
        await verifyImapCredentials({ email, password, imap_host: host, imap_port: port });
      } catch (verifyErr) {
        return jsonResponse({ error: (verifyErr as Error).message }, 400);
      }
      const password_enc = await encryptPassword(password);
      const { data, error } = await admin
        .from('email_accounts')
        .insert({
          label: label || email,
          email,
          password_enc,
          imap_host: host,
          imap_port: port,
          smtp_host: smtp_host || 'mail.juaraind.com',
          smtp_port: smtp_port || 465,
        })
        .select('id')
        .single();
      if (error) throw error;
      return jsonResponse({ ok: true, id: data.id });
    }

    if (action === 'update_password') {
      const { id, password } = body;
      if (!id || !password) return jsonResponse({ error: 'ID akun dan password baru wajib diisi.' }, 400);
      const { data: acc, error: accErr } = await admin
        .from('email_accounts')
        .select('email, imap_host, imap_port')
        .eq('id', id)
        .single();
      if (accErr || !acc) return jsonResponse({ error: 'Akun tidak ditemukan.' }, 404);
      try {
        await verifyImapCredentials({ email: acc.email, password, imap_host: acc.imap_host, imap_port: acc.imap_port });
      } catch (verifyErr) {
        return jsonResponse({ error: (verifyErr as Error).message }, 400);
      }
      const password_enc = await encryptPassword(password);
      const { error } = await admin.from('email_accounts').update({ password_enc }).eq('id', id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return jsonResponse({ error: 'ID akun wajib diisi.' }, 400);
      const { error } = await admin.from('email_accounts').delete().eq('id', id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === 'toggle_watch') {
      const { id, watch_notif } = body;
      if (!id) return jsonResponse({ error: 'ID akun wajib diisi.' }, 400);
      const { error } = await admin.from('email_accounts').update({ watch_notif: !!watch_notif }).eq('id', id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Aksi tidak dikenal.' }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: (err as Error).message || 'Terjadi kesalahan.' }, 500);
  }
});