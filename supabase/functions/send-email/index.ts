// supabase/functions/send-email/index.ts
//
// Fungsi ini akan:
// 1. Menerima permintaan dari admin panel (from, to, subject, message, storage_paths)
// 2. Mengambil file dokumen langsung dari Supabase Storage (pakai service role, aman)
// 3. Login ke SMTP DomainEsia sesuai akun pengirim yang dipilih admin
// 4. Mengirim email dengan dokumen sebagai lampiran (biner, encoding benar)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { requireAdmin } from "../_shared/auth.ts";

// ============ KONFIGURASI (via secrets, jangan hardcode di sini) ============
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMTP_HOST = Deno.env.get("SMTP_HOST") || "mail.juaraind.com";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || "465");
// EMAIL_ACCOUNTS_JSON contoh: {"juara001@juaraind.com":"passwordnya","juara002@juaraind.com":"passwordnya2"}
const ACCOUNTS: Record<string, string> = JSON.parse(Deno.env.get("EMAIL_ACCOUNTS_JSON") || "{}");
const BUCKET = "juara-v2-documents";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tentukan Content-Type MIME berdasarkan ekstensi file, supaya klien email
// (Mail, Gmail, dll) tahu cara membuka lampirannya dengan benar.
function contentTypeFor(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
  };
  return map[ext] || "application/octet-stream";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method tidak didukung" }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const from: string = body.from;
    const to: string = body.to;
    const subject: string = body.subject || "Dokumen Peserta PT. Juara";
    const message: string = body.message || "Terlampir dokumen peserta.";
    const items: { path: string; filename: string }[] = body.storage_paths || [];

    if (!from || !to || !items.length) {
      return json({ error: "Data tidak lengkap: butuh from, to, dan minimal 1 dokumen" }, 400);
    }
    const pass = ACCOUNTS[from];
    if (!pass) {
      return json({ error: `Akun pengirim "${from}" tidak dikenal di konfigurasi server` }, 400);
    }

    // Ambil file dari Supabase Storage pakai service role (bypass RLS, aman karena hanya di server)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const attachments = [];
    for (const item of items) {
      const { data, error } = await supabase.storage.from(BUCKET).download(item.path);
      if (error || !data) {
        console.warn("Gagal ambil berkas:", item.path, error?.message);
        continue;
      }
      const buf = new Uint8Array(await data.arrayBuffer());
      // PENTING: encoding harus "binary" untuk file biner (gambar/PDF/dll),
      // dan contentType harus sesuai ekstensi. Tanpa ini denomailer memperlakukan
      // isi file sebagai teks sehingga lampiran jadi rusak/kosong saat dibuka.
      attachments.push({
        filename: item.filename,
        content: buf,
        encoding: "binary" as const,
        contentType: contentTypeFor(item.filename),
      });
    }
    if (!attachments.length) {
      return json({ error: "Tidak ada lampiran yang berhasil diambil dari storage" }, 400);
    }

    // Kirim via SMTP DomainEsia
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: from, password: pass },
      },
    });

    await client.send({
      from,
      to,
      subject,
      content: message,
      attachments,
    });
    await client.close();

    return json({ ok: true, sent: attachments.length, total: items.length });
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "Gagal mengirim email" }, 500);
  }
});
