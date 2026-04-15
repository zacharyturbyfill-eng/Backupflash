import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { OpenAI } from 'openai';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = createSupabaseAdminClient();
type ModelProvider = 'gemini' | 'openai';

const getSystemInstruction = (settings: any) => {
  return `Bạn là chuyên gia viết prompt cho video Veo 3. 
  
  TUÂN THỦ TUYỆT ĐỐI CÁC THIẾT LẬP SAU CHO MỌI PROMPT:
  - QUỐC GIA: ${settings.country}. Mọi chi tiết về con người, trang phục, kiến trúc, đồ vật, bối cảnh PHẢI mang đậm nét đặc trưng của quốc gia này. KHÔNG ĐƯỢC PHÉP pha trộn yếu tố của quốc gia khác (ví dụ: nếu là Nhật Bản, không được có yếu tố Việt Nam).
  - PHONG CÁCH: ${settings.style}. Mọi prompt phải tuân thủ nghiêm ngặt phong cách đồ họa này.
  - THỂ LOẠI: ${settings.category}. Nội dung phải phù hợp với thể loại này.
  
  QUY TẮC QUAN TRỌNG:
  1. TẢ THỰC (LITERAL): Lời thoại nói về cái gì, hãy hiện ra cái đó. Không dùng hình ảnh trừu tượng hay ẩn dụ.
  2. KHÔNG HIỆN NGƯỜI NÓI: Tuyệt đối không mô tả bác sĩ, người dẫn chương trình hay studio. Chỉ mô tả cảnh vật, đồ vật liên quan đến nội dung.
  3. CÂU LỆNH ĐƠN GIẢN: Mô tả rõ ràng "Cảnh quay cận cảnh (close-up) vào...", "Góc máy từ trên xuống (top-down) thấy...", "Máy quay đi chậm qua...".
  4. ÁNH SÁNG TỰ NHIÊN: Phù hợp với phong cách đã chọn.
  5. KHÔNG CHỮ: Không bao giờ có chữ viết trong video.
  6. KHÔNG DÙNG TRANSCRIPT: Tuyệt đối không đưa nội dung lời thoại (transcript) vào prompt. Chỉ mô tả hình ảnh.
  
  Mục tiêu: Người xem nhìn vào video phải thấy ngay sự liên quan trực tiếp đến câu nói và bối cảnh quốc gia/phong cách đã chọn.`;
};

async function getProviderKeyForUser(userId: string, provider: ModelProvider) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, status, api_keys')
    .eq('id', userId)
    .single();
  if (error || !profile) return { error: 'Tài khoản không tồn tại.', profile: null as any, key: '' };
  if (profile.status !== 'approved') return { error: 'Tài khoản chưa được duyệt.', profile, key: '' };

  const apiKeys = profile.api_keys || {};
  let key = provider === 'openai' ? apiKeys.openai || '' : apiKeys.gemini || '';
  if (!key) {
    const { data: vault } = await supabaseAdmin
      .from('api_vault')
      .select('api_key')
      .eq('provider', provider)
      .single();
    key = vault?.api_key || '';
  }
  if (!key) {
    return {
      error: provider === 'openai' ? 'Chưa cấu hình API key OpenAI.' : 'Chưa cấu hình API key Gemini.',
      profile,
      key: '',
    };
  }

  return { error: '', profile, key };
}

async function generatePromptsBatch(
  provider: ModelProvider,
  apiKey: string,
  segments: Array<{ index: number; relevantContext: string }>,
  localContext: string,
  settings: any,
  retryCount = 0
) {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const segmentsData = segments.map((s) => ({ id: s.index, text: s.relevantContext }));

  const userPrompt = `
  CHỦ ĐỀ CHUNG: ${localContext}
  NHIỆM VỤ: Tạo prompt mô tả hình ảnh CHUYÊN NGHIỆP cho các đoạn sau.
  
  YÊU CẦU BẮT BUỘC (PHẢI CÓ TRONG MỌI PROMPT):
  - Bối cảnh (Setting): Phải mô tả rõ ràng bối cảnh mang đậm nét đặc trưng của quốc gia ${settings.country}.
  - Phong cách (Style): Phải đúng với phong cách ${settings.style}.
  - Thể loại (Category): Phải đúng với thể loại ${settings.category}.
  - Ánh sáng (Lighting): Phù hợp với phong cách ${settings.style}.
  - Chủ thể (Subject): Mô tả chi tiết đối tượng chính.
  - Góc máy (Camera Angle): Mô tả góc máy.
  - Nhân vật (Characters): Nếu có, mô tả ngoại hình, hành động phù hợp với quốc gia ${settings.country}.
  
  LƯU Ý QUAN TRỌNG: 
  1. TRONG MỖI PROMPT, BẮT BUỘC phải nhắc đến các từ khóa hoặc chi tiết mô tả đặc trưng của quốc gia ${settings.country} và phong cách ${settings.style}.
  2. TUYỆT ĐỐI KHÔNG ĐƯỢC ĐƯA NỘI DUNG LỜI THOẠI (TRANSCRIPT) VÀO PROMPT. Chỉ mô tả hình ảnh.
  3. KHÔNG ĐƯỢC PHÉP sử dụng các từ khóa mặc định như "Realistic", "Vietnamese" nếu không được yêu cầu. Chỉ sử dụng đúng giá trị được thiết lập: Quốc gia=${settings.country}, Phong cách=${settings.style}.
  
  DỮ LIỆU CẦN TẠO PROMPT: ${JSON.stringify(segmentsData)}
  
  Trả về JSON { "results": [{ "segmentIndex": số, "prompt": "mô tả tiếng Anh chuyên nghiệp" }] }.`;

  try {
    if (provider === 'gemini') {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: getSystemInstruction(settings),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              results: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    segmentIndex: { type: Type.INTEGER },
                    prompt: { type: Type.STRING },
                  },
                  required: ['segmentIndex', 'prompt'],
                },
              },
            },
            required: ['results'],
          },
        },
      });
      const text = response.text || '{"results":[]}';
      const json = JSON.parse(text);
      return json.results || [];
    }

    const client = new OpenAI({ apiKey: apiKey.trim() });
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: getSystemInstruction(settings) },
        {
          role: 'user',
          content:
            `${userPrompt}\n\nTrả về JSON đúng format: {"results":[{"segmentIndex":1,"prompt":"..."}]}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content || '{"results":[]}';
    const json = JSON.parse(raw);
    return Array.isArray(json?.results) ? json.results : [];
  } catch (error: any) {
    if ((error.status === 500 || error.message?.includes('500')) && retryCount < 2) {
      await new Promise((r) => setTimeout(r, 1000));
      return generatePromptsBatch(provider, apiKey, segments, localContext, settings, retryCount + 1);
    }
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || '');
    const userId = String(body?.userId || '');
    const provider: ModelProvider = body?.provider === 'openai' ? 'openai' : 'gemini';
    if (!userId) return NextResponse.json({ error: 'Thiếu userId.' }, { status: 400 });

    const { error, profile, key } = await getProviderKeyForUser(userId, provider);
    if (error) return NextResponse.json({ error }, { status: 403 });

    if (action === 'generate_batch') {
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      const settings = body?.settings || {};
      const localContext = String(body?.localContext || '');
      const results = await generatePromptsBatch(provider, key, segments, localContext, settings);
      return NextResponse.json({ success: true, results });
    }

    if (action === 'save_history') {
      const transcript = String(body?.transcript || '');
      const settings = body?.settings || {};
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';

      const outputLines = segments
        .filter((s: any) => s?.generatedPrompt)
        .map((s: any) => `${s.index}. ${s.generatedPrompt}`);

      const { data, error: insertError } = await supabaseAdmin
        .from('prompt_history')
        .insert({
          user_id: userId,
          user_email: profile.email,
          input_transcript: transcript,
          results: segments,
          genre: settings.category || 'MEDICAL3',
          style: 'medical3',
          nationality: settings.country || 'VIETNAM',
          provider,
          ip_address: ip,
        })
        .select('*')
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      await supabaseAdmin.from('usage_logs').insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `Tạo Prompt Medical 3.0 (${provider})`,
        char_count: transcript.length,
      });

      await supabaseAdmin
        .from('profiles')
        .update({
          last_active_at: new Date().toISOString(),
          current_ip: ip,
        })
        .eq('id', userId);

      return NextResponse.json({
        success: true,
        history: data,
        output_preview: outputLines.slice(0, 10),
      });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Medical3 API error' }, { status: 500 });
  }
}
