import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const { text, userId, sessionId, provider } = await req.json();

    if (!text || !userId || !sessionId) {
      return NextResponse.json({ error: 'Thiếu thông tin xác thực hoặc văn bản.' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'Unknown';

    // 1. Lấy thông tin Profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('email, status, current_session_id, role, api_keys')
      .eq('id', userId)
      .single();

    if (profileError || !profile) return NextResponse.json({ error: 'Tài khoản không tồn tại.' }, { status: 404 });

    // 2. Bảo mật
    if (profile.status === 'pending') return NextResponse.json({ error: 'Tài khoản đang chờ duyệt.' }, { status: 403 });
    if (profile.status === 'blocked') return NextResponse.json({ error: 'Tài khoản bị chặn vì lý do bảo mật.' }, { status: 403 });
    if (profile.current_session_id !== sessionId) return NextResponse.json({ error: 'Phiên làm việc hết hạn.' }, { status: 401 });

  // 3. Log IP & Check Auto-block
    const { data: existingLogs } = await supabaseAdmin.from('login_history').select('ip_address').eq('user_id', userId);
    const uniqueIps = new Set(existingLogs?.map(l => l.ip_address) || []);
    if (!uniqueIps.has(ip)) {
      await supabaseAdmin.from('login_history').insert({ user_id: userId, ip_address: ip, user_agent: userAgent });
      uniqueIps.add(ip);
      if (uniqueIps.size > 3 && profile.role !== 'admin') {
        await supabaseAdmin.from('profiles').update({ status: 'blocked' }).eq('id', userId);
        return NextResponse.json({ error: 'Tài khoản bị chặn vì lý do bảo mật' }, { status: 403 });
      }
    }

    // 4. PROMPT: GIỮ NGUYÊN BẢN 100% (KHÔNG BIẾN TẤU)
    const prompt = `
      NHIỆM VỤ: Làm sạch đoạn transcript thô dưới đây.
      
      YÊU CẦU BẮT BUỘC:
      1. GIỮ NGUYÊN 100% CÂU TỪ GỐC: Tuyệt đối không được thay đổi văn phong, không thêm thắt nội dung, KHÔNG biến tấu thành truyện kể.
      2. Chỉ xóa toàn bộ các mốc thời gian (timestamp) như 00:00, [12:34], v.v.
      3. Chỉ sửa các lỗi chính tả hoặc lỗi nối câu phát sinh do việc ngắt dòng của timestamp gây ra để đảm bảo mạch văn tự nhiên.
      4. Kết quả phải là văn bản liền mạch, không chia chương, không chia mục.

      Văn bản gốc:
      ${text}
    `;

    // 5. Xử lý AI & Lấy Key từ Kho Khóa Tổng (api_vault) nếu cần
    let cleanedText = "";
    const apiKeys = profile.api_keys || {};
    let finalKey = "";

    if (provider === 'openai') {
      finalKey = apiKeys.openai || "";
      if (!finalKey) {
        // Thử lấy từ Kho Khóa Tổng
        const { data: vault } = await supabaseAdmin.from('api_vault').select('api_key').eq('provider', 'openai').single();
        finalKey = vault?.api_key || "";
      }
      if (!finalKey) return NextResponse.json({ error: 'Chưa có API Key ChatGPT.' }, { status: 403 });
      
      const openai = new OpenAI({ apiKey: finalKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });
      cleanedText = response.choices[0]?.message?.content || "";
    } else {
      finalKey = apiKeys.gemini || "";
      if (!finalKey) {
        const { data: vault } = await supabaseAdmin.from('api_vault').select('api_key').eq('provider', 'gemini').single();
        finalKey = vault?.api_key || "";
      }
      if (!finalKey) return NextResponse.json({ error: 'Chưa có API Key Gemini.' }, { status: 403 });

      const ai = new GoogleGenAI({ apiKey: finalKey.trim() });
      const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
      cleanedText = response.text;
    }

    // 6. CẬP NHẬT GIÁM SÁT & GHI LỊCH SỬ THỜI GIAN THỰC
    // Cập nhật trạng thái hoạt động của nhân viên
    await supabaseAdmin.from('profiles').update({
      last_active_at: new Date().toISOString(),
      current_ip: ip
    }).eq('id', userId);

    // Ghi nhật ký làm việc chi tiết kèm IP
    await supabaseAdmin.from('cleaning_history').insert({
      user_id: userId,
      user_email: profile.email,
      input_content: text,
      output_content: cleanedText.trim(),
      provider: provider,
      char_count: text.length,
      ip_address: ip
    });

    // Ghi log usage thống kê
    await supabaseAdmin.from('usage_logs').insert({
      user_id: userId,
      user_email: profile.email,
      char_count: text.length,
      tool_name: `Làm sạch (${provider})`
    });

    return NextResponse.json({ result: cleanedText.trim() });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Lỗi hệ thống AI', details: error.message }, { status: 500 });
  }
}
