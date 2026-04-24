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

type LocalizedPrompts = {
  systemInstruction: string;
  chunkOpenPrompt: string;
  chunkMidPrompt: string;
  chunkClosePrompt: string;
  expandPrompt: string;
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
    const prevLooksComplete = /[.!?…:;"\"')\]]$/.test(prevText);
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
    const isMonologue = activeRoles.length === 1;
    const firstRole = activeRoles[0];

    const roleGuideRaw = activeRoles
      .map((r) => {
        const label = r.roleType === 'Host' ? 'Host' : r.roleType === 'Doctor' ? 'Doctor' : 'Guest';
        return `${label}: ${r.name} (${r.gender})`;
      })
      .join(', ');

    // ── Detect ngôn ngữ + sinh tất cả prompt TRỰC TIẾP bằng ngôn ngữ đó (1 call) ──
    // AI nhận instruction bằng ngôn ngữ gốc → tư duy và viết trong 1 ngôn ngữ duy nhất
    // → giữ trọn vẹn sắc thái, từ vựng bản địa, không qua trung gian tiếng Anh.
    let localizedPrompts: LocalizedPrompts | null = null;

    const monologueMetaPrompt =
      'You are a multilingual prompt engineer.\n' +
      'Step 1 - Identify the language of the sample text below.\n' +
      'Step 2 - In THAT SAME LANGUAGE, produce exactly 5 JSON fields (no markdown, no extra keys):\n' +
      '{\n' +
      '  "systemInstruction": "<system instruction for a podcast AI: act as professional podcast editor, convert source into natural monologue spoken by ' + firstRole.name + ', never reference the source text directly, treat content as the speaker own knowledge, greet audience only once at very start>",\n' +
      '  "chunkOpenPrompt": "<user prompt for OPENING chunk: source placeholder [[SOURCE]], open naturally with brief greeting, cover all key points completely, each turn a full coherent sentence or paragraph, adapt naturally not verbatim>",\n' +
      '  "chunkMidPrompt": "<user prompt for MIDDLE chunk: source placeholder [[SOURCE]], no re-greeting, end open to connect next segment, cover all key points, each turn complete, adapt naturally not verbatim>",\n' +
      '  "chunkClosePrompt": "<user prompt for CLOSING chunk: source placeholder [[SOURCE]], no re-greeting, end with warm closing or summary, cover all key points, each turn complete, adapt naturally not verbatim>",\n' +
      '  "expandPrompt": "<user prompt to expand a too-short dialogue: source placeholder [[SOURCE]], current draft placeholder [[DRAFT]], minimum chars placeholder [[MIN_CHARS]], keep same speaker and style, no omissions, not verbatim, each turn coherent>"\n' +
      '}\n' +
      'All 5 values MUST be written entirely in the detected language. Do NOT use English inside the values.\n' +
      'Sample text: """' + inputText.slice(0, 400) + '"""';

    const dialogueMetaPrompt =
      'You are a multilingual prompt engineer.\n' +
      'Step 1 - Identify the language of the sample text below.\n' +
      'Step 2 - In THAT SAME LANGUAGE, produce exactly 5 JSON fields (no markdown, no extra keys):\n' +
      '{\n' +
      '  "systemInstruction": "<system instruction for a podcast AI: act as professional podcast scriptwriter, convert source into natural multi-character dialogue, characters: ' + roleGuideRaw + ', never reference the source text directly, retell so listeners do not need the source, greet audience only once at very start, gender is context only not rigid speech, include all character-specific speaking style rules>",\n' +
      '  "chunkOpenPrompt": "<user prompt for OPENING chunk: source placeholder [[SOURCE]], open naturally with brief greeting, cover all key points completely, each turn a full coherent sentence or paragraph, adapt naturally not verbatim>",\n' +
      '  "chunkMidPrompt": "<user prompt for MIDDLE chunk: source placeholder [[SOURCE]], no re-greeting, end open to connect next segment, cover all key points, each turn complete, adapt naturally not verbatim>",\n' +
      '  "chunkClosePrompt": "<user prompt for CLOSING chunk: source placeholder [[SOURCE]], no re-greeting, end with warm closing or summary, cover all key points, each turn complete, adapt naturally not verbatim>",\n' +
      '  "expandPrompt": "<user prompt to expand a too-short dialogue: source placeholder [[SOURCE]], current draft placeholder [[DRAFT]], minimum chars placeholder [[MIN_CHARS]], keep same characters and style, no omissions, not verbatim, each turn coherent>"\n' +
      '}\n' +
      'All 5 values MUST be written entirely in the detected language. Do NOT use English inside the values.\n' +
      'Sample text: """' + inputText.slice(0, 400) + '"""';

    try {
      const metaAi = new GoogleGenAI({ apiKey: key.trim() });
      const metaRes = await metaAi.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: isMonologue ? monologueMetaPrompt : dialogueMetaPrompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(metaRes.text || '{}');
      if (parsed.systemInstruction && parsed.chunkOpenPrompt) {
        localizedPrompts = parsed as LocalizedPrompts;
      }
    } catch {
      // fallback bên dưới sẽ xử lý
    }

    // ── Fallback: nếu localize thất bại, dùng prompt tiếng Việt gốc ──
    const roleGuide = activeRoles
      .map((r) => {
        const roleLabel = r.roleType === 'Host' ? 'MC' : r.roleType === 'Doctor' ? 'Bác sĩ' : 'Khách mời';
        return `${roleLabel}: tên ${r.name}, giới tính ${r.gender}.`;
      })
      .join('\n');

    const systemInstruction =
      localizedPrompts?.systemInstruction ??
      (isMonologue
        ? `Bạn là biên tập viên podcast chuyên nghiệp. Viết thành độc thoại tự nhiên.\nVai chính: ${firstRole.name}.\nYêu cầu:\n1. Không nói "theo văn bản", "đoạn trên", "nội dung đã cho".\n2. Xem nội dung là kiến thức/câu chuyện của chính người nói.\n3. Giữ đúng ngôn ngữ của đầu vào.\n4. Chào mở đầu một lần duy nhất ở chunk đầu; không lặp lại ở các chunk sau.\n`
        : `Bạn là biên kịch podcast chuyên nghiệp. Viết thành hội thoại tự nhiên nhiều nhân vật.\nDanh sách nhân vật:\n${roleGuide}\nYêu cầu:\n1. Không nói "theo văn bản", "đoạn trên", "nội dung đã cho".\n2. Tự kể lại sao cho người nghe không cần xem văn bản gốc.\n3. Giữ đúng ngôn ngữ của đầu vào.\n4. Chào mở đầu một lần duy nhất ở chunk đầu; không lặp lại ở các chunk sau.\n5. Giới tính chỉ để hiểu ngữ cảnh nhân vật, không ép buộc mẫu xưng hô cứng.\n6. MC luôn xưng tên và mở câu với "thưa bác sĩ" khi trao đổi chuyên môn.\n7. Bác sĩ luôn gọi tên MC và xưng "tôi", không đổi ngôi thất thường.\n`);

    const buildChunkPrompt = (chunk: string, isFirst: boolean, isLast: boolean): string => {
      if (localizedPrompts) {
        const template = isFirst
          ? localizedPrompts.chunkOpenPrompt
          : isLast
          ? localizedPrompts.chunkClosePrompt
          : localizedPrompts.chunkMidPrompt;
        return template.replace('[[SOURCE]]', chunk);
      }
      // fallback tiếng Việt
      return (
        `Nội dung nguồn:\n"""${chunk}"""\n\nRàng buộc:\n` +
        `- ${isFirst ? 'Bắt đầu tự nhiên (chào mở đầu ngắn gọn).' : 'Không được chào lại hoặc giới thiệu lại chương trình.'}\n` +
        `- ${isLast ? 'Kết thúc bằng một đoạn tổng kết ngắn.' : 'Kết thúc mở để nối mạch sang phần tiếp theo.'}\n` +
        `- Không được lược bỏ ý quan trọng. Mỗi luận điểm/diễn biến/chỉ dẫn chính trong chunk nguồn phải được thể hiện lại.\n` +
        `- Giữ trọn vẹn mạch logic: nguyên nhân -> diễn biến -> kết luận (nếu có).\n` +
        `- Không tóm tắt quá ngắn; ưu tiên đầy đủ ý.\n` +
        `- Mỗi lượt thoại phải là câu/đoạn hoàn chỉnh.\n` +
        `- Chuyển thể tự nhiên, KHÔNG bê nguyên văn từng câu từ nguồn gốc.\n`
      );
    };

    const finalLines: DialogueLine[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const prompt = buildChunkPrompt(chunk, isFirst, isLast);

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
        const expandPrompt = localizedPrompts
          ? localizedPrompts.expandPrompt
              .replace('[[SOURCE]]', chunk)
              .replace('[[DRAFT]]', renderDialogueDraft(lines))
              .replace('[[MIN_CHARS]]', String(minChunkChars))
          : (
              `Nguồn gốc:\n"""${chunk}"""\n\nBản chuyển thể hiện tại:\n"""${renderDialogueDraft(lines)}"""\n\n` +
              `Hãy viết lại bản hội thoại đầy đủ ý hơn:\n` +
              `- Giữ nguyên nhân vật và phong cách.\n` +
              `- Không bỏ chi tiết quan trọng từ nguồn.\n` +
              `- Không tóm tắt quá ngắn.\n` +
              `- Mỗi lượt thoại cần liền mạch.\n` +
              `- Không bê nguyên văn nguồn; diễn đạt lại theo lối hội thoại tự nhiên.\n` +
              `- Tổng độ dài tối thiểu khoảng ${minChunkChars} ký tự.\n`
            );
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
