import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

const ANNOUNCE_PREFIX = 'SYSTEM_ANNOUNCEMENT|';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

function parseAnnouncement(toolName: string) {
  if (!toolName.startsWith(ANNOUNCE_PREFIX)) return null;
  const payload = toolName.slice(ANNOUNCE_PREFIX.length);
  try {
    const parsed = JSON.parse(payload);
    return {
      id: String(parsed.id || ''),
      title: String(parsed.title || 'Thông báo hệ thống'),
      content: String(parsed.content || ''),
      createdAt: String(parsed.createdAt || ''),
      createdBy: String(parsed.createdBy || ''),
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Thiếu token xác thực.' }, { status: 401 });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return NextResponse.json({ error: 'Token không hợp lệ.' }, { status: 401 });
    }

    const userId = authData.user.id;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, role, status')
      .eq('id', userId)
      .single();
    if (profileError || !profile || profile.status !== 'approved') {
      return NextResponse.json({ error: 'Tài khoản không hợp lệ.' }, { status: 403 });
    }

    const body = await req.json();
    const action = String(body?.action || '');

    if (action === 'get_latest') {
      const { data } = await supabaseAdmin
        .from('usage_logs')
        .select('tool_name, created_at, user_email')
        .ilike('tool_name', `${ANNOUNCE_PREFIX}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return NextResponse.json({ announcement: null });
      const parsed = parseAnnouncement(String(data.tool_name || ''));
      if (!parsed) return NextResponse.json({ announcement: null });

      return NextResponse.json({
        announcement: {
          ...parsed,
          createdAt: parsed.createdAt || data.created_at,
          createdBy: parsed.createdBy || data.user_email || 'admin',
        },
      });
    }

    if (action === 'publish') {
      if (profile.role !== 'admin') {
        return NextResponse.json({ error: 'Chỉ admin mới được gửi thông báo.' }, { status: 403 });
      }

      const title = String(body?.title || '').trim() || 'Thông báo hệ thống';
      const content = String(body?.content || '').trim();
      if (!content) return NextResponse.json({ error: 'Nội dung thông báo không được để trống.' }, { status: 400 });

      const payload = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title.slice(0, 120),
        content: content.slice(0, 5000),
        createdAt: new Date().toISOString(),
        createdBy: String(profile.email || 'admin'),
      };

      const { error: insertError } = await supabaseAdmin.from('usage_logs').insert({
        user_id: profile.id,
        user_email: profile.email,
        tool_name: `${ANNOUNCE_PREFIX}${JSON.stringify(payload)}`,
        char_count: payload.content.length,
      });

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, announcement: payload });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Announcement API error' }, { status: 500 });
  }
}

