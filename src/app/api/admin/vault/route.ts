import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

function encodeMinimaxLabel(label: string) {
  const utf8 = encodeURIComponent(label).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return Buffer.from(utf8, 'binary').toString('base64url');
}

function encodeLabel(label: string) {
  const utf8 = encodeURIComponent(label).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return Buffer.from(utf8, 'binary').toString('base64url');
}

function parseMinimaxProvider(provider: string) {
  if (!provider.startsWith('minimax:')) return null;
  const parts = provider.split(':');
  if (parts.length >= 3) {
    return { id: parts.slice(2).join(':'), hasLabel: true };
  }
  if (parts.length === 2) {
    return { id: parts[1], hasLabel: false };
  }
  return null;
}

function parseAi33Provider(provider: string) {
  if (!provider.startsWith('ai33:')) return null;
  const parts = provider.split(':');
  if (parts.length >= 3) {
    return { id: parts.slice(2).join(':'), hasLabel: true };
  }
  if (parts.length === 2) {
    return { id: parts[1], hasLabel: false };
  }
  return null;
}

const PROXY_CONFIG_PROVIDER = 'proxy_config:enabled';

async function checkProxyLive(proxyUrl: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProxyAgent } = require('undici');
  const dispatcher = new ProxyAgent(proxyUrl);
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', {
      dispatcher,
      signal: AbortSignal.timeout(10000),
    } as any);
    if (!ipRes.ok) {
      return { success: false, live: false, error: `IP check HTTP ${ipRes.status}` };
    }
    const ipJson = await ipRes.json();

    const ai84Res = await fetch('https://api.ai84.pro/v1/health-check', {
      dispatcher,
      signal: AbortSignal.timeout(10000),
    } as any);
    const ai84Status = ai84Res.status;

    return {
      success: true,
      live: true,
      egressIp: ipJson?.ip || null,
      ai84Status,
    };
  } catch (error: any) {
    return { success: false, live: false, error: error?.message || 'Proxy check failed' };
  } finally {
    try {
      await dispatcher.close?.();
    } catch {}
  }
}

export async function GET() {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('api_vault')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ items: data || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabaseAdmin = createSupabaseAdminClient();

    switch (body.action) {
      case 'upsert_provider': {
        const { provider, api_key } = body;
        if (!provider || !api_key) {
          return NextResponse.json({ error: 'Thiếu provider hoặc api_key' }, { status: 400 });
        }
        const { error } = await supabaseAdmin
          .from('api_vault')
          .upsert({ provider, api_key }, { onConflict: 'provider' });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ success: true });
      }
      case 'insert_key': {
        const { provider, api_key } = body;
        if (!provider || !api_key) {
          return NextResponse.json({ error: 'Thiếu provider hoặc api_key' }, { status: 400 });
        }
        const { error } = await supabaseAdmin.from('api_vault').insert({ provider, api_key });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ success: true });
      }
      case 'update_label': {
        const { id, label } = body;
        if (!id) {
          return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
        }
        const { data: row, error: rowError } = await supabaseAdmin
          .from('api_vault')
          .select('provider')
          .eq('id', id)
          .single();
        if (rowError || !row) {
          return NextResponse.json({ error: rowError?.message || 'Không tìm thấy key' }, { status: 400 });
        }

        const nextLabel = (label || '').trim();
        const parsedMinimax = parseMinimaxProvider(row.provider);
        const parsedAi33 = parseAi33Provider(row.provider);
        if (!parsedMinimax && !parsedAi33) {
          return NextResponse.json({ error: 'Key này không hỗ trợ ghi chú.' }, { status: 400 });
        }

        const nextProvider = parsedMinimax
          ? (nextLabel
              ? `minimax:${encodeMinimaxLabel(nextLabel)}:${parsedMinimax.id}`
              : `minimax:${parsedMinimax.id}`)
          : (nextLabel
              ? `ai33:${encodeLabel(nextLabel)}:${parsedAi33!.id}`
              : `ai33:${parsedAi33!.id}`);

        const { error } = await supabaseAdmin
          .from('api_vault')
          .update({ provider: nextProvider })
          .eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ success: true });
      }
      case 'delete_key': {
        const { id } = body;
        if (!id) {
          return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
        }
        const { error } = await supabaseAdmin.from('api_vault').delete().eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ success: true });
      }
      case 'set_proxy_enabled': {
        const enabled = Boolean(body.enabled);
        const { error } = await supabaseAdmin
          .from('api_vault')
          .upsert({ provider: PROXY_CONFIG_PROVIDER, api_key: enabled ? 'true' : 'false' }, { onConflict: 'provider' });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ success: true, enabled });
      }
      case 'add_proxy': {
        const proxy_url = String(body.proxy_url || '').trim();
        if (!proxy_url) {
          return NextResponse.json({ error: 'Thiếu proxy_url' }, { status: 400 });
        }
        const provider = `proxy:${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const { error } = await supabaseAdmin.from('api_vault').insert({ provider, api_key: proxy_url });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ success: true });
      }
      case 'check_proxy_live': {
        const proxy_url = String(body.proxy_url || '').trim();
        if (!proxy_url) {
          return NextResponse.json({ error: 'Thiếu proxy_url' }, { status: 400 });
        }
        const result = await checkProxyLive(proxy_url);
        if (!result.success) return NextResponse.json(result, { status: 400 });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
