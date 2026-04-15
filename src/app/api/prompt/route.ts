import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from "@google/genai";
import { OpenAI } from "openai";
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    const { segments, userId, genre, style, nationality, provider, isFinal, fullTranscript, allResults } = await req.json();

    if (!userId) return NextResponse.json({ error: 'Thiếu UserId' }, { status: 400 });

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    if (!profile || profile.status !== 'approved') return NextResponse.json({ error: 'Truy cập bị từ chối' }, { status: 403 });

    // Lấy API Key
    const apiKeys = profile.api_keys || {};
    let finalKey = "";
    if (provider === 'openai') {
      finalKey = apiKeys.openai || (await supabaseAdmin.from('api_vault').select('api_key').eq('provider', 'openai').single()).data?.api_key;
    } else {
      finalKey = apiKeys.gemini || (await supabaseAdmin.from('api_vault').select('api_key').eq('provider', 'gemini').single()).data?.api_key;
    }
    if (!finalKey) return NextResponse.json({ error: 'Chưa cấu hình API Key' }, { status: 403 });

    // CASE 1: Chỉ lưu lịch sử khi hoàn tất
    if (isFinal && fullTranscript && allResults) {
      await supabaseAdmin.from('prompt_history').insert({
        user_id: userId,
        user_email: profile.email,
        input_transcript: fullTranscript,
        results: allResults,
        genre: genre,
        style: style,
        nationality: nationality,
        provider: provider,
        ip_address: ip
      });

      await supabaseAdmin.from('usage_logs').insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `Hoàn tất Prompt Video (${style})`,
        provider: provider,
        ip_address: ip
      });

      return NextResponse.json({ success: true });
    }

    // CASE 2: Xử lý tạo prompt cho cụm segments hiện tại
    if (!segments || segments.length === 0) return NextResponse.json({ results: [] });

    const systemInstruction = `You are the "Veo3 Cinematic Masterpiece Engine," a world-class specialist in Prompt Engineering for Google's Veo AI.

GOAL: Convert transcripts into extremely hyper-detailed, photorealistic 8k video prompts.

CORE RULES for HIGH QUALITY:
1. BE VISUAL & DENSE: Each prompt must be 100-150 words. Describe everything: 
   - Lighting: Volumetric lighting, anamorphic flares, soft clinical glow, golden hour, or high-contrast studio setup.
   - Textures: Pores on skin, micro-scratches on surgical steel, steam rising, microscopic anatomical details.
   - Camera: Macro shots, 50mm cinematic lens, slow-motion pans, slider shots, extreme close-up, shallow depth of field.
2. MEDICAL ACCURACY & SAFETY: 
   - Focusing on clinical precision. 
   - AVOID BLOOD AND GORE: To prevent safety filter violations, describe surgical scenes as "clean clinical procedures," using metaphoric professional terminology or focusing on the technology/equipment. 
   - No graphic violence. Content must be professional and safe for a premium corporate/medical environment.
3. NO SPEAKERS/METAPHORS: Never describe the person speaking. Focus strictly on the literal visual subject of the text. No text overlays or watermarks.

NATIONALITY & CULTURE:
Ensure architecture, facial features, healthcare settings, and objects are authentic to ${nationality}.

OUTPUT: Return ONLY the structured JSON with detailed English descriptions.

Genre: ${genre} | Style: ${style} | Nationality: ${nationality}`;

    let results = [];

    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey: finalKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Segments: ${JSON.stringify(segments)}. Generate JSON { "results": [{"id": number, "prompt": "string"}] }` }
        ],
        response_format: { type: "json_object" }
      });
      const json = JSON.parse(response.choices[0].message?.content || '{"results":[]}');
      results = json.results || [];
    } else {
      const ai = new GoogleGenAI({ apiKey: finalKey });
      const model = ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ parts: [{ text: `Segments: ${JSON.stringify(segments)}. Generate prompts. Return JSON { "results": [{ "segmentIndex": number, "prompt": "string" }] }` }] }],
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              results: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    segmentIndex: { type: Type.INTEGER },
                    prompt: { type: Type.STRING }
                  },
                  required: ["segmentIndex", "prompt"]
                }
              }
            },
            required: ["results"]
          }
        }
      });
      const resText = (await model).text || '{"results":[]}';
      const json = JSON.parse(resText);
      results = json.results.map((r: any) => ({ id: r.segmentIndex, prompt: r.prompt }));
    }

    // Cập nhật hoạt động cuối
    await supabaseAdmin.from('profiles').update({ last_active_at: new Date().toISOString(), current_ip: ip }).eq('id', userId);

    return NextResponse.json({ results });

  } catch (error: any) {
    console.error('Prompt API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
