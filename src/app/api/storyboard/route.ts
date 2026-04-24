import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { OpenAI } from 'openai';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = createSupabaseAdminClient();
type ModelProvider = 'gemini' | 'openai';

type SeoPackage = {
  title: string;
  description: string;
  timestamps: string[];
  hashtags: string[];
  keywords: string[];
};
type SeoLanguage = 'vi' | 'ja' | 'ko' | 'en';

// ─── UTILITY ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'va', 'và', 'la', 'là', 'cua', 'của', 'cho', 'trong', 'nhung', 'những', 'mot', 'một',
  'cac', 'các', 'voi', 'với', 'khi', 'sau', 'truoc', 'trước', 'duoc', 'được', 'the', 'thể',
  'nay', 'này', 'do', 'đó', 'co', 'có', 'khong', 'không', 'se', 'sẽ', 'den', 'đến', 'tu', 'từ',
  'tren', 'trên', 'youtube', 'video', 'transcripts', 'transcript',
]);

function parseToSeconds(raw: string): number | null {
  const hhmmss = raw.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (hhmmss) return Number(hhmmss[1]) * 3600 + Number(hhmmss[2]) * 60 + Number(hhmmss[3]);
  const mmss = raw.match(/(\d{2}):(\d{2})/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  return null;
}

function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

function extractDurationSeconds(transcript: string): number {
  const matches = transcript.match(/\d{2}:\d{2}(?::\d{2})?/g) || [];
  let maxSec = 0;
  for (const match of matches) {
    const sec = parseToSeconds(match);
    if (sec && sec > maxSec) maxSec = sec;
  }
  return Math.max(maxSec, 600);
}

function extractTitle(transcript: string): string {
  const lines = transcript.replace(/\r\n/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const found = lines.find((line) => {
    if (/^\(?\d{2}:\d{2}/.test(line)) return false;
    return line.length > 10;
  });
  return (found || 'Character Storyboard Prompts').slice(0, 180);
}

function extractTopTokens(transcript: string, max = 30): string[] {
  const raw = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const count = new Map<string, number>();
  for (const token of raw) count.set(token, (count.get(token) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, max);
}

function detectSeoLanguage(transcript: string): SeoLanguage {
  const text = String(transcript || '');
  if (/[ぁ-んァ-ン一-龯々〆〤]/u.test(text)) return 'ja';
  if (/[가-힣]/u.test(text)) return 'ko';
  if (/[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/u.test(text)) return 'vi';
  return 'en';
}

function languageName(lang: SeoLanguage): string {
  if (lang === 'ja') return 'Japanese';
  if (lang === 'ko') return 'Korean';
  if (lang === 'vi') return 'Vietnamese';
  return 'English';
}

function buildFallbackTimestamps(transcript: string): string[] {
  const duration = extractDurationSeconds(transcript);
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    const sec = Math.floor((duration * i) / 9);
    out.push(`${formatTimestamp(sec)} - Section ${i + 1}`);
  }
  return out;
}

function normalizeSeoPackage(input: any, transcript: string): SeoPackage {
  const topTokens = extractTopTokens(transcript, 40);
  const timestamps = Array.isArray(input?.timestamps) ? input.timestamps : [];
  const hashtags = Array.isArray(input?.hashtags) ? input.hashtags : [];
  const keywords = Array.isArray(input?.keywords) ? input.keywords : [];
  const normalizedTimestamps = timestamps.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 10);
  const normalizedHashtags = hashtags
    .map((h: any) => String(h).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((h: string) => (h.startsWith('#') ? h : `#${h}`));
  const normalizedKeywords = keywords.map((k: any) => String(k).trim()).filter(Boolean);

  while (normalizedHashtags.length < 20 && topTokens.length > normalizedHashtags.length) {
    normalizedHashtags.push(`#${topTokens[normalizedHashtags.length]}`);
  }
  while (normalizedKeywords.length < 20 && topTokens.length > normalizedKeywords.length) {
    normalizedKeywords.push(topTokens[normalizedKeywords.length]);
  }
  while (normalizedHashtags.length < 20) normalizedHashtags.push(`#content${normalizedHashtags.length + 1}`);
  while (normalizedKeywords.length < 20) normalizedKeywords.push(`keyword-${normalizedKeywords.length + 1}`);

  const title = String(input?.title || extractTitle(transcript)).trim().slice(0, 200);
  const description = String(input?.description || '').trim() ||
    `Character Storyboard generated from transcript. Total ${normalizedTimestamps.length} segments.`;

  return {
    title,
    description,
    timestamps: (normalizedTimestamps.length > 0 ? normalizedTimestamps : buildFallbackTimestamps(transcript)).slice(0, 10),
    hashtags: normalizedHashtags.slice(0, 20),
    keywords: normalizedKeywords.slice(0, 20),
  };
}

// ─── API KEY RESOLVER ─────────────────────────────────────────────────────────

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

// ─── SYSTEM INSTRUCTION ───────────────────────────────────────────────────────

const getSystemInstruction = (characterName: string, settings: any) => `
You are a professional visual prompt writer for AI video/image generation (Veo 3, Midjourney, Flux).

CHARACTER RULE — MOST IMPORTANT:
- The main character is named "${characterName}".
- EVERY prompt MUST mention "${characterName}" by name, doing a specific action.
- Keep ${characterName} consistent across all prompts. Same person, different scenes.
- Do NOT describe ${characterName}'s appearance (user will add reference image separately).
  Just name them and describe their action/position/emotion.

STYLE SETTINGS — FOLLOW STRICTLY:
- COUNTRY/SETTING: ${settings.country}. All details (clothes, architecture, objects, environment) must reflect this country's culture. DO NOT mix elements from other countries.
- VISUAL STYLE: ${settings.style}. Every prompt must match this style strictly.
- CONTENT CATEGORY: ${settings.category}.

PROMPT RULES:
1. LITERAL TRANSLATION: What the audio says → show that visually. No abstract metaphors.
2. ALWAYS in English. Never write prompts in other languages.
3. FORMAT per prompt: [Character action] + [Setting/Environment] + [Mood/Lighting] + [Camera angle] + [Style tag]
4. NO TEXT IN FRAME: Never include written text or subtitles in the scene.
5. NO SPEAKER/HOST: Do not show podcasters, interviewers, or talking heads. Show the story visually.
6. CAMERA ANGLES: Use varied angles — close-up, wide shot, over-the-shoulder, aerial, etc.

OUTPUT GOAL: Viewer sees ${characterName} experiencing the story moment-by-moment, in sync with the audio.
`.trim();

// ─── BATCH PROMPT GENERATOR ───────────────────────────────────────────────────

async function generatePromptsBatch(
  provider: ModelProvider,
  apiKey: string,
  geminiModel: string,
  segments: Array<{ index: number; relevantContext: string }>,
  localContext: string,
  characterName: string,
  settings: any,
  retryCount = 0
) {
  const segmentsData = segments.map((s) => ({ id: s.index, text: s.relevantContext }));
  const systemInstruction = getSystemInstruction(characterName, settings);

  const userPrompt = `
OVERALL CONTEXT OF THIS CONTENT (derived from full transcript):
"${localContext}"

TASK: Write one cinematic prompt per segment. ${characterName} must appear in every prompt.

SEGMENTS TO PROCESS:
${JSON.stringify(segmentsData)}

Return JSON: { "results": [{ "segmentIndex": number, "prompt": "english prompt here" }] }
`.trim();

  try {
    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: [{ parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction,
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

    // OpenAI
    const client = new OpenAI({ apiKey: apiKey.trim() });
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `${userPrompt}\n\nReturn JSON: {"results":[{"segmentIndex":1,"prompt":"..."}]}` },
      ],
    });
    const raw = completion.choices[0]?.message?.content || '{"results":[]}';
    const json = JSON.parse(raw);
    return Array.isArray(json?.results) ? json.results : [];
  } catch (error: any) {
    if ((error.status === 500 || error.message?.includes('500')) && retryCount < 2) {
      await new Promise((r) => setTimeout(r, 1000));
      return generatePromptsBatch(provider, apiKey, geminiModel, segments, localContext, characterName, settings, retryCount + 1);
    }
    return [];
  }
}

// ─── SEO ──────────────────────────────────────────────────────────────────────

async function generateSeoByProvider(
  provider: ModelProvider,
  apiKey: string,
  geminiModel: string,
  transcript: string
): Promise<SeoPackage> {
  const prompt = `You are a YouTube SEO expert.
From the transcript below, create a YouTube SEO package and return valid JSON:
{
  "title": "string",
  "description": "engaging intro + 2-3 paragraphs describing content, natural style, no invented facts",
  "timestamps": ["exactly 10 timestamps from start to end, format: 00:00 - short description"],
  "hashtags": ["exactly 20 hashtags starting with #"],
  "keywords": ["exactly 20 SEO keywords"]
}

Rules:
1) Description must be ready to use as YouTube video description.
2) Exactly 10 timestamps distributed from start to end.
3) Exactly 20 hashtags, each starting with #.
4) Exactly 20 keywords, diverse and relevant.
5) Return JSON only, no explanation.

Transcript:
${transcript.slice(0, 120000)}`;

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: apiKey.trim() });
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0]?.message?.content || '{}';
    return normalizeSeoPackage(JSON.parse(raw), transcript);
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          timestamps: { type: Type.ARRAY, items: { type: Type.STRING } },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'timestamps', 'hashtags', 'keywords'],
      },
    },
  });
  const raw = response.text || '{}';
  return normalizeSeoPackage(JSON.parse(raw), transcript);
}

async function translateSeoPackage(
  provider: ModelProvider,
  apiKey: string,
  geminiModel: string,
  source: SeoPackage,
  targetLang: SeoLanguage
): Promise<SeoPackage> {
  const targetLanguage = languageName(targetLang);
  const prompt = `Translate the following YouTube SEO package into ${targetLanguage}.
Rules:
1) Keep JSON structure exactly: title, description, timestamps, hashtags, keywords.
2) Keep item counts exactly: timestamps=10, hashtags=20, keywords=20.
3) Keep timestamp time values unchanged (e.g. "00:00 - ..."), only translate descriptions.
4) Return JSON only.

Input JSON:
${JSON.stringify(source)}`;

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: apiKey.trim() });
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = completion.choices[0]?.message?.content || '{}';
    return normalizeSeoPackage(JSON.parse(raw), source.description || source.title || '');
  }

  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  const response = await ai.models.generateContent({
    model: geminiModel,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          timestamps: { type: Type.ARRAY, items: { type: Type.STRING } },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'timestamps', 'hashtags', 'keywords'],
      },
    },
  });
  const raw = response.text || '{}';
  return normalizeSeoPackage(JSON.parse(raw), source.description || source.title || '');
}

// ─── POST HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || '');
    const userId = String(body?.userId || '');
    const provider: ModelProvider = body?.provider === 'openai' ? 'openai' : 'gemini';
    const geminiModel: string =
      body?.geminiModel === 'gemini-2.5-flash-lite' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';

    if (!userId) return NextResponse.json({ error: 'Thiếu userId.' }, { status: 400 });

    const { error, profile, key } = await getProviderKeyForUser(userId, provider);
    if (error) return NextResponse.json({ error }, { status: 403 });

    // ── Generate batch prompts ──
    if (action === 'generate_batch') {
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      const settings = body?.settings || {};
      const localContext = String(body?.localContext || '');
      const characterName = String(body?.characterName || 'the main character');
      const results = await generatePromptsBatch(
        provider, key, geminiModel, segments, localContext, characterName, settings
      );
      return NextResponse.json({ success: true, results });
    }

    // ── Generate SEO ──
    if (action === 'generate_seo') {
      const transcript = String(body?.transcript || '');
      if (!transcript.trim()) return NextResponse.json({ error: 'Thiếu transcript để tạo SEO.' }, { status: 400 });
      const seo = await generateSeoByProvider(provider, key, geminiModel, transcript);
      return NextResponse.json({ success: true, seo, lang: detectSeoLanguage(transcript) });
    }

    // ── Translate SEO ──
    if (action === 'translate_seo') {
      const sourceSeo = body?.seo as SeoPackage;
      const targetLang = String(body?.targetLang || 'vi') as SeoLanguage;
      if (!sourceSeo?.title || !Array.isArray(sourceSeo.timestamps))
        return NextResponse.json({ error: 'Thiếu dữ liệu SEO để dịch.' }, { status: 400 });
      if (!['vi', 'ja', 'ko', 'en'].includes(targetLang))
        return NextResponse.json({ error: 'Ngôn ngữ dịch không hợp lệ.' }, { status: 400 });
      const translated = await translateSeoPackage(provider, key, geminiModel, sourceSeo, targetLang);
      return NextResponse.json({ success: true, seo: translated, lang: targetLang });
    }

    // ── Save history ──
    if (action === 'save_history') {
      const transcript = String(body?.transcript || '');
      const settings = body?.settings || {};
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      const characterName = String(body?.characterName || '');
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';

      const { data, error: insertError } = await supabaseAdmin
        .from('prompt_history')
        .insert({
          user_id: userId,
          user_email: profile.email,
          input_transcript: transcript,
          results: segments,
          genre: characterName || 'CHARACTER',
          style: 'storyboard',
          nationality: settings.country || 'VIETNAM',
          provider,
          ip_address: ip,
        })
        .select('*')
        .single();

      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

      await Promise.all([
        supabaseAdmin.from('usage_logs').insert({
          user_id: userId,
          user_email: profile.email,
          tool_name: `Character Prompt (${provider}/${geminiModel}) | ${characterName}`,
          char_count: transcript.length,
        }),
        supabaseAdmin.from('profiles').update({
          last_active_at: new Date().toISOString(),
          current_ip: ip,
        }).eq('id', userId),
      ]);

      return NextResponse.json({ success: true, history: data });
    }

    return NextResponse.json({ error: 'Action không hợp lệ.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Storyboard API error' }, { status: 500 });
  }
}
