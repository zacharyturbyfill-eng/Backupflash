import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

const makeDeviceTag = (value: string) => {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
};

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Thiếu token xác thực.' }, { status: 401 });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return NextResponse.json({ error: 'Token không hợp lệ.' }, { status: 401 });
    }

    const body = await req.json();
    const userId = String(body?.userId || '');
    const sessionId = String(body?.sessionId || '');
    const deviceCode = makeDeviceTag(String(body?.deviceCode || ''));

    if (!userId || authData.user.id !== userId) {
      return NextResponse.json({ error: 'Không có quyền cập nhật phiên.' }, { status: 403 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'Unknown';
    const taggedAgent = `${userAgent} || device:${deviceCode}${sessionId ? ` || session:${sessionId}` : ''}`;

    await supabaseAdmin
      .from('profiles')
      .update({ last_active_at: new Date().toISOString(), current_ip: ip })
      .eq('id', userId);

    await supabaseAdmin
      .from('login_history')
      .insert({ user_id: userId, ip_address: ip, user_agent: taggedAgent });

    return NextResponse.json({ success: true, ip, deviceCode });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Session track error' }, { status: 500 });
  }
}

