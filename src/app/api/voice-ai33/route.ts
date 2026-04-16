import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = createSupabaseAdminClient();

const API_BASE_URL = "https://api.ai33.pro";
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const DEAD_KEY_THRESHOLD = 3;     // 3 lỗi liên tiếp → đánh dấu chết
const DEAD_KEY_COOLDOWN = 300000; // 5 phút sau thử lại key chết
const VOICE_PRESENCE_PREFIX = 'VOICE_PRESENCE|';
const VOICE_FIX_RULES_PROVIDER = 'voice_fix_rules:global';

// ===== CẤU TRÚC KEY VỚI LABEL =====
interface KeyEntry {
  api_key: string;
  label: string; // Ghi chú do admin đặt
}
interface FixRule {
  id: string;
  from: string;
  to: string;
}

function decodeAi33LabelFromProvider(provider?: string | null): string {
  if (!provider || !provider.startsWith('ai33:')) return '';
  const parts = provider.split(':');
  if (parts.length < 3) return '';
  try {
    const token = parts[1];
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = Buffer.from(padded, 'base64').toString('binary');
    const encoded = Array.from(binary)
      .map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join('');
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

// ===== DEAD KEY DETECTION SYSTEM =====
interface KeyHealth {
  consecutiveFailures: number;
  deadSince: number | null;
  lastError: string;
  label: string;
  totalRequests: number;
  totalFailures: number;
}

const keyHealthMap = new Map<string, KeyHealth>();

function getKeyHealth(key: string, label?: string): KeyHealth {
  if (!keyHealthMap.has(key)) {
    keyHealthMap.set(key, {
      consecutiveFailures: 0,
      deadSince: null,
      lastError: '',
      label: label || key.substring(0, 8) + '...',
      totalRequests: 0,
      totalFailures: 0,
    });
  }
  const health = keyHealthMap.get(key)!;
  if (label) health.label = label; // Luôn cập nhật label mới nhất
  return health;
}

function markKeySuccess(key: string, label?: string) {
  const health = getKeyHealth(key, label);
  health.consecutiveFailures = 0;
  health.deadSince = null;
  health.totalRequests++;
}

function markKeyFailure(key: string, error: string, label?: string) {
  const health = getKeyHealth(key, label);
  health.consecutiveFailures++;
  health.totalRequests++;
  health.totalFailures++;
  health.lastError = error;

  if (health.consecutiveFailures >= DEAD_KEY_THRESHOLD) {
    health.deadSince = Date.now();
    console.log(`[KEY DEAD] "${health.label}" đã bị đánh dấu CHẾT sau ${health.consecutiveFailures} lỗi liên tiếp. Lỗi cuối: ${error}`);
  }
}

function isKeyAlive(key: string): boolean {
  const health = getKeyHealth(key);
  if (!health.deadSince) return true;

  if (Date.now() - health.deadSince > DEAD_KEY_COOLDOWN) {
    console.log(`[KEY REVIVE] "${health.label}" hết cooldown, cho phép thử lại.`);
    health.deadSince = null;
    health.consecutiveFailures = 0;
    return true;
  }

  return false;
}

// Lọc chỉ lấy entries sống
function getAliveEntries(entries: KeyEntry[]): KeyEntry[] {
  return entries.filter(e => isKeyAlive(e.api_key));
}

// Lấy danh sách key chết với lý do
function getDeadKeyReport(entries: KeyEntry[]): Array<{ label: string; error: string }> {
  return entries
    .filter(e => !isKeyAlive(e.api_key))
    .map(e => {
      const health = getKeyHealth(e.api_key);
      return { label: health.label || e.label, error: health.lastError };
    });
}

// ===== END DEAD KEY DETECTION =====

// Helper: Retry với exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable = err.cause?.code === 'ECONNRESET'
        || err.cause?.code === 'ETIMEDOUT'
        || err.cause?.code === 'ECONNABORTED'
        || err.message?.includes('fetch failed');

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 15000);
        console.log(`[${label}] Lỗi kết nối, thử lại sau ${delay}ms (lần ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

// Lấy tất cả ai33 key + label từ vault
async function getAi33Entries(): Promise<KeyEntry[]> {
  const { data } = await supabaseAdmin
    .from('api_vault')
    .select('api_key, provider')
    .like('provider', 'ai33%');

  if (!data || data.length === 0) return [];
  return data
    .filter(d => d.api_key)
    .map((d, i) => ({
      api_key: d.api_key,
      label: decodeAi33LabelFromProvider(d.provider) || `ai33 Key #${i + 1}`,
    }));
}

// Round-robin CHỈ trên keys sống
let keyIndex = 0;
function getNextAliveEntry(allEntries: KeyEntry[]): { entry: KeyEntry; index: number } {
  const aliveEntries = getAliveEntries(allEntries);

  if (aliveEntries.length === 0) {
    console.log('[KEY EMERGENCY] Tất cả keys đều chết! Reset key ít lỗi nhất...');
    let bestEntry = allEntries[0];
    let minFailures = Infinity;
    allEntries.forEach(entry => {
      const health = getKeyHealth(entry.api_key);
      if (health.totalFailures < minFailures) {
        minFailures = health.totalFailures;
        bestEntry = entry;
      }
    });
    const health = getKeyHealth(bestEntry.api_key);
    health.deadSince = null;
    health.consecutiveFailures = 0;
    const idx = allEntries.indexOf(bestEntry);
    return { entry: bestEntry, index: idx };
  }

  const entry = aliveEntries[keyIndex % aliveEntries.length];
  const originalIndex = allEntries.findIndex(e => e.api_key === entry.api_key);
  keyIndex++;
  return { entry, index: originalIndex };
}

// Xác thực user
async function authenticateUser(userId: string) {
  if (!userId) return null;
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  if (!profile || profile.status !== 'approved') return null;
  return profile;
}

function parsePresence(toolName: string) {
  if (!toolName.startsWith(VOICE_PRESENCE_PREFIX)) return null;
  try {
    const payload = JSON.parse(toolName.slice(VOICE_PRESENCE_PREFIX.length));
    return {
      state: String(payload?.state || ''),
      device: String(payload?.device || ''),
    };
  } catch {
    return null;
  }
}

function normalizeFixRules(input: any): FixRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((r: any, idx: number) => ({
      id: String(r?.id || `rule-${idx}`),
      from: String(r?.from || '').trim(),
      to: String(r?.to || '').trim(),
    }))
    .filter((r: FixRule) => r.from && r.to)
    .slice(0, 500);
}

async function getGlobalFixRules(): Promise<FixRule[]> {
  const { data } = await supabaseAdmin
    .from('api_vault')
    .select('api_key')
    .eq('provider', VOICE_FIX_RULES_PROVIDER)
    .maybeSingle();
  if (!data?.api_key) return [];
  try {
    return normalizeFixRules(JSON.parse(String(data.api_key)));
  } catch {
    return [];
  }
}

async function saveGlobalFixRules(rules: FixRule[]) {
  const normalized = normalizeFixRules(rules);
  const { error } = await supabaseAdmin
    .from('api_vault')
    .upsert(
      { provider: VOICE_FIX_RULES_PROVIDER, api_key: JSON.stringify(normalized) },
      { onConflict: 'provider' }
    );
  if (error) throw new Error(error.message);
  return normalized;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId } = body;

    const profile = await authenticateUser(userId);
    if (!profile) {
      return NextResponse.json({ error: 'Truy cập bị từ chối' }, { status: 403 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
    const allEntries = await getAi33Entries();

    // Đăng ký label cho tất cả keys
    allEntries.forEach(e => getKeyHealth(e.api_key, e.label));

    // --- ACTION: Presence ping cho giọng nói ---
    if (action === 'presence_ping') {
      const device = String(body?.deviceCode || '').trim().slice(0, 64) || 'unknown';
      await supabaseAdmin.from('usage_logs').insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `${VOICE_PRESENCE_PREFIX}${JSON.stringify({ state: 'ping', device })}`,
        char_count: 0,
      });
      return NextResponse.json({ success: true });
    }

    // --- ACTION: Presence end ---
    if (action === 'presence_end') {
      const device = String(body?.deviceCode || '').trim().slice(0, 64) || 'unknown';
      await supabaseAdmin.from('usage_logs').insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `${VOICE_PRESENCE_PREFIX}${JSON.stringify({ state: 'end', device })}`,
        char_count: 0,
      });
      return NextResponse.json({ success: true });
    }

    // --- ACTION: Lấy danh sách người đang dùng giọng nói ---
    if (action === 'presence_list') {
      const now = Date.now();
      const cutoffIso = new Date(now - 2 * 60 * 1000).toISOString();
      const { data } = await supabaseAdmin
        .from('usage_logs')
        .select('user_id, user_email, tool_name, created_at')
        .ilike('tool_name', `${VOICE_PRESENCE_PREFIX}%`)
        .gte('created_at', cutoffIso)
        .order('created_at', { ascending: false })
        .limit(400);

      const latestByUser = new Map<string, { user_id: string; user_email: string; created_at: string; state: string; device: string }>();
      (data || []).forEach((row: any) => {
        const uid = String(row.user_id || '');
        if (!uid || latestByUser.has(uid)) return;
        const parsed = parsePresence(String(row.tool_name || ''));
        if (!parsed) return;
        latestByUser.set(uid, {
          user_id: uid,
          user_email: String(row.user_email || ''),
          created_at: String(row.created_at || ''),
          state: parsed.state,
          device: parsed.device,
        });
      });

      const activeUsers = Array.from(latestByUser.values())
        .filter((u) => u.state !== 'end' && now - new Date(u.created_at).getTime() <= 70 * 1000)
        .map((u) => ({
          userId: u.user_id,
          userName: String(u.user_email || '').split('@')[0] || 'user',
          deviceCode: u.device || 'unknown',
          activeAt: u.created_at,
        }));

      return NextResponse.json({
        success: true,
        totalActive: activeUsers.length,
        otherActive: activeUsers.filter((u) => u.userId !== userId),
      });
    }

    if (action === 'get_fix_rules') {
      const rules = await getGlobalFixRules();
      return NextResponse.json({ success: true, rules });
    }

    if (action === 'save_fix_rules') {
      const rules = normalizeFixRules(body.rules);
      const saved = await saveGlobalFixRules(rules);
      return NextResponse.json({ success: true, rules: saved });
    }

    if (allEntries.length === 0 && action !== 'get_key_count' && action !== 'reset_dead_keys') {
      return NextResponse.json({
        success: false,
        message: 'Chưa có API key ai33 trong kho khóa tổng.',
      }, { status: 403 });
    }

    // --- ACTION: Lấy danh sách giọng cloned ---
    if (action === 'get_cloned_voices') {
      const allVoices: any[] = [];
      const seenIds = new Set<string>();
      const aliveEntries = getAliveEntries(allEntries);
      const entriesToUse = aliveEntries.length > 0 ? aliveEntries : allEntries;

      const promises = entriesToUse.map(entry =>
        withRetry(async () => {
          const res = await fetch(`${API_BASE_URL}/v1m/voice/clone`, {
            headers: { 'xi-api-key': entry.api_key, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
          });
          if (!res.ok) {
            markKeyFailure(entry.api_key, `HTTP ${res.status}`, entry.label);
            return [];
          }
          markKeySuccess(entry.api_key, entry.label);
          const json = await res.json();
          return (json.data || []).map((voice: any) => ({
            ...voice,
            canonical_voice_id: String(voice.voice_id || ''),
            name: voice.voice_name || voice.name || `voice-${voice.voice_id}`,
            created_at: voice.create_time ? new Date(Number(voice.create_time)).toISOString() : new Date().toISOString(),
          }));
        }, `Cloned Voices [${entry.label}]`).catch((err) => {
          markKeyFailure(entry.api_key, err.message, entry.label);
          return [];
        })
      );

      const results = await Promise.all(promises);
      results.forEach((voiceList: any[]) => {
        voiceList.forEach((voice: any) => {
          const voiceId = String(voice?.canonical_voice_id || '');
          if (voiceId && !seenIds.has(voiceId)) {
            seenIds.add(voiceId);
            allVoices.push(voice);
          }
        });
      });

      return NextResponse.json({ success: true, data: allVoices });
    }

    // --- ACTION: Lấy danh sách giọng hệ thống ---
    if (action === 'get_system_voices') {
      const { entry } = getNextAliveEntry(allEntries);
      const params = body.params || {};
      const payload = {
        page: Number(params.page || 1),
        page_size: Number(params.page_size || 60),
        tag_list: Array.isArray(params.tag_list) ? params.tag_list : [],
      };
      const res = await withRetry(async () => {
        const r = await fetch(`${API_BASE_URL}/v1m/voice/list`, {
          method: 'POST',
          headers: { 'xi-api-key': entry.api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        });
        return r;
      }, `System Voices [${entry.label}]`);

      if (res.ok) markKeySuccess(entry.api_key, entry.label);
      else markKeyFailure(entry.api_key, `HTTP ${res.status}`, entry.label);

      const data = await res.json();
      const mapped = (data?.data?.voice_list || []).map((voice: any) => ({
        ...voice,
        canonical_voice_id: String(voice.voice_id || ''),
        name: voice.voice_name || voice.name || `voice-${voice.voice_id}`,
        created_at: voice.create_time ? new Date(Number(voice.create_time)).toISOString() : new Date().toISOString(),
      }));
      return NextResponse.json({ success: res.ok, data: mapped, status: res.status });
    }

    // --- ACTION: Tạo TTS async ---
    if (action === 'tts_async') {
      let entry: KeyEntry;
      let usedIndex: number;

      if (body.keyIndex !== undefined) {
        const aliveEntries = getAliveEntries(allEntries);
        if (aliveEntries.length === 0) {
          const result = getNextAliveEntry(allEntries);
          entry = result.entry;
          usedIndex = result.index;
        } else {
          usedIndex = body.keyIndex % aliveEntries.length;
          entry = aliveEntries[usedIndex];
        }
      } else {
        const result = getNextAliveEntry(allEntries);
        entry = result.entry;
        usedIndex = result.index;
      }

      if (!entry) {
        return NextResponse.json({ success: false, message: 'Không có API Key khả dụng' }, { status: 403 });
      }

      try {
        const res = await withRetry(async () => {
          const r = await fetch(`${API_BASE_URL}/v1m/task/text-to-speech`, {
            method: 'POST',
            headers: { 'xi-api-key': entry.api_key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: body.text,
              model: body.model || 'speech-2.6-hd',
              language_boost: body.language_boost || 'Auto',
              with_transcript: false,
              voice_setting: {
                voice_id: body.canonical_voice_id,
                vol: body.volume || 1.0,
                pitch: body.pitch || 0,
                speed: body.speed || 1.0,
              },
            }),
            signal: AbortSignal.timeout(60000),
          });
          return r;
        }, `TTS [${entry.label}]`);

        const rawData = await res.json();
        const data = rawData?.task_id
          ? { success: true, job_id: rawData.task_id, status: 'doing' }
          : rawData;

        if (res.ok && data.success) {
          markKeySuccess(entry.api_key, entry.label);
        } else {
          markKeyFailure(entry.api_key, data.message || `HTTP ${res.status}`, entry.label);
        }

        if (res.ok) {
          const voiceText = typeof body.text === 'string' ? body.text : '';
          const preview = voiceText.trim().replace(/\s+/g, ' ').slice(0, 80);
          const { error: usageError } = await supabaseAdmin.from('usage_logs').insert({
            user_id: userId, user_email: profile.email,
            tool_name: `Giọng Nói AI (ai33) [${entry.label}]${preview ? ` | ${preview}` : ''}`,
            char_count: voiceText.length,
          });
          if (usageError) {
            console.error('[usage_logs insert failed]', usageError.message);
          }
          const { error: profileError } = await supabaseAdmin.from('profiles').update({
            last_active_at: new Date().toISOString(), current_ip: ip,
          }).eq('id', userId);
          void profileError;
        }

        const deadReport = getDeadKeyReport(allEntries);
        return NextResponse.json({
          ...data,
          _keyHealth: {
            usedKey: entry.label,
            usedKeyIndex: usedIndex,
            aliveKeys: getAliveEntries(allEntries).length,
            totalKeys: allEntries.length,
            deadKeys: deadReport,
          }
        }, { status: res.status });

      } catch (err: any) {
        markKeyFailure(entry.api_key, err.message, entry.label);
        const deadReport = getDeadKeyReport(allEntries);
        return NextResponse.json({
          success: false,
          message: `[${entry.label}] Lỗi kết nối: ${err.message}`,
          _keyHealth: {
            usedKey: entry.label,
            deadKey: true,
            aliveKeys: getAliveEntries(allEntries).length,
            totalKeys: allEntries.length,
            deadKeys: deadReport,
          }
        }, { status: 500 });
      }
    }

    // --- ACTION: Kiểm tra trạng thái job ---
    if (action === 'tts_status') {
      let entry: KeyEntry;
      if (body.keyIndex !== undefined) {
        const aliveEntries = getAliveEntries(allEntries);
        entry = aliveEntries.length > 0 ? aliveEntries[body.keyIndex % aliveEntries.length] : allEntries[body.keyIndex % allEntries.length];
      } else {
        entry = getNextAliveEntry(allEntries).entry;
      }

      const res = await withRetry(async () => {
        const r = await fetch(`${API_BASE_URL}/v1/task/${body.jobId}`, {
          headers: { 'xi-api-key': entry.api_key, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        });
        return r;
      }, `TTS Status [${entry.label}]`, 2);

      if (res.ok) markKeySuccess(entry.api_key, entry.label);
      const raw = await res.json();
      const mappedStatus = raw?.status === 'done' ? 'done' : raw?.status === 'error' ? 'failed' : 'doing';
      const audioUrl = raw?.metadata?.audio_url || raw?.metadata?.output_uri || null;
      return NextResponse.json({
        success: true,
        job: {
          id: raw?.id || body.jobId,
          status: mappedStatus,
          progress: typeof raw?.progress === 'number' ? raw.progress : undefined,
          audio_url: audioUrl,
          error_message: raw?.error_message || null,
        },
      }, { status: res.status });
    }

    // --- ACTION: Proxy audio ---
    if (action === 'proxy_audio') {
      const audioRes = await fetch(body.url, { signal: AbortSignal.timeout(30000) });
      if (!audioRes.ok) return NextResponse.json({ error: 'Failed to fetch audio' }, { status: 500 });
      const buffer = await audioRes.arrayBuffer();
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': audioRes.headers.get('content-type') || 'audio/mpeg',
          'Content-Length': String(buffer.byteLength),
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // --- ACTION: Lấy thông tin keys + health + danh sách chết ---
    if (action === 'get_key_count') {
      const aliveCount = getAliveEntries(allEntries).length;
      const deadReport = getDeadKeyReport(allEntries);
      return NextResponse.json({
        success: true,
        count: allEntries.length,
        alive: aliveCount,
        dead: allEntries.length - aliveCount,
        deadKeys: deadReport,
      });
    }

    // --- ACTION: Reset tất cả dead keys ---
    if (action === 'reset_dead_keys') {
      keyHealthMap.clear();
      console.log('[KEY RESET] Tất cả key health đã được reset.');
      return NextResponse.json({ success: true, message: 'Đã reset tất cả keys' });
    }

    // --- ACTION: Kiểm tra credit tất cả keys ---
    if (action === 'get_credits') {
      const results = await Promise.all(
        allEntries.map(async (entry) => {
          try {
            const res = await fetch(`${API_BASE_URL}/v1/credits`, {
              headers: { 'xi-api-key': entry.api_key },
              signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) return { label: entry.label, credits: -1, error: `HTTP ${res.status}` };
            const data = await res.json();
            return { label: entry.label, credits: data.credits ?? 0, error: null };
          } catch (err: any) {
            return { label: entry.label, credits: -1, error: err.message };
          }
        })
      );
      const totalCredits = results.reduce((sum, r) => sum + (r.credits > 0 ? r.credits : 0), 0);
      return NextResponse.json({ success: true, keys: results, totalCredits });
    }

    // --- ACTION: Ước tính chi phí ---
    if (action === 'estimate_cost') {
      try {
        const baseAmount = Number(body.baseAmount || 0);
        const withTranscript = Boolean(body?.options?.with_transcript);
        const withLoudnorm = Boolean(body?.options?.with_loudnorm);
        let cost = Math.ceil(baseAmount * 0.35);
        if (withTranscript) cost = Math.ceil(cost * 1.15);
        if (withLoudnorm) cost = Math.ceil(cost * 1.15);
        return NextResponse.json({ success: true, cost });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
      }
    }

    // --- ACTION: Nhân bản giọng nói ---
    if (action === 'clone_voice') {
      const { entry } = getNextAliveEntry(allEntries);
      // Client gửi file dưới dạng base64
      if (!body.fileBase64 || !body.fileName) {
        return NextResponse.json({ success: false, message: 'Thiếu file audio' }, { status: 400 });
      }

      try {
        // Convert base64 sang buffer
        const base64Data = body.fileBase64.split(',')[1] || body.fileBase64;
        const buffer = Buffer.from(base64Data, 'base64');
        const blob = new Blob([buffer]);

        const formData = new FormData();
        formData.append('file', blob, body.fileName);
        if (body.voiceName) formData.append('voice_name', body.voiceName);
        formData.append('gender_tag', body.genderTag === 'female' ? 'female' : 'male');
        formData.append('preview_text', body.previewText || 'Xin chào, đây là bản mẫu giọng nói.');

        const res = await fetch(`${API_BASE_URL}/v1m/voice/clone`, {
          method: 'POST',
          headers: { 'xi-api-key': entry.api_key },
          body: formData,
          signal: AbortSignal.timeout(120000), // 2 phút cho upload
        });

        const data = await res.json();
        if (res.ok) markKeySuccess(entry.api_key, entry.label);
        else markKeyFailure(entry.api_key, data.message || 'Clone failed', entry.label);

        return NextResponse.json(data, { status: res.status });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: `[${entry.label}] Lỗi clone: ${err.message}` }, { status: 500 });
      }
    }

    // --- ACTION: Nghe thử giọng (tạo sample ngắn) ---
    if (action === 'preview_voice') {
      const { entry } = getNextAliveEntry(allEntries);
      const sampleText = body.sampleText || 'Xin chào, đây là giọng đọc mẫu. Hello, this is a voice preview sample.';

      try {
        // Tạo TTS ngắn
        const res = await fetch(`${API_BASE_URL}/v1m/task/text-to-speech`, {
          method: 'POST',
          headers: { 'xi-api-key': entry.api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: sampleText,
            model: 'speech-2.6-hd',
            language_boost: 'Auto',
            with_transcript: false,
            voice_setting: {
              voice_id: body.voiceId,
              vol: 1.0,
              pitch: 0,
              speed: 1.0,
            },
          }),
          signal: AbortSignal.timeout(30000),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          return NextResponse.json({ success: false, message: data.message || 'Không thể tạo preview' }, { status: 500 });
        }

        // Poll nhanh để lấy audio URL
        const jobId = data.task_id || data.job_id;
        let audioUrl = '';
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const pollRes = await fetch(`${API_BASE_URL}/v1/task/${jobId}`, {
            headers: { 'xi-api-key': entry.api_key },
            signal: AbortSignal.timeout(10000),
          });
          const pollData = await pollRes.json();
          if (pollData?.status === 'done') {
            audioUrl = pollData?.metadata?.audio_url || pollData?.metadata?.output_uri || '';
            break;
          }
          if (pollData?.status === 'error') {
            return NextResponse.json({ success: false, message: 'Tạo preview thất bại' }, { status: 500 });
          }
        }

        if (!audioUrl) {
          return NextResponse.json({ success: false, message: 'Timeout khi tạo preview' }, { status: 500 });
        }

        markKeySuccess(entry.api_key, entry.label);
        return NextResponse.json({ success: true, audioUrl });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    // --- ACTION: Xóa giọng đã nhân bản ---
    if (action === 'delete_voice') {
      const { entry } = getNextAliveEntry(allEntries);
      try {
        const res = await fetch(`${API_BASE_URL}/v1m/voice/clone/${body.voiceId}`, {
          method: 'DELETE',
          headers: { 'xi-api-key': entry.api_key },
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    // --- ACTION: Đổi tên giọng ---
    if (action === 'rename_voice') {
      try {
        return NextResponse.json({
          success: false,
          message: 'API ai33 hiện chưa hỗ trợ đổi tên clone voice trực tiếp.',
        }, { status: 400 });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });

  } catch (error: any) {
    console.error('[Voice API Error]:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
