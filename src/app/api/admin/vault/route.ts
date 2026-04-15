import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

function encodeMinimaxLabel(label: string) {
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

        const parsed = parseMinimaxProvider(row.provider);
        if (!parsed) {
          return NextResponse.json({ error: 'Key này không thuộc nhóm ai84.' }, { status: 400 });
        }

        const nextLabel = (label || '').trim();
        const nextProvider = nextLabel
          ? `minimax:${encodeMinimaxLabel(nextLabel)}:${parsed.id}`
          : `minimax:${parsed.id}`;

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
      default:
        return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
