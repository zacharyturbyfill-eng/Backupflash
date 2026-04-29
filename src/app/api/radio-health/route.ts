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
  charCount: number;
};

// ─────────────────────────────────────────────────────────────
// AI Helpers
// ─────────────────────────────────────────────────────────────

async function generateWithGemini(
  key: string,
  contents: string,
  systemInstruction: string,
  model: string,
  temperature = 0.75,
  maxOutputTokens = 16384,
  retryCount = 0
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: key.trim() });
  try {
    const result = await ai.models.generateContent({
      model,
      contents,
      config: { systemInstruction, temperature, maxOutputTokens },
    });
    return result.text || "";
  } catch (error: any) {
    const status = error?.status || error?.code || 0;
    const msg = (error?.message || "").toLowerCase();
    if (
      (status === 503 || status === 429 || msg.includes("overloaded") || msg.includes("demand")) &&
      retryCount < 3
    ) {
      const delay = 2000 * (retryCount + 1);
      await new Promise((r) => setTimeout(r, delay));
      return generateWithGemini(key, contents, systemInstruction, model, temperature, maxOutputTokens, retryCount + 1);
    }
    throw error;
  }
}

async function generateWithOpenAI(
  key: string,
  contents: string,
  systemInstruction: string,
  temperature = 0.75
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

async function resolveProviderKey(profile: any, provider: "gemini" | "openai") {
  const apiKeys = profile.api_keys || {};
  if (provider === "openai") {
    const direct = apiKeys.openai || "";
    if (direct) return direct;
    const { data: vault } = await supabaseAdmin
      .from("api_vault").select("api_key").eq("provider", "openai").single();
    return vault?.api_key || "";
  }
  const direct = apiKeys.gemini || "";
  if (direct) return direct;
  const { data: vault } = await supabaseAdmin
    .from("api_vault").select("api_key").eq("provider", "gemini").single();
  return vault?.api_key || "";
}

// ─────────────────────────────────────────────────────────────
// Code post-processing (không cần gọi AI)
// ─────────────────────────────────────────────────────────────
function postProcess(script: string): string {
  return script
    .replace(/\([^)]{1,40}\)/g, "")       // xóa chỉ dẫn sân khấu ngắn
    .replace(/^(Phần|PHẦN)\s*\d+[^\n]*/gm, "") // xóa tiêu đề Phần X
    .replace(/\n{3,}/g, "\n\n")            // chuẩn hóa dòng trống
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Xây dựng context đầy đủ từ tất cả input fields
// ─────────────────────────────────────────────────────────────
function buildContext(cfg: HealthConfig, derived: {
  programLabel: string;
  formatLabel: string;
  hostLabel: string;
  hostPronoun: string;
  guestRoleType: string;
  guestFullLabel: string;
  guestShortLabel: string;
  guestPronoun: string;
  callerDisplayName: string;
  callerContext: string;
}) {
  return `
=== THÔNG TIN CHƯƠNG TRÌNH ===
Tên chương trình: "${derived.programLabel}"
Hình thức: ${derived.formatLabel}

=== NHÂN VẬT ===
MC dẫn chương trình:
  - Tên: "${derived.hostLabel}"
  - Giới tính: ${derived.hostPronoun}
  - Vai trò: Dẫn dắt, hỏi thăm, thấu cảm. TUYỆT ĐỐI không tư vấn chuyên môn.

Khách mời tư vấn:
  - Tên: "${derived.guestShortLabel}"
  - Danh xưng đầy đủ: ${derived.guestFullLabel}
  - Giới tính: ${derived.guestPronoun}
  - Vai trò: NGƯỜI DUY NHẤT được phân tích, tư vấn, đưa lời khuyên chuyên môn.

Thính giả / Nhân vật chính:
  - Tên/Danh xưng: "${derived.callerDisplayName}"
  - ${derived.callerContext}

=== ĐỊNH DẠNG LỜI THOẠI BẮT BUỘC ===
${derived.hostLabel}: [lời thoại]
${derived.guestShortLabel}: [lời thoại]
${derived.callerDisplayName}: [lời thoại]
CẤM dùng bất kỳ tên nào khác ngoài 3 tên trên.

=== NỘI DUNG / SYNOPSIS ===
${cfg.detailedIdea}
`.trim();
}

// ─────────────────────────────────────────────────────────────
// 3 Phase generators với prompt riêng biệt
// ─────────────────────────────────────────────────────────────

async function generateOpening(
  key: string,
  provider: "gemini" | "openai",
  model: string,
  context: string,
  derived: {
    programLabel: string;
    formatLabel: string;
    hostLabel: string;
    hostPronoun: string;
    guestFullLabel: string;
    guestShortLabel: string;
    callerDisplayName: string;
    openingInstruction: string;
  },
  targetChars: number
): Promise<string> {
  const tokens = Math.min(65536, Math.max(4096, Math.ceil(targetChars * 1.6)));

  const systemPrompt = `
Bạn là biên kịch Radio chuyên nghiệp. Viết PHẦN MỞ ĐẦU của kịch bản Radio Sức Khỏe.
MỤC TIÊU ĐỘ DÀI: Viết ĐÚNG ${targetChars} ký tự.

=== CẤU TRÚC BẮT BUỘC CỦA PHẦN MỞ ĐẦU ===
BƯỚC 1 — MC mở đầu chương trình:
  - MC "${derived.hostLabel}" giới thiệu chương trình "${derived.programLabel}".
  - ${derived.openingInstruction}

BƯỚC 2 — MC kết nối với thính giả "${derived.callerDisplayName}":
  - MC hỏi thăm hoàn cảnh, nơi ở, tình trạng hiện tại của thính giả.
  - Thính giả chia sẻ vấn đề của mình (dựa theo synopsis).
  - MC lắng nghe, thấu cảm, hỏi thêm 2-3 câu để làm rõ vấn đề.
  - MC KHÔNG đưa ra lời khuyên chuyên môn.

BƯỚC 3 — MC chuyển cuộc cho khách mời (CHỈ 1 CÂU DUY NHẤT):
  - MC nói ĐÚNG MỘT CÂU: ví dụ: "${derived.guestShortLabel} sẽ trò chuyện cùng bạn về vấn đề này."
  - SAU ĐÓ KẾT THÚC NGAY phần mở đầu.
  - TUYỆT ĐỐI CẤM: ${derived.guestShortLabel} chào hỏi hay tự giới thiệu trong phần này.
  - TUYỆT ĐỐI CẤM: viết nhiều hơn 1 câu cho bước chuyển này.

=== XUỢNG HÔ BẮT BUỘC ===
- Thính giả xưng hô bằng "em" hoặc "tôi". TUYỆT ĐỐI CẤM dùng "cháu".
- Khách mời gọi thính giả là "bạn" hoặc "anh/chị" tuỳ giới tính.
- MC gọi thính giả bằng tên hoặc "bạn".

=== ĐỊNH DẠNG LỜI THOẠI BẮT BUỘC ===
Mỗi lượt thoại viết trên MỘT DÒNG DUY NHẤT:
Tên: [nội dung lời thoại]

VÍ DỤ ĐÚNG:
${derived.hostLabel}: Thử hỏi...
${derived.callerDisplayName}: Em...
${derived.guestShortLabel}: Bạn có thể...

TUYỆT ĐỐI CẤM:
- Mô tả nội tâm hoặc hành động nhân vật
- Chỉ dẫn sân khấu trong ngoặc đơn hay ngoặc vuông
- Dấu sao hoặc dấu gạch nối mô tả hành động
- Tiêu đề "Phần 1", "Phần 2"...
- Xuống dòng giữa một lượt thoại
- PHẢI đạt ${targetChars} ký tự
`.trim();

  if (provider === "openai") return generateWithOpenAI(key, context, systemPrompt);
  return generateWithGemini(key, context, systemPrompt, model, 0.75, tokens);
}

async function generateCounseling(
  key: string,
  provider: "gemini" | "openai",
  model: string,
  context: string,
  previousContent: string,
  derived: {
    hostLabel: string;
    guestShortLabel: string;
    guestFullLabel: string;
    callerDisplayName: string;
  },
  targetChars: number,
  phaseIndex: number,
  totalCounselingPhases: number
): Promise<string> {
  const tokens = Math.min(65536, Math.max(8192, Math.ceil(targetChars * 1.6)));
  const isLast = phaseIndex === totalCounselingPhases - 1;

  const systemPrompt = `
Bạn là biên kịch Radio chuyên nghiệp. Viết PHẦN TƯ VẤN ${phaseIndex + 1}/${totalCounselingPhases} của kịch bản.
MỤC TIÊU ĐỘ DÀI: Viết ĐÚNG ${targetChars} ký tự. Không được dừng trước khi đạt đủ số ký tự.

=== NHÂN VẬT TRONG PHẦN NÀY ===
CHỈ CÓ HAI NHÂN VẬT: "${derived.guestShortLabel}" và "${derived.callerDisplayName}".
TUYỆT ĐỐI CẤM "${derived.hostLabel}" (MC) xuất hiện trong phần này.
Nếu bạn định viết "${derived.hostLabel}:" → xóa đi, thay bằng lời thoại của ${derived.guestShortLabel} hoặc ${derived.callerDisplayName}.

=== QUY TẮC NỐI TIẾP ===
Đây là phần TIẾP NỐI. CẤM chào hỏi lại. CẤM giới thiệu lại nhân vật.
Bắt đầu ngay bằng lời thoại nối tiếp cuộc hội thoại trước.

=== NHIỆM VỤ PHẦN NÀY ===
${derived.guestShortLabel} (${derived.guestFullLabel}) tư vấn chuyên sâu cho "${derived.callerDisplayName}":
- Phân tích nguyên nhân, bối cảnh vấn đề từ synopsis
- Hỏi thêm các câu hỏi khai thác chi tiết
- Giải thích rõ từng khía cạnh của vấn đề một cách sâu sắc
- "${derived.callerDisplayName}" phản hồi, chia sẻ thêm chi tiết
${isLast ? `- Kết thúc phần này với ${derived.guestShortLabel} bắt đầu đưa ra lời khuyên tổng kết` : "- Duy trì mạch hội thoại tự nhiên, chưa đến phần kết"}

=== XƯNG HÔ BẮT BUỘC ===
- "${derived.callerDisplayName}" xưng hô bằng "em" hoặc "tôi". TUYỆT ĐỐI CẤM dùng "cháu".
- "${derived.guestShortLabel}" gọi thính giả là "bạn" hoặc "anh/chị" tuỳ giới tính.

=== ĐỊNH DẠNG LỜI THOẠI BẮT BUỘC ===
Mỗi lượt thoại viết trên MỘT DÒNG DUY NHẤT:
Tên: [nội dung lời thoại đủ dài, chi tiết]

TUYỆT ĐỐI CẤM:
- Mô tả nội tâm hoặc hành động nhân vật
- Chỉ dẫn sân khấu trong ngoặc đơn hay ngoặc vuông
- Dấu sao hoặc dấu gạch nối mô tả hành động
- Xuống dòng giữa một lượt thoại
- PHẢI đạt đủ ${targetChars} ký tự

LỊCH SỬ HỘI THOẠI (để nối tiếp):
"""
${previousContent.slice(-3000)}
"""
`.trim();

  if (provider === "openai") return generateWithOpenAI(key, context, systemPrompt);
  return generateWithGemini(key, context, systemPrompt, model, 0.75, tokens);
}

async function generateClosing(
  key: string,
  provider: "gemini" | "openai",
  model: string,
  context: string,
  previousContent: string,
  derived: {
    programLabel: string;
    hostLabel: string;
    guestShortLabel: string;
    callerDisplayName: string;
  },
  targetChars: number
): Promise<string> {
  const tokens = Math.min(65536, Math.max(4096, Math.ceil(targetChars * 1.6)));

  const systemPrompt = `
Bạn là biên kịch Radio chuyên nghiệp. Viết PHẦN KẾT THÚC của kịch bản.
MỤC TIÊU ĐỘ DÀI: Viết ĐÚNG ${targetChars} ký tự.

=== CẤU TRÚC BẮT BUỘC PHẦN KẾT ===
BƯỚC 1 — Lời khuyên chốt hạ:
  - "${derived.guestShortLabel}" đúc kết 3-4 lời khuyên cụ thể, thiết thực từ toàn bộ cuộc tư vấn.
  - Lời khuyên phải thực hành được, không chung chung.

BƯỚC 2 — Lời động viên và cảm ơn:
  - "${derived.guestShortLabel}" gửi lời động viên ấm áp đến "${derived.callerDisplayName}".
  - "${derived.callerDisplayName}" cảm ơn và chia sẻ cảm xúc sau buổi tư vấn.
  - "${derived.callerDisplayName}" dùng "em" hoặc "tôi" khi nói. TUYỆT ĐỐI CẤM dùng "cháu".

BƯỚC 3 — MC đóng chương trình:
  - "${derived.hostLabel}" cảm ơn khách mời "${derived.guestShortLabel}".
  - "${derived.hostLabel}" cảm ơn thính giả "${derived.callerDisplayName}" đã chia sẻ.
  - "${derived.hostLabel}" chào kết chương trình "${derived.programLabel}" và hẹn gặp lại.

=== ĐỊNH DẠNG LỜI THOẠI BẮT BUỘC ===
Mỗi lượt thoại viết trên MỘT DÒNG DUY NHẤT:
Tên: [nội dung lời thoại]

TUYỆT ĐỐI CẤM:
- Mô tả nội tâm hoặc hành động nhân vật
- Chỉ dẫn sân khấu trong ngoặc đơn hay ngoặc vuông
- Dấu sao hoặc dấu gạch nối mô tả hành động
- Xuống dòng giữa một lượt thoại
- PHẢI đạt ${targetChars} ký tự

LỊCH SỬ HỘI THOẠI (để nối tiếp):
"""
${previousContent.slice(-2000)}
"""
`.trim();

  if (provider === "openai") return generateWithOpenAI(key, context, systemPrompt);
  return generateWithGemini(key, context, systemPrompt, model, 0.72, tokens);
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────
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

    const cfg = config as HealthConfig;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";

    // Auth
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("*").eq("id", userId).single();

    if (!profile || profile.status !== "approved") {
      return NextResponse.json({ error: "Truy cập bị từ chối." }, { status: 403 });
    }

    const key = await resolveProviderKey(profile, provider);
    if (!key) {
      return NextResponse.json(
        { error: `Chưa cấu hình API key cho ${provider}.` },
        { status: 403 }
      );
    }

    if (!cfg.detailedIdea?.trim()) {
      return NextResponse.json(
        { error: "Vui lòng nhập synopsis / ý tưởng kịch bản." },
        { status: 400 }
      );
    }

    // ── Derived labels ──────────────────────────────────────
    const programLabel = cfg.programName?.trim() || "Radio Sức Khỏe";
    const formatLabel =
      cfg.format === "STUDIO_PODCAST"
        ? "PODCAST STUDIO — MC, khách mời và thính giả ngồi trực tiếp tại trường quay"
        : "HOTLINE RADIO — thính giả kết nối qua điện thoại";

    const hostLabel  = cfg.hostName?.trim() || "MC";
    const hostPronoun = cfg.hostGender === "Nam" ? "Nam giới (anh)" : "Nữ giới (chị)";

    const guestRoleType  = cfg.doctorRole === "DOCTOR" ? "Bác sĩ" : "Chuyên gia tâm lý";
    const guestFullLabel = cfg.doctorName?.trim()
      ? `${guestRoleType} ${cfg.doctorName.trim()}`
      : guestRoleType;
    const guestShortLabel = cfg.doctorName?.trim() || guestRoleType;
    const guestPronoun = cfg.doctorGender === "Nữ" ? "Nữ giới (chị)" : "Nam giới (anh)";

    let callerDisplayName = "";
    let callerContext = "";
    let openingInstruction = "";

    if (cfg.callerIdentityMode === "NAME") {
      callerDisplayName    = cfg.callerName?.trim() || "bạn";
      callerContext        = `Thính giả gọi vào bằng tên thật.`;
      openingInstruction   = `MC chào mừng thính giả "${callerDisplayName}" đến với chương trình, hỏi thăm sức khỏe và tình trạng hiện tại.`;
    } else if (cfg.callerIdentityMode === "ANONYMOUS") {
      callerDisplayName    = "Thính giả";
      callerContext        = `Thính giả giấu tên, MC không được gọi tên riêng.`;
      openingInstruction   = `MC chào thính giả ẩn danh. TUYỆT ĐỐI không xưng tên, chỉ gọi là "bạn thính giả".`;
    } else {
      // LOCATION
      callerDisplayName    = cfg.callerName?.trim() || "bạn";
      callerContext        = `Thính giả được nhận dạng qua địa danh.`;
      openingInstruction   = `MC BẮT BUỘC mở đầu cuộc gọi: "${callerDisplayName} mình đâu ạ?" rồi chào hỏi theo địa danh. Chỉ gọi bằng địa danh, không xưng tên riêng.`;
    }

    const derived = {
      programLabel, formatLabel,
      hostLabel, hostPronoun,
      guestRoleType, guestFullLabel, guestShortLabel, guestPronoun,
      callerDisplayName, callerContext, openingInstruction,
    };

    // Context đầy đủ
    const context = buildContext(cfg, derived);

    // ── Phân chia ký tự ─────────────────────────────────────
    const total    = cfg.charCount || 20000;
    const opening  = Math.floor(total * 0.13);
    const closing  = Math.floor(total * 0.12);
    const counselingTotal = total - opening - closing;

    // Tư vấn chia thành nhiều sub-phase nếu dài
    const maxPerPhase = 5000;
    const nCounselingPhases = Math.max(1, Math.ceil(counselingTotal / maxPerPhase));
    const charsPerCounselingPhase = Math.floor(counselingTotal / nCounselingPhases);

    console.log(`[Radio] total=${total} opening=${opening} counseling=${counselingTotal}(×${nCounselingPhases}) closing=${closing}`);

    // ── PHASE 1: Opening ─────────────────────────────────────
    console.log("[Radio] Phase 1: Opening...");
    const openingText = await generateOpening(
      key, provider, geminiModel, context, derived, opening
    );
    console.log(`[Radio] Opening: ${openingText.length} chars`);

    let accumulated = openingText;

    // ── PHASE 2: Counseling ──────────────────────────────────
    const counselingParts: string[] = [];
    for (let i = 0; i < nCounselingPhases; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      console.log(`[Radio] Phase 2.${i + 1}/${nCounselingPhases}: Counseling...`);
      const part = await generateCounseling(
        key, provider, geminiModel,
        context, accumulated,
        { hostLabel, guestShortLabel, guestFullLabel, callerDisplayName },
        charsPerCounselingPhase, i, nCounselingPhases
      );
      console.log(`[Radio] Counseling ${i + 1}: ${part.length} chars`);
      counselingParts.push(part);
      accumulated += "\n\n" + part;
    }

    // ── PHASE 3: Closing ─────────────────────────────────────
    await new Promise((r) => setTimeout(r, 1000));
    console.log("[Radio] Phase 3: Closing...");
    const closingText = await generateClosing(
      key, provider, geminiModel,
      context, accumulated,
      { programLabel, hostLabel, guestShortLabel, callerDisplayName },
      closing
    );
    console.log(`[Radio] Closing: ${closingText.length} chars`);

    // ── Ghép + post-process ──────────────────────────────────
    const rawScript = [openingText, ...counselingParts, closingText]
      .join("\n\n");

    const finalScript = postProcess(rawScript);
    console.log(`[Radio] Final: ${finalScript.length} chars`);

    if (finalScript.length < 100) {
      throw new Error("Kịch bản tạo ra quá ngắn. Vui lòng thử lại.");
    }

    // Log usage
    await Promise.all([
      supabaseAdmin.from("usage_logs").insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `Radio Sức Khỏe (${provider}/${provider === "gemini" ? geminiModel : "gpt-4.1-mini"})`,
        char_count: finalScript.length,
      }),
      supabaseAdmin
        .from("profiles")
        .update({ last_active_at: new Date().toISOString(), current_ip: ip })
        .eq("id", userId),
    ]);

    return NextResponse.json({
      result: finalScript,
      sections: 2 + nCounselingPhases,
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
