import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
let authClient: ReturnType<typeof createClient> | undefined;

function authError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function hasAdminRole(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const claims = metadata as Record<string, unknown>;
  return claims.role === 'admin' || claims.user_role === 'admin' || claims.is_admin === true;
}

export async function requireAdmin(req: Request): Promise<Response | null> {
  const authorization = req.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return authError('Autentikasi diperlukan.', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Konfigurasi autentikasi Supabase tidak tersedia.');

  authClient ??= createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(match[1]);
  if (error || !data.user) {
    return authError('Sesi tidak valid atau telah berakhir.', 401);
  }

  if (!hasAdminRole(data.user.app_metadata)) {
    return authError('Akses khusus admin.', 403);
  }

  return null;
}
