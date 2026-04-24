import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { OpenAI } from 'openai';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

type PodcastRole = {
  id: string;
  name: string;
  roleType: 'Host' | 'Doctor' | 'Guest';
  selected: boolean;
  gender: 'Nam' | 'Nữ';
};

type DialogueLine = {
  speaker: string;
  text: string;
  roleType: 'Host' | 'Doctor' | 'Guest';
};

const supabaseAdmin = createSupabaseAdminClient();

const chunkText = (text: string, maxLength: number = 2500): string[] => {
  const paragraphs = text.split(/\n+/);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if ((current + para).length > maxLength && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += para + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dialogueCharCount = (lines: DialogueLine[]) =>
  lines.reduce((sum, line) => sum + String(line.text || '').length, 0);

const renderDialogueDraft = (lines: DialogueLine[]) =>
  lines.map((line) => `${line.speaker}: ${line.text}`).join('\n');

function mergeFragmentedLines(lines: DialogueLine[]): DialogueLine[] {
  const merged: DialogueLine[] = [];
  for (const line of lines) {
    if (merged.length === 0) {
      merged.push(line);
      continue;
    }
    const prev = merged[merged.length - 1];
    const prevText = String(prev.text || '').trim();
    const curText = String(line.text || '').trim();
    const prevLooksComplete = /[.!?…:;”"')\]]$/.test(prevText);
    const shouldMerge =
      prev.speaker === line.speaker &&
      (!prevLooksComplete || prevText.length < 55 || curText.length < 35);

    if (shouldMerge) {
      prev.text = `${prevText} ${curText}`.replace(/\s+/g, ' ').trim();
    } else {
      merged.push(line);
    }
  }
  return merged;
}

async function resolveProviderKey(profile: any, provider: 'gemini' | 'openai') {
  const apiKeys = profile.api_keys || {};
  if (provider === 'openai') {
    const direct = apiKeys.openai || '';
    if (direct) return direct;
    const { data: vault } = await supabaseAdmin
      .from('api_vault')
      .select('api_key')
      .eq('provider', 'openai')
      .single();
    return vault?.api_key || '';
  }

  const direct = apiKeys.gemini || '';
  if (direct) return direct;
  const { data: vault } = await supabaseAdmin
    .from('api_vault')
    .select('api_key')
    .eq('provider', 'gemini')
    .single();
  return vault?.api_key || '';
}

function cleanDialogueLines(lines: any[]): DialogueLine[] {
  const cleaned = lines
    .map((line) => ({
      speaker: String(line?.speaker || '').trim(),
      text: String(line?.text || '')
        .replace(/\r?\n|\r/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      roleType: line?.roleType === 'Doctor' || line?.roleType === 'Guest' ? line.roleType : 'Host',
    }))
    .filter((line) => line.speaker && line.text);
  return mergeFragmentedLines(cleaned);
}

async function generateWithGemini(
  key: string,
  prompt: string,
  systemInstruction: string
): Promise<DialogueLine[]> {
  const ai = new GoogleGenAI({ apiKey: key.trim() });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            speaker: { type: Type.STRING },
            text: { type: Type.STRING },
            roleType: { type: Type.STRING, enum: ['Host', 'Doctor', 'Guest'] },
          },
          required: ['speaker', 'text', 'roleType'],
        },
      },
    },
  });
  const raw = response.text || '[]';
  const parsed = JSON.parse(raw);
  const lines = Array.isArray(parsed) ? parsed : [];
  return cleanDialogueLines(lines);
}

async function generateWithOpenAI(
  key: string,
  prompt: string,
  systemInstruction: string
): Promise<DialogueLine[]> {
  const client = new OpenAI({ apiKey: key.trim() });
  const completion = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemInstruction },
      {
        role: 'user',
        content:
          `${prompt}\n\nReturn JSON exactly as: {"lines":[{"speaker":"...","text":"...","roleType":"Host|Doctor|Guest"}]}`,
      },
    ],
  });
  const raw = completion.choices[0]?.message?.content || '{"lines":[]}';
  const parsed = JSON.parse(raw);
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  return cleanDialogueLines(lines);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputText = String(body?.text || '').trim();
    const title = String(body?.title || '').trim().slice(0, 180);
    const userId = String(body?.userId || '');
    const provider: 'gemini' | 'openai' = body?.provider === 'openai' ? 'openai' : 'gemini';
    const roles = Array.isArray(body?.roles) ? (body.roles as PodcastRole[]) : [];

    if (!inputText || !userId) {
      return NextResponse.json({ error: 'Thiếu nội dung hoặc userId.' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, status, api_keys')
      .eq('id', userId)
      .single();
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Tài khoản không tồn tại.' }, { status: 404 });
    }
    if (profile.status !== 'approved') {
      return NextResponse.json({ error: 'Tài khoản chưa được duyệt.' }, { status: 403 });
    }

    const activeRoles = roles.filter((r) => r.selected);
    if (activeRoles.length === 0) {
      return NextResponse.json({ error: 'Cần ít nhất 1 nhân vật.' }, { status: 400 });
    }

    const key = await resolveProviderKey(profile, provider);
    if (!key) {
      return NextResponse.json(
        { error: provider === 'openai' ? 'Chưa cấu hình API key OpenAI.' : 'Chưa cấu hình API key Gemini.' },
        { status: 403 }
      );
    }

    const chunks = chunkText(inputText, 2500);

    // Detect the language of the input so the AI outputs in the same language.
    // We sample the first 300 chars, ask the AI to name the language (ISO name, e.g. "Japanese", "Vietnamese", "English").
    // We embed this detected language explicitly into every prompt so the model cannot drift to Vietnamese.
    let detectedLanguage = 'the same language as the source text';
    try {
      const langAi = new GoogleGenAI({ apiKey: key.trim() });
      const langRes = await langAi.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Identify the language of the following text and reply with ONLY the language name in English (e.g. "Japanese", "Vietnamese", "English", "Korean"). Text: """${inputText.slice(0, 300)}"""`,
      });
      const raw = (langRes.text || '').trim().replace(/[^a-zA-Z]/g, '');
      if (raw.length > 2 && raw.length < 40) detectedLanguage = raw;
    } catch {
      // fallback: keep generic instruction
    }

    const roleGuide = activeRoles
      .map((r) => {
        const roleLabel = r.roleType === 'Host' ? 'Host' : r.roleType === 'Doctor' ? 'Doctor' : 'Guest';
        return `${roleLabel}: name is ${r.name}, gender ${r.gender}.`;
      })
      .join('\n');
    const isMonologue = activeRoles.length === 1;
    const firstRole = activeRoles[0];
    const systemInstruction = isMonologue
      ? `You are a professional podcast editor. Convert the source content into a natural monologue.
Main speaker: ${firstRole.name}.
Rules:
1. ALWAYS write the entire output in ${detectedLanguage}. Do NOT translate or switch languages under any circumstances.
2. Never say "according to the text", "as mentioned above", or "as given".
3. Treat the content as the speaker's own knowledge and story.
4. Greet the audience only once in the very first chunk; do not repeat in subsequent chunks.
`
      : `You are a professional podcast scriptwriter. Convert the source content into a natural multi-character dialogue.
Character list:
${roleGuide}
Rules:
1. ALWAYS write the entire output in ${detectedLanguage}. Do NOT translate or switch languages under any circumstances.
2. Never say "according to the text", "as mentioned above", or "as given".
3. Retell the content so listeners don't need to read the source.
4. Greet the audience only once in the very first chunk; do not repeat in subsequent chunks.
5. Gender is only for character context, not to enforce rigid speech patterns.
6. The Host always refers to themselves by their name and addresses the Doctor formally when discussing professional topics.
7. The Doctor always addresses the Host by name and refers to themselves in first person consistently.
`;

    const finalLines: DialogueLine[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const prompt = `Source content:
"""${chunk}"""

Constraints:
- Output language: ${detectedLanguage}. Every word of dialogue MUST be in ${detectedLanguage}.
- ${isFirst ? 'Open naturally with a brief greeting.' : 'Do NOT re-greet or re-introduce the show.'}
- ${isLast ? 'End with a short summary/closing.' : 'End openly so the next chunk connects naturally.'}
- Do not omit important points. Every key argument, event, or instruction in the source chunk must appear in the dialogue.
- Preserve the full logical flow: cause -> development -> conclusion (if present).
- Do not over-summarise; completeness is more important than brevity.
- Each turn must be a complete sentence or paragraph; do not split one idea into many consecutive lines by the same speaker.
- Adapt naturally — do NOT copy source sentences verbatim.
`;

      let lines: DialogueLine[] = [];
      let lastError = '';
      const minChunkChars = Math.max(450, Math.floor(chunk.length * (isMonologue ? 0.82 : 0.72)));
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          lines =
            provider === 'openai'
              ? await generateWithOpenAI(key, prompt, systemInstruction)
              : await generateWithGemini(key, prompt, systemInstruction);
          if (lines.length > 0 && dialogueCharCount(lines) >= minChunkChars) break;
          if (lines.length > 0 && attempt < 4) {
            // Có output nhưng còn ngắn: thử lại để phủ đủ ý hơn.
            await wait(900 * attempt);
          }
        } catch (e: any) {
          lastError = e?.message || 'AI generation failed';
          if (attempt < 4) await wait(1200 * attempt);
        }
      }
      if (lines.length === 0) {
        return NextResponse.json({ error: `Không tạo được kịch bản ở phần ${i + 1}. ${lastError}` }, { status: 500 });
      }

      // Pass mở rộng có kiểm soát nếu chunk vẫn bị co quá mức.
      if (dialogueCharCount(lines) < minChunkChars) {
        const expandPrompt = `Source content:
"""${chunk}"""

Current adaptation:
"""${renderDialogueDraft(lines)}"""

Rewrite the dialogue to be more complete:
- Output language: ${detectedLanguage}. Every word MUST be in ${detectedLanguage}.
- Keep the same characters and style.
- Do not omit important details from the source.
- Do not over-summarise.
- Each turn must be coherent; do not split one sentence into multiple lines by the same speaker.
- Do not copy source text verbatim; rephrase naturally as dialogue.
- Minimum total dialogue text length: approximately ${minChunkChars} characters.
`;
        try {
          const expanded =
            provider === 'openai'
              ? await generateWithOpenAI(key, expandPrompt, systemInstruction)
              : await generateWithGemini(key, expandPrompt, systemInstruction);
          if (dialogueCharCount(expanded) > dialogueCharCount(lines)) {
            lines = expanded;
          }
        } catch {
          // Giữ output cũ nếu pass mở rộng lỗi.
        }
      }

      finalLines.push(...lines);
      await wait(350);
    }

    const { data: historyRow, error: historyError } = await supabaseAdmin
      .from('prompt_history')
      .insert({
        user_id: userId,
        user_email: profile.email,
        input_transcript: inputText,
        results: finalLines,
        genre: title ? `Podcast: ${title}` : 'Podcast',
        style: 'podcast',
        nationality: 'auto',
        provider,
        ip_address: ip,
      })
      .select('*')
      .single();
    if (historyError) {
      return NextResponse.json({ error: `Lỗi lưu lịch sử podcast: ${historyError.message}` }, { status: 500 });
    }

    await supabaseAdmin.from('usage_logs').insert({
      user_id: userId,
      user_email: profile.email,
      tool_name: title ? `Tạo kịch bản Podcast (${provider}) | ${title}` : `Tạo kịch bản Podcast (${provider})`,
      char_count: inputText.length,
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
      history: historyRow,
      results: finalLines,
      provider,
      model: provider === 'openai' ? 'gpt-4.1-mini' : 'gemini-2.5-flash',
      title,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Podcast API error' }, { status: 500 });
  }
}
