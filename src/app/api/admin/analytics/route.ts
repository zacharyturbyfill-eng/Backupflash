import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

type StatsByUser = Record<string, { total: number; today: number }>;
type DeviceByUser = Record<string, string>;
type UserLimitConfig = {
  maxUniqueIps: number;
  maxCleanActionsPerHour: number;
  updatedAt: string;
};
type SecurityEvent = {
  id: string;
  userId: string;
  userEmail: string;
  reason: string;
  detail: string;
  currentValue?: number | null;
  limitValue?: number | null;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string | null;
};

const USER_LIMIT_PREFIX = 'user_limit:';
const SECURITY_EVENT_PREFIX = 'security_event:';
const DEFAULT_USER_LIMITS = {
  maxUniqueIps: 3,
  maxCleanActionsPerHour: 60,
};

function extractDeviceCode(userAgent?: string | null) {
  const raw = String(userAgent || '');
  const match = raw.match(/device:([a-zA-Z0-9_-]+)/);
  return match?.[1] || '';
}

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any
): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const rows: T[] = [];
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

async function assertAdmin(req: NextRequest) {
  const supabaseAdmin = createSupabaseAdminClient();
  const token = getBearerToken(req);
  if (!token) {
    return { error: NextResponse.json({ error: 'Thiếu token xác thực' }, { status: 401 }) };
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user?.id) {
    return { error: NextResponse.json({ error: 'Token không hợp lệ' }, { status: 401 }) };
  }

  const adminId = authData.user.id;
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status')
    .eq('id', adminId)
    .single();

  if (profileError || !profile || profile.role !== 'admin' || profile.status !== 'approved') {
    return { error: NextResponse.json({ error: 'Không có quyền admin' }, { status: 403 }) };
  }

  return { supabaseAdmin };
}

async function buildStats(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>) {
  const [allVoiceUsage, allCleaningChars, allPromptChars, allUsageChars, allLoginHistory] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('usage_logs')
        .select('user_id, tool_name, char_count, created_at')
        .ilike('tool_name', 'Giọng Nói AI%')
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('cleaning_history')
        .select('user_id, char_count')
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('prompt_history')
        .select('user_id, input_transcript')
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('usage_logs')
        .select('user_id, char_count')
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('login_history')
        .select('user_id, user_agent, created_at')
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
  ]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const ai84UsageByUser: StatsByUser = {};
  allVoiceUsage.forEach((row: any) => {
    const uid = row.user_id;
    if (!uid) return;
    const chars = Number(row.char_count || 0);
    if (!ai84UsageByUser[uid]) ai84UsageByUser[uid] = { total: 0, today: 0 };
    ai84UsageByUser[uid].total += chars;
    if (row.created_at && new Date(row.created_at) >= startOfToday) {
      ai84UsageByUser[uid].today += chars;
    }
  });

  const textUsageByUser: Record<string, number> = {};
  allCleaningChars.forEach((row: any) => {
    if (!row.user_id) return;
    textUsageByUser[row.user_id] = (textUsageByUser[row.user_id] || 0) + Number(row.char_count || 0);
  });
  allPromptChars.forEach((row: any) => {
    if (!row.user_id) return;
    textUsageByUser[row.user_id] = (textUsageByUser[row.user_id] || 0) + String(row.input_transcript || '').length;
  });
  allUsageChars.forEach((row: any) => {
    if (!row.user_id) return;
    textUsageByUser[row.user_id] = (textUsageByUser[row.user_id] || 0) + Number(row.char_count || 0);
  });

  const latestDeviceByUser: DeviceByUser = {};
  const seenUsers = new Set<string>();
  allLoginHistory.forEach((row: any) => {
    const uid = String(row.user_id || '');
    if (!uid || seenUsers.has(uid)) return;
    seenUsers.add(uid);
    latestDeviceByUser[uid] = extractDeviceCode(row.user_agent) || 'N/A';
  });

  return { ai84UsageByUser, textUsageByUser, latestDeviceByUser };
}

async function buildUserHistory(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
) {
  const [{ data: cleanData }, { data: promptData }, { data: usageData }] = await Promise.all([
    supabaseAdmin
      .from('cleaning_history')
      .select('id, created_at, provider, char_count, input_content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(300),
    supabaseAdmin
      .from('prompt_history')
      .select('id, created_at, provider, input_transcript, style, results')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(300),
    supabaseAdmin
      .from('usage_logs')
      .select('id, created_at, char_count, tool_name')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  const history: any[] = [];
  (cleanData || []).forEach((row: any) => {
    history.push({
      id: `clean-${row.id}`,
      type: 'clean',
      created_at: row.created_at,
      provider: row.provider,
      char_count: row.char_count,
      summary: `Làm sạch transcript (${row.provider || 'unknown'})`,
      input_preview: row.input_content?.slice(0, 180) || '',
      full_text: row.input_content || '',
    });
  });
  (promptData || []).forEach((row: any) => {
    const isPodcast = String(row.style || '').toLowerCase() === 'podcast';
    const isMedical3 = String(row.style || '').toLowerCase() === 'medical3';
    const scriptText = Array.isArray(row.results)
      ? row.results
          .map((line: any) => {
            if (isMedical3) {
              return `${line?.index || '-'}: ${line?.generatedPrompt || ''}`;
            }
            return `${line?.speaker || 'Speaker'}: ${line?.text || ''}`;
          })
          .join('\n')
      : '';
    history.push({
      id: `prompt-${row.id}`,
      type: 'prompt',
      created_at: row.created_at,
      provider: row.provider,
      char_count: row.input_transcript?.length || 0,
      summary: isPodcast
        ? `Tạo kịch bản podcast (${row.provider || 'unknown'})`
        : isMedical3
        ? `Tạo Prompt Medical 3.0 (${row.provider || 'unknown'})`
        : `Tạo prompt video (${row.style || 'style chưa rõ'})`,
      input_preview: row.input_transcript?.slice(0, 180) || '',
      full_text: scriptText
        ? `${row.input_transcript || ''}\n\n--- ${isMedical3 ? 'PROMPT MEDICAL 3.0' : 'KỊCH BẢN PODCAST'} ---\n${scriptText}`
        : row.input_transcript || '',
    });
  });
  (usageData || []).forEach((row: any) => {
    const tool = String(row.tool_name || '');
    const isVoice = tool.startsWith('Giọng Nói AI');
    const extractedText = tool.includes('|') ? tool.split('|').slice(1).join('|').trim() : '';
    history.push({
      id: `usage-${row.id}`,
      type: isVoice ? 'voice' : 'activity',
      created_at: row.created_at,
      provider: isVoice ? 'minimax' : null,
      char_count: row.char_count,
      summary: tool || 'Hoạt động hệ thống',
      input_preview: extractedText ? extractedText.slice(0, 180) : '',
      full_text: extractedText,
    });
  });

  history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return history;
}

async function loadSecurityOverview(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
) {
  const { data: rows, error } = await supabaseAdmin
    .from('api_vault')
    .select('id, provider, api_key, created_at')
    .or(`provider.like.${USER_LIMIT_PREFIX}%,provider.like.${SECURITY_EVENT_PREFIX}%`)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) throw error;

  const userLimitsByUser: Record<string, UserLimitConfig> = {};
  const securityEvents: SecurityEvent[] = [];

  for (const row of rows || []) {
    const provider = String(row.provider || '');
    const raw = String(row.api_key || '');
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (provider.startsWith(USER_LIMIT_PREFIX)) {
      const userId = provider.slice(USER_LIMIT_PREFIX.length);
      if (!userId) continue;
      userLimitsByUser[userId] = {
        maxUniqueIps: Number(parsed?.maxUniqueIps ?? DEFAULT_USER_LIMITS.maxUniqueIps),
        maxCleanActionsPerHour: Number(
          parsed?.maxCleanActionsPerHour ?? DEFAULT_USER_LIMITS.maxCleanActionsPerHour
        ),
        updatedAt: String(parsed?.updatedAt || row.created_at || new Date().toISOString()),
      };
      continue;
    }

    if (provider.startsWith(SECURITY_EVENT_PREFIX)) {
      const event = parsed || {};
      if (!event.userId) continue;
      securityEvents.push({
        id: String(row.id),
        userId: String(event.userId),
        userEmail: String(event.userEmail || ''),
        reason: String(event.reason || 'UNKNOWN'),
        detail: String(event.detail || ''),
        currentValue: event.currentValue === undefined ? null : Number(event.currentValue),
        limitValue: event.limitValue === undefined ? null : Number(event.limitValue),
        createdAt: String(event.createdAt || row.created_at || new Date().toISOString()),
        resolved: Boolean(event.resolved),
        resolvedAt: event.resolvedAt ? String(event.resolvedAt) : null,
      });
    }
  }

  securityEvents.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return { userLimitsByUser, securityEvents };
}

export async function POST(req: NextRequest) {
  try {
    const guard = await assertAdmin(req);
    if ('error' in guard) return guard.error;

    const { supabaseAdmin } = guard;
    const body = await req.json();
    const action = body?.action;

    if (action === 'stats') {
      const stats = await buildStats(supabaseAdmin);
      return NextResponse.json(stats);
    }

    if (action === 'user_history') {
      const userId = String(body?.userId || '');
      if (!userId) {
        return NextResponse.json({ error: 'Thiếu userId' }, { status: 400 });
      }
      const history = await buildUserHistory(supabaseAdmin, userId);
      return NextResponse.json({ history });
    }

    if (action === 'get_security_overview') {
      const overview = await loadSecurityOverview(supabaseAdmin);
      return NextResponse.json(overview);
    }

    if (action === 'set_user_limits') {
      const userId = String(body?.userId || '').trim();
      if (!userId) {
        return NextResponse.json({ error: 'Thiếu userId' }, { status: 400 });
      }

      const maxUniqueIps = Math.max(2, Math.min(50, Number(body?.maxUniqueIps || 3)));
      const maxCleanActionsPerHour = Math.max(
        1,
        Math.min(10000, Number(body?.maxCleanActionsPerHour || 60))
      );

      const provider = `${USER_LIMIT_PREFIX}${userId}`;
      const payload = {
        maxUniqueIps,
        maxCleanActionsPerHour,
        updatedAt: new Date().toISOString(),
      };

      const { data: existing } = await supabaseAdmin
        .from('api_vault')
        .select('id')
        .eq('provider', provider)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabaseAdmin
          .from('api_vault')
          .update({ api_key: JSON.stringify(payload) })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseAdmin.from('api_vault').insert({
          provider,
          api_key: JSON.stringify(payload),
        });
        if (error) throw error;
      }

      return NextResponse.json({ success: true, limits: payload });
    }

    if (action === 'resolve_security_event') {
      const eventId = String(body?.eventId || '').trim();
      if (!eventId) {
        return NextResponse.json({ error: 'Thiếu eventId' }, { status: 400 });
      }

      const { data: row, error: rowError } = await supabaseAdmin
        .from('api_vault')
        .select('id, api_key')
        .eq('id', eventId)
        .maybeSingle();
      if (rowError || !row) {
        return NextResponse.json({ error: 'Không tìm thấy event' }, { status: 404 });
      }

      let payload: any = {};
      try {
        payload = row.api_key ? JSON.parse(row.api_key) : {};
      } catch {
        payload = {};
      }
      payload.resolved = true;
      payload.resolvedAt = new Date().toISOString();

      const { error: updateError } = await supabaseAdmin
        .from('api_vault')
        .update({ api_key: JSON.stringify(payload) })
        .eq('id', eventId);
      if (updateError) throw updateError;

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
