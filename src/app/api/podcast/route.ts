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

function classifyApiError(e: any, provider: 'gemini' | 'openai'): string {
  const msg: string = (e?.message || e?.toString() || '').toLowerCase();
  const status: number = e?.status || e?.statusCode || e?.response?.status || 0;
  const errType: string = (e?.error?.type || e?.type || '').toLowerCase();
  const errCode: string = (e?.error?.code || e?.code || '').toLowerCase();

  // ── GEMINI errors ──────────────────────────────────────────────────────────
  if (provider === 'gemini') {
    // 429 RESOURCE_EXHAUSTED — quota / rate limit
    if (status === 429 || msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('rate limit')) {
      return '⚠️ Gemini API: Đã hết quota hoặc vượt rate limit (429 RESOURCE_EXHAUSTED). Vui lòng kiểm tra Google AI Studio → Billing/Quota hoặc thay API key khác.';
    }
    // 403 PERMISSION_DENIED — bad key or no access
    if (status === 403 || msg.includes('permission_denied') || msg.includes('api key')) {
      return '🔑 Gemini API: API key không hợp lệ hoặc không có quyền truy cập model này (403 PERMISSION_DENIED). Vui lòng kiểm tra và thay API key.';
    }
    // 401 UNAUTHENTICATED
    if (status === 401 || msg.includes('unauthenticated') || msg.includes('unauthorized')) {
      return '🔑 Gemini API: Xác thực thất bại (401). API key có thể đã hết hạn hoặc bị thu hồi.';
    }
    // 404 NOT_FOUND — model không tồn tại
    if (status === 404 || msg.includes('not_found') || msg.includes('not found')) {
      return '❌ Gemini API: Model không tìm thấy (404 NOT_FOUND). Model ID có thể không còn hỗ trợ.';
    }
    // 400 INVALID_ARGUMENT
    if (status === 400 || msg.includes('invalid_argument') || msg.includes('invalid argument')) {
      return '❌ Gemini API: Yêu cầu không hợp lệ (400 INVALID_ARGUMENT). Vui lòng kiểm tra nội dung input.';
    }
    // 503 UNAVAILABLE
    if (status === 503 || msg.includes('unavailable') || msg.includes('overloaded')) {
      return '🔄 Gemini API: Dịch vụ đang quá tải hoặc tạm thời không khả dụng (503). Vui lòng thử lại sau ít phút.';
    }
    // 504 DEADLINE_EXCEEDED
    if (status === 504 || msg.includes('deadline_exceeded') || msg.includes('timeout')) {
      return '⏱️ Gemini API: Request quá lâu, bị timeout (504 DEADLINE_EXCEEDED). Thử rút ngắn nội dung input.';
    }
    // 500 INTERNAL
    if (status === 500 || msg.includes('internal')) {
      return '🔴 Gemini API: Lỗi nội bộ server (500 INTERNAL). Thường tạm thời — thử lại sau.';
    }
    return `❌ Gemini API lỗi: ${e?.message || 'Unknown error'}`;
  }

  // ── OPENAI errors ──────────────────────────────────────────────────────────
  if (provider === 'openai') {
    // insufficient_quota — hết tiền / credit
    if (errType === 'insufficient_quota' || errCode === 'insufficient_quota' || msg.includes('insufficient_quota') || msg.includes('exceeded your current quota')) {
      return '💳 OpenAI API: Tài khoản đã hết credit/quota (insufficient_quota). Vui lòng nạp thêm tín dụng tại platform.openai.com/billing.';
    }
    // rate_limit_error — gửi quá nhanh
    if (errType === 'rate_limit_error' || errCode === 'rate_limit_exceeded' || status === 429 || msg.includes('rate limit')) {
      return '⚠️ OpenAI API: Vượt rate limit (429). Đang gửi quá nhiều request — hãy thử lại sau vài giây.';
    }
    // authentication_error — API key sai
    if (errType === 'authentication_error' || status === 401 || msg.includes('invalid api key') || msg.includes('authentication')) {
      return '🔑 OpenAI API: API key không hợp lệ hoặc đã hết hạn (401 authentication_error). Vui lòng kiểm tra và thay API key.';
    }
    // permission_error
    if (errType === 'permission_error' || status === 403 || msg.includes('permission')) {
      return '🔑 OpenAI API: API key không có quyền truy cập model này (403 permission_error).';
    }
    // not_found_error — model không tồn tại
    if (errType === 'not_found_error' || status === 404 || msg.includes('not found') || msg.includes('no such model')) {
      return '❌ OpenAI API: Model không tìm thấy (404). Model ID có thể không tồn tại hoặc bạn chưa được truy cập.';
    }
    // invalid_request_error
    if (errType === 'invalid_request_error' || status === 400) {
      return '❌ OpenAI API: Yêu cầu không hợp lệ (400 invalid_request_error). Kiểm tra nội dung input.';
    }
    // server_error
    if (errType === 'server_error' || status === 500) {
      return '🔴 OpenAI API: Lỗi server phía OpenAI (500). Thường tạm thời — thử lại sau.';
    }
    return `❌ OpenAI API lỗi: ${e?.message || 'Unknown error'}`;
  }

  return `❌ Lỗi API không xác định: ${e?.message || 'Unknown error'}`;
}

async function generateWithGemini(
  key: string,
  prompt: string,
  systemInstruction: string,
  model: string = 'gemini-2.5-flash'
): Promise<DialogueLine[]> {
  const ai = new GoogleGenAI({ apiKey: key.trim() });
  const response = await ai.models.generateContent({
    model,
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
    const geminiModel: string =
      body?.geminiModel === 'gemini-2.5-flash-lite'
        ? 'gemini-2.5-flash-lite'
        : 'gemini-2.5-flash';
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

    const completenessRules =
      'IMPORTANT rules that must appear in EVERY chunk prompt you write: ' +
      '(1) Do NOT omit any key point, argument, event, or instruction from the source - every important detail MUST be represented in the dialogue. ' +
      '(2) Do NOT over-summarise or shorten - completeness is more important than brevity. ' +
      '(3) The total character length of the dialogue text must be at least [[MIN_CHARS]] characters - include [[MIN_CHARS]] literally as a placeholder the caller will fill. ' +
      '(4) Preserve the full logical flow: cause -> development -> conclusion. ' +
      '(5) Each speaking turn must be a complete sentence or paragraph - do not split one idea into many short consecutive lines by the same speaker. ' +
      '(6) Adapt naturally - do NOT copy source sentences verbatim, but do NOT remove content.';

    const monologueMetaPrompt =
      'You are a multilingual prompt engineer.\n' +
      'Step 1 - Identify the language of the sample text below.\n' +
      'Step 2 - In THAT SAME LANGUAGE, produce exactly 5 JSON fields (no markdown, no extra keys).\n' +
      completenessRules + '\n' +
      '{\n' +
      '  "systemInstruction": "<system instruction for a podcast AI: act as professional podcast editor, convert source into natural monologue spoken by ' + firstRole.name + ', never say according-to-the-text or as-mentioned, treat content as the speaker own knowledge and story, greet audience only once at very start, do not repeat greeting in later segments>",\n' +
      '  "chunkOpenPrompt": "<user prompt for OPENING chunk: source placeholder [[SOURCE]], open naturally with a brief greeting, then cover ALL key points from source completely without omission, minimum [[MIN_CHARS]] characters of dialogue text, each turn a full coherent sentence or paragraph, adapt naturally not verbatim, do not over-summarise>",\n' +
      '  "chunkMidPrompt": "<user prompt for MIDDLE chunk: source placeholder [[SOURCE]], do NOT re-greet or re-introduce, end open to connect to next segment, cover ALL key points completely without omission, minimum [[MIN_CHARS]] characters of dialogue text, each turn a full coherent sentence or paragraph, adapt naturally not verbatim, do not over-summarise>",\n' +
      '  "chunkClosePrompt": "<user prompt for CLOSING chunk: source placeholder [[SOURCE]], do NOT re-greet, cover ALL key points completely without omission, end with a warm closing or summary, minimum [[MIN_CHARS]] characters of dialogue text, each turn a full coherent sentence or paragraph, adapt naturally not verbatim, do not over-summarise>",\n' +
      '  "expandPrompt": "<user prompt to rewrite a too-short dialogue: original source placeholder [[SOURCE]], current draft placeholder [[DRAFT]], minimum character count placeholder [[MIN_CHARS]], keep same speaker and style, do not omit any detail from source, do not over-summarise, do not copy verbatim, each turn must be coherent and complete>"\n' +
      '}\n' +
      'All 5 values MUST be written entirely in the detected language. Do NOT use English inside the values.\n' +
      'Sample text: """' + inputText.slice(0, 400) + '"""';

    const dialogueMetaPrompt =
      'You are a multilingual prompt engineer.\n' +
      'Step 1 - Identify the language of the sample text below.\n' +
      'Step 2 - In THAT SAME LANGUAGE, produce exactly 5 JSON fields (no markdown, no extra keys).\n' +
      completenessRules + '\n' +
      '{\n' +
      '  "systemInstruction": "<system instruction for a podcast AI: act as professional podcast scriptwriter, convert source into natural multi-character dialogue, characters: ' + roleGuideRaw + ', never say according-to-the-text or as-mentioned, retell so listeners do not need the source, greet audience only once at very start, gender is context only not rigid speech, character-specific speaking style: Host always addresses by name and speaks formally to Doctor on professional topics, Doctor always addresses Host by name and refers to self in first person consistently>",\n' +
      '  "chunkOpenPrompt": "<user prompt for OPENING chunk: source placeholder [[SOURCE]], open naturally with a brief greeting, cover ALL key points from source completely without omission, minimum [[MIN_CHARS]] characters of dialogue text, each turn a full coherent sentence or paragraph, adapt naturally not verbatim, do not over-summarise>",\n' +
      '  "chunkMidPrompt": "<user prompt for MIDDLE chunk: source placeholder [[SOURCE]], do NOT re-greet or re-introduce, end open to connect to next segment, cover ALL key points completely without omission, minimum [[MIN_CHARS]] characters of dialogue text, each turn a full coherent sentence or paragraph, adapt naturally not verbatim, do not over-summarise>",\n' +
      '  "chunkClosePrompt": "<user prompt for CLOSING chunk: source placeholder [[SOURCE]], do NOT re-greet, cover ALL key points completely without omission, end with a warm closing or summary, minimum [[MIN_CHARS]] characters of dialogue text, each turn a full coherent sentence or paragraph, adapt naturally not verbatim, do not over-summarise>",\n' +
      '  "expandPrompt": "<user prompt to rewrite a too-short dialogue: original source placeholder [[SOURCE]], current draft placeholder [[DRAFT]], minimum character count placeholder [[MIN_CHARS]], keep same characters and style, do not omit any detail from source, do not over-summarise, do not copy verbatim, each turn must be coherent and complete>"\n' +
      '}\n' +
      'All 5 values MUST be written entirely in the detected language. Do NOT use English inside the values.\n' +
      'Sample text: """' + inputText.slice(0, 400) + '"""';

    try {
      const metaAi = new GoogleGenAI({ apiKey: key.trim() });
      const metaRes = await metaAi.models.generateContent({
        model: geminiModel,
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

    const buildChunkPrompt = (chunk: string, isFirst: boolean, isLast: boolean, minChars: number): string => {
      if (localizedPrompts) {
        const template = isFirst
          ? localizedPrompts.chunkOpenPrompt
          : isLast
          ? localizedPrompts.chunkClosePrompt
          : localizedPrompts.chunkMidPrompt;
        return template
          .replace('[[SOURCE]]', chunk)
          .replace(/\[\[MIN_CHARS\]\]/g, String(minChars));
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
      const minChunkChars = Math.max(450, Math.floor(chunk.length * (isMonologue ? 0.82 : 0.72)));
      const prompt = buildChunkPrompt(chunk, isFirst, isLast, minChunkChars);

      let lines: DialogueLine[] = [];
      let lastError = '';
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          lines =
            provider === 'openai'
              ? await generateWithOpenAI(key, prompt, systemInstruction)
              : await generateWithGemini(key, prompt, systemInstruction, geminiModel);
          if (lines.length > 0 && dialogueCharCount(lines) >= minChunkChars) break;
          if (lines.length > 0 && attempt < 4) {
            // Có output nhưng còn ngắn: thử lại để phủ đủ ý hơn.
            await wait(900 * attempt);
          }
        } catch (e: any) {
          lastError = classifyApiError(e, provider);
          if (attempt < 4) await wait(1200 * attempt);
        }
      }
      if (lines.length === 0) {
        return NextResponse.json(
          { error: lastError || `Không tạo được kịch bản ở phần ${i + 1}.` },
          { status: 500 }
        );
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
              : await generateWithGemini(key, expandPrompt, systemInstruction, geminiModel);
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
      tool_name: title ? `Tạo kịch bản Podcast (${provider}${provider === 'gemini' ? `/${geminiModel}` : ''}) | ${title}` : `Tạo kịch bản Podcast (${provider}${provider === 'gemini' ? `/${geminiModel}` : ''})`,
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
      model: provider === 'openai' ? 'gpt-4.1-mini' : geminiModel,
      title,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Podcast API error' }, { status: 500 });
  }
}
