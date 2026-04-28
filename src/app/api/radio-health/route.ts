import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const supabaseAdmin = createSupabaseAdminClient();

export const maxDuration = 300;

type HealthConfig = {
  programName: string;
  format: "STUDIO_PODCAST" | "HOTLINE_CALL";
  hostName: string;
  hostGender: string;
  doctorName: string;
  doctorGender: string;
  doctorRole: "DOCTOR" | "PSYCHOLOGIST";
  callerIdentityMode: "NAME" | "ANONYMOUS" | "LOCATION";
  callerName: string;
  detailedIdea: string;
  sampleScript: string;
  characterDNA: string;
  charCount: number;
};

type ScriptSection = {
  title: string;
  keyPoints: string;
  estimatedChars: number;
};

async function resolveProviderKey(profile: any, provider: "gemini" | "openai") {
  const apiKeys = profile.api_keys || {};
  if (provider === "openai") {
    const direct = apiKeys.openai || "";
    if (direct) return direct;
    const { data: vault } = await supabaseAdmin
      .from("api_vault")
      .select("api_key")
      .eq("provider", "openai")
      .single();
    return vault?.api_key || "";
  }
  const direct = apiKeys.gemini || "";
  if (direct) return direct;
  const { data: vault } = await supabaseAdmin
    .from("api_vault")
    .select("api_key")
    .eq("provider", "gemini")
    .single();
  return vault?.api_key || "";
}

const cleanJson = (text: string) => {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json"))
    cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "");
  else if (cleaned.startsWith("```"))
    cleaned = cleaned.replace(/^```/, "").replace(/```$/, "");
  return cleaned.trim();
};

async function generateWithGemini(
  key: string,
  contents: string,
  systemInstruction: string,
  model: string,
  temperature: number = 0.7,
  retryCount = 0
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: key.trim() });
  
  // Trộn system instruction vào đầu nội dung nếu SDK gặp vấn đề với config
  const fullPrompt = `${systemInstruction}\n\nNỘI DUNG CẦN XỬ LÝ:\n${contents}`;

  try {
    const result = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: fullPrompt }] }],
      config: { temperature, maxOutputTokens: 8192 },
    });
    const text = result.text || "";
    if (!text) {
      console.warn(`Gemini returned empty text for model ${model}`);
    }
    return text;
  } catch (error: any) {
    const status = error?.status || error?.code || 0;
    const msg = (error?.message || "").toLowerCase();
    
    // Nếu gặp lỗi 503 (Unavailable) hoặc 429 (Rate Limit), thực hiện retry
    if ((status === 503 || status === 429 || msg.includes("overloaded") || msg.includes("demand")) && retryCount < 3) {
      const delay = 2000 * (retryCount + 1);
      console.log(`Gemini 503/429 error, retrying in ${delay}ms... (lần ${retryCount + 1})`);
      await new Promise(r => setTimeout(r, delay));
      return generateWithGemini(key, contents, systemInstruction, model, temperature, retryCount + 1);
    }
    throw error;
  }
}

async function generateWithOpenAI(
  key: string,
  contents: string,
  systemInstruction: string,
  temperature: number = 0.7
): Promise<string> {
  const client = new OpenAI({ apiKey: key.trim() });
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: contents },
    ],
  });
  return completion.choices[0]?.message?.content || "";
}

async function generateScriptOutline(
  key: string,
  model: string,
  contextPrompt: string,
  targetChars: number,
  retryCount = 0
): Promise<ScriptSection[]> {
  const ai = new GoogleGenAI({ apiKey: key.trim() });
  const estimatedParts = Math.max(3, Math.ceil(targetChars / 4500));
  const charsPerPart = Math.floor(targetChars / estimatedParts);

  const systemPrompt = `
    DỰ KIẾN DÀN Ý KỊCH BẢN RADIO. Tổng ${targetChars} ký tự. Chia làm ${estimatedParts} phần.
    YÊU CẦU DÀN Ý TUẦN TỰ (CẤM LẶP Ý):
    - Phần 1: Mở đầu, MC chào thính giả theo đúng bối cảnh, thính giả nêu vấn đề.
    - Các phần giữa: Đi sâu vào từng khía cạnh, Bác sĩ phân tích, MC hỏi xoáy thêm. KHÔNG CHÀO LẠI.
    - Phần cuối: Lời khuyên chốt hạ của Bác sĩ và MC chào kết.
    Trả về JSON: [ { "title": "...", "keyPoints": "...", "estimatedChars": ${charsPerPart} } ]
  `;

  const fullPrompt = `${systemPrompt}\n\nÝ TƯỞNG GỐC:\n${contextPrompt}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: fullPrompt }] }],
      config: {
        responseMimeType: "application/json",
      },
    });
    const text = response.text || "[]";
    return JSON.parse(cleanJson(text));
  } catch (error: any) {
    const status = error?.status || error?.code || 0;
    const msg = (error?.message || "").toLowerCase();
    if ((status === 503 || status === 429 || msg.includes("demand")) && retryCount < 3) {
      await new Promise(r => setTimeout(r, 2000));
      return generateScriptOutline(key, model, contextPrompt, targetChars, retryCount + 1);
    }
    return [
      {
        title: "Hội thoại chính",
        keyPoints: "Phát triển đối thoại sâu sắc theo ý tưởng nguồn.",
        estimatedChars: targetChars,
      },
    ];
  }
}

async function generateSection(
  key: string,
  provider: "gemini" | "openai",
  model: string,
  section: ScriptSection,
  contextPrompt: string,
  previousContent: string,
  partIndex: number,
  totalParts: number
): Promise<string> {
  const isFirstPart = partIndex === 0;

  const systemPrompt = `
    VIẾT KỊCH BẢN THOẠI RADIO. PHẦN ${partIndex + 1}/${totalParts}.
    
    === QUY TẮC NỐI TIẾP (QUAN TRỌNG NHẤT) ===
    ${
      !isFirstPart
        ? "ĐÂY LÀ PHẦN TIẾP THEO. CẤM CHÀO HỎI LẠI. CẤM GIỚI THIỆU LẠI NHÂN VẬT. CẤM NHẮC LẠI VẤN ĐỀ ĐÃ NÓI. Bắt đầu ngay bằng lời thoại nối tiếp nội dung trước."
        : "ĐÂY LÀ PHẦN MỞ ĐẦU. Thực hiện màn chào hỏi và nêu vấn đề."
    }
    
    === PHÂN VAI TUYỆT ĐỐI ===
    1. MC: Dẫn dắt, hỏi thâm nhập, thấu cảm. TUYỆT ĐỐI KHÔNG TƯ VẤN.
    2. BÁC SĨ/CHUYÊN GIA: Duy nhất người này mới được khuyên "Bạn nên...", "Giải pháp là...".
    
    === ĐỊNH DẠNG ===
    - Tên (Vai trò): Lời thoại.
    - CẤM ngoặc đơn chỉ dẫn sân khấu (cười), (khóc)...
    - CẤM ghi "Phần ${partIndex + 1}".

    Nội dung phần này: ${section.title} - ${section.keyPoints}
    Lịch sử cuộc hội thoại trước đó: 
    """
    ${previousContent.slice(-2500)}
    """
  `;

  if (provider === "openai") {
    return await generateWithOpenAI(key, contextPrompt, systemPrompt);
  }
  return await generateWithGemini(key, contextPrompt, systemPrompt, model);
}

async function finalizeScript(
  key: string,
  provider: "gemini" | "openai",
  model: string,
  fullScript: string,
  config: HealthConfig
): Promise<string> {
  const systemPrompt = `
    BẠN LÀ TỔNG BIÊN TẬP RADIO CAO CẤP. 
    Nhiệm vụ của bạn là RÀ SOÁT và SỬA LỖI kịch bản Radio sức khỏe bên dưới.

    === LỆNH CẤM QUAN TRỌNG (SỐNG CÒN) ===
    1. TUYỆT ĐỐI CẤM TÓM TẮT: Không được làm ngắn kịch bản. Nếu kịch bản gốc dài, kịch bản sau rà soát PHẢI dài tương đương.
    2. TUYỆT ĐỐI CẤM VIẾT LẠI THEO Ý RIÊNG: Chỉ được sửa những lỗi sai quy tắc dưới đây, giữ nguyên mọi câu thoại hợp lệ khác.
    3. TUYỆT ĐỐI CẤM XÓA NỘI DUNG: Không được lược bỏ bất kỳ ý chính hay đoạn hội thoại nào.

    === QUY TẮC RÀ SOÁT ===
    1. KIỂM TRA PHÂN VAI: MC tuyệt đối không khuyên bảo. Nếu thấy MC khuyên "Bạn hãy...", hãy sửa thành MC hỏi Bác sĩ: "Thưa bác sĩ, trường hợp này có nên làm vậy không?".
    2. KIỂM TRA XƯNG HÔ: Đảm bảo nhân vật gọi nhau đúng tên đã thiết lập (MC: ${config.hostName}, BS: ${config.doctorName}, Thính giả: ${config.callerName}).
    3. KIỂM TRA CÂU CHÀO: Nếu bối cảnh là địa danh, phải giữ câu: "Alo, ${config.callerName} mình đâu ạ?".
    4. LÀM SẠCH TRIỆT ĐỂ: Xóa sạch mọi chỉ dẫn trong ngoặc đơn (Cười), (Nói trầm),...
    5. NHẤT QUÁN: Đảm bảo không có sự lặp lại màn chào hỏi ở giữa kịch bản. Nếu thấy câu chào ở giữa, xóa và nối lời thoại.

    ĐẦU RA: Trả về toàn bộ nội dung kịch bản đã được tinh chỉnh, giữ nguyên mọi chi tiết và độ dài ban đầu.
  `;

  if (provider === "openai") {
    return await generateWithOpenAI(key, fullScript, systemPrompt, 0.2);
  }
  return await generateWithGemini(key, fullScript, systemPrompt, model, 0.2);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, provider: rawProvider, geminiModel: rawModel, config } = body;

    if (!userId || !config) {
      return NextResponse.json({ error: "Thiếu userId hoặc cấu hình." }, { status: 400 });
    }

    const provider: "gemini" | "openai" = rawProvider === "openai" ? "openai" : "gemini";
    const geminiModel: string =
      rawModel === "gemini-2.5-flash" ? "gemini-2.5-flash" : "gemini-2.5-flash-lite";

    const healthConfig = config as HealthConfig;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";

    // Auth check
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (!profile || profile.status !== "approved") {
      return NextResponse.json({ error: "Truy cập bị từ chối." }, { status: 403 });
    }

    // API key
    const key = await resolveProviderKey(profile, provider);
    if (!key) {
      return NextResponse.json(
        { error: `Chưa cấu hình API key cho ${provider}.` },
        { status: 403 }
      );
    }

    // Validate required fields
    if (!healthConfig.detailedIdea?.trim() || !healthConfig.sampleScript?.trim()) {
      return NextResponse.json(
        { error: "Vui lòng nhập đầy đủ ý tưởng và kịch bản mẫu." },
        { status: 400 }
      );
    }

    // Build context prompt
    const hostLabel = healthConfig.hostName || "MC";
    const guestLabel =
      healthConfig.doctorName ||
      (healthConfig.doctorRole === "DOCTOR" ? "Bác sĩ" : "Chuyên gia");
    const guestRoleType =
      healthConfig.doctorRole === "DOCTOR" ? "Bác sĩ" : "Chuyên gia";

    let callerDisplayName = "";
    let callerRoleLabel = "";
    let mcGreetingRequirement = "";

    if (healthConfig.callerIdentityMode === "NAME") {
      callerDisplayName = healthConfig.callerName || "Thành";
      callerRoleLabel = "Thính giả";
      mcGreetingRequirement = `- MC chào mừng thính giả "${callerDisplayName}" đến với chương trình.`;
    } else if (healthConfig.callerIdentityMode === "ANONYMOUS") {
      callerDisplayName = "Thính giả";
      callerRoleLabel = "Giấu tên";
      mcGreetingRequirement = `- MC chào thính giả giấu tên đang kết nối. TUYỆT ĐỐI không xưng tên riêng.`;
    } else if (healthConfig.callerIdentityMode === "LOCATION") {
      callerDisplayName = "Thính giả";
      callerRoleLabel = healthConfig.callerName || "Hà Nội";
      mcGreetingRequirement = `- MC BẮT BUỘC mở đầu bằng câu: "Alo, ${callerRoleLabel} mình đâu ạ?". Tuyệt đối không xưng tên riêng, chỉ gọi bằng địa danh "${callerRoleLabel}".`;
    }

    const contextPrompt = `
      === HƯỚNG DẪN BIÊN KỊCH CHUYÊN NGHIỆP ===
      BỐI CẢNH: ${
        healthConfig.format === "STUDIO_PODCAST"
          ? "PODCAST STUDIO (MC, Chuyên gia và Thính giả ngồi trực tiếp tại studio)"
          : "HOTLINE RADIO (Kết nối điện thoại)"
      }
      
      NHÂN VẬT & GIỌNG VĂN:
      - ${hostLabel} (MC): Người dẫn dắt. Học cách dùng từ từ mục "ADN LỜI THOẠI". CHỈ ĐƯỢC hỏi, thấu cảm. CẤM TƯ VẤN.
      - ${guestLabel} (${guestRoleType}): Người tư vấn. Học cách dùng từ từ mục "ADN LỜI THOẠI". DUY NHẤT người này được đưa ra lời khuyên.
      - ${callerDisplayName} (${callerRoleLabel}): Người chia sẻ vấn đề.

      LUẬT MỞ ĐẦU:
      ${mcGreetingRequirement}

      === DỮ LIỆU ADN LỜI THOẠI (BẮT BUỘC HỌC THEO CÁCH DÙNG TỪ) ===
      """
      ${healthConfig.characterDNA}
      """

      === CẤU TRÚC KỊCH BẢN MẪU (ADN PHONG CÁCH) ===
      """
      ${healthConfig.sampleScript}
      """

      Ý TƯỞNG CẦN TRIỂN KHAI: ${healthConfig.detailedIdea}
      
      LUẬT BIÊN TẬP SỐNG CÒN:
      1. CẤM: Chỉ dẫn sân khấu (ngoặc đơn).
      2. CẤM: Lặp ý giữa các phần.
      3. CẤM: Ghi "Phần 1", "Phần 2".
    `;

    // Step 1: Generate outline
    const outline = await generateScriptOutline(
      key,
      geminiModel,
      contextPrompt,
      healthConfig.charCount
    );

    // Step 2: Generate each section
    let fullResult = "";
    let accumulatedContent = "";
    const progressSteps: string[] = [];

    for (let i = 0; i < outline.length; i++) {
      progressSteps.push(`Phần ${i + 1}/${outline.length}: ${outline[i].title}`);
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const part = await generateSection(
        key,
        provider,
        geminiModel,
        outline[i],
        contextPrompt,
        accumulatedContent,
        i,
        outline.length
      );
      fullResult += (i > 0 ? "\n\n" : "") + part;
      accumulatedContent += part + " ";
    }

    // Step 3: Finalize
    if (!fullResult || fullResult.length < 50) {
       console.error("Full result is suspiciously short or empty:", fullResult);
    }

    await new Promise((r) => setTimeout(r, 1000));
    const finalizedScript = await finalizeScript(
      key,
      provider,
      geminiModel,
      fullResult || "Lỗi: Không có nội dung để xử lý.",
      healthConfig
    );

    if (!finalizedScript) {
      throw new Error("Không thể hoàn thiện kịch bản (kết quả rỗng).");
    }

    // Log usage
    await Promise.all([
      supabaseAdmin.from("usage_logs").insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `Radio Sức Khỏe (${provider}/${provider === "gemini" ? geminiModel : "gpt-4.1-mini"})`,
        char_count: finalizedScript.length,
      }),
      supabaseAdmin
        .from("profiles")
        .update({ last_active_at: new Date().toISOString(), current_ip: ip })
        .eq("id", userId),
    ]);

    return NextResponse.json({
      result: finalizedScript,
      sections: outline.length,
      provider,
      model: provider === "openai" ? "gpt-4.1-mini" : geminiModel,
    });
  } catch (error: any) {
    console.error("Radio Health API Error:", error);
    return NextResponse.json(
      { error: error?.message || "Lỗi hệ thống Radio Sức Khỏe." },
      { status: 500 }
    );
  }
}
