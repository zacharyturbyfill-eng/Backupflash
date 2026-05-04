import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const supabaseAdmin = createSupabaseAdminClient();

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export interface ThumbnailConcept {
  analysis: string;
  emotion: string;
  idea: string;
  prompt: string;
  keywords: string[];
  layout: string;
}

// ─────────────────────────────────────────────────────────────
// Shared key resolver (same pattern as radio-health, medical3, etc.)
// ─────────────────────────────────────────────────────────────
async function resolveGeminiKey(profile: any): Promise<string> {
  const direct = profile?.api_keys?.gemini || "";
  if (direct) return direct;
  const { data: vault } = await supabaseAdmin
    .from("api_vault")
    .select("api_key")
    .eq("provider", "gemini")
    .single();
  return vault?.api_key || "";
}

// ─────────────────────────────────────────────────────────────
// Core generation logic
// ─────────────────────────────────────────────────────────────
async function generateThumbnailConcept(
  apiKey: string,
  title: string,
  imageBase64: string,
  mimeType: string,
  geminiModel: string,
  retryCount = 0
): Promise<ThumbnailConcept> {
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

  const prompt = `
Bạn là chuyên gia thiết kế Thumbnail YouTube triệu view cho kênh Sức khỏe & Đời sống.

QUAN TRỌNG: Ảnh đính kèm là ảnh tham chiếu nhân vật đã có sẵn.
KHÔNG cần mô tả ngoại hình (da, tóc, chiều cao, trang phục) — AI image tool đã có reference.
Hãy TẬP TRUNG hoàn toàn vào 3 yếu tố chính:
  1. BIỂU CẢM (Expression): Phân tích biểu cảm hiện tại trong ảnh, đề xuất biểu cảm mạnh hơn phù hợp tiêu đề "${title}"
  2. ĐẠO CỤ (Props): Đạo cụ nào nên cầm/tương tác để truyền tải chủ đề (chai thuốc, rau củ, thiết bị, sản phẩm...)
  3. TƯ THẾ & ÁNH SÁNG: Tư thế tay, hướng nhìn, góc người, loại ánh sáng kịch tính

QUY TẮC BỐ CỤC "STRICT 30/70" BẮT BUỘC:
- TRÁI 30%: Nhân vật cận cảnh từ ngực lên, tay cầm đạo cụ, mắt hướng phải dẫn người xem vào vùng text
- PHẢI 70%: Không gian trống tuyệt đối / Ultra Deep Bokeh — vùng chèn text, KHÔNG có chi tiết nào

AI IMAGE PROMPT phải:
- BẮT BUỘC bắt đầu: "Using provided reference image of the subject,"
- Tập trung: biểu cảm + micro-expression, đạo cụ cụ thể, tư thế tay, ánh sáng dramatic
- KHÔNG mô tả ngoại hình người (đã có reference image)
- Kết thúc kỹ thuật: "subject on far left 30%, massive empty space right 70% for text overlay, cinematic rim lighting, dramatic shadows, 8K sharp, 16:9 YouTube thumbnail"

ĐỊNH DẠNG TRẢ VỀ JSON (KHÔNG markdown, chỉ JSON thuần):
{
  "analysis": "Phân tích tại sao biểu cảm + đạo cụ này sẽ gây click mạnh cho tiêu đề này. Giải thích chiến lược 30/70.",
  "emotion": "Biểu cảm CỤ THỂ cần thể hiện (VD: Ánh mắt kiên định + nụ cười một bên, lông mày hơi nhướng — thể hiện sự tự tin về kiến thức)",
  "idea": "Mô tả chi tiết: đạo cụ cầm tay là gì + cách cầm, tư thế tay + góc nghiêng người, ánh đèn rim light từ đâu, background bokeh màu gì",
  "prompt": "Using provided reference image of the subject, [biểu cảm micro-expression cực kỳ cụ thể], [đạo cụ + cách cầm/tương tác], [tư thế tay + góc người], [dramatic cinematic lighting type], subject occupies left 30% of frame medium close-up chest up, gaze directed right, right 70% is pure empty space ultra deep bokeh gradient for text overlay, extreme rule of thirds, cinematic rim lighting dramatic shadows, 8K sharp, 16:9 YouTube thumbnail format",
  "keywords": ["TỪ KHÓA TEXT CHÍNH", "TỪ KHÓA PHỤ", "TỪ KHÓA 3"],
  "layout": "Vị trí text chính xác trong vùng 70% phải: gợi ý cỡ chữ, màu nền gradient tương phản, điểm nhấn màu highlight"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64,
                mimeType: (mimeType || "image/jpeg") as any,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim() || "";
    if (!text) throw new Error("AI trả về kết quả rỗng.");

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as ThumbnailConcept;
  } catch (error: any) {
    const status = error?.status || error?.code || 0;
    const msg = (error?.message || "").toLowerCase();
    if (
      (status === 503 || status === 429 || msg.includes("overloaded") || msg.includes("demand")) &&
      retryCount < 3
    ) {
      const delay = 2000 * (retryCount + 1);
      await new Promise((r) => setTimeout(r, delay));
      return generateThumbnailConcept(apiKey, title, imageBase64, mimeType, geminiModel, retryCount + 1);
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, title, imageBase64, mimeType, geminiModel: rawModel } = body;

    if (!userId || !title?.trim() || !imageBase64) {
      return NextResponse.json(
        { error: "Thiếu userId, tiêu đề hoặc ảnh." },
        { status: 400 }
      );
    }

    const geminiModel =
      rawModel === "gemini-2.5-flash" ? "gemini-2.5-flash" : "gemini-2.5-flash-lite";

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";

    // Auth & profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (!profile || profile.status !== "approved") {
      return NextResponse.json({ error: "Truy cập bị từ chối." }, { status: 403 });
    }

    const apiKey = await resolveGeminiKey(profile);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Chưa cấu hình Gemini API key." },
        { status: 403 }
      );
    }

    const concept = await generateThumbnailConcept(
      apiKey,
      title.trim(),
      imageBase64,
      mimeType || "image/jpeg",
      geminiModel
    );

    // Log usage
    await Promise.all([
      supabaseAdmin.from("usage_logs").insert({
        user_id: userId,
        user_email: profile.email,
        tool_name: `Thumbnail Master AI (${geminiModel})`,
        char_count: JSON.stringify(concept).length,
      }),
      supabaseAdmin
        .from("profiles")
        .update({ last_active_at: new Date().toISOString(), current_ip: ip })
        .eq("id", userId),
    ]);

    return NextResponse.json({ concept });
  } catch (error: any) {
    console.error("Thumbnail API Error:", error);
    return NextResponse.json(
      { error: error?.message || "Lỗi hệ thống Thumbnail AI." },
      { status: 500 }
    );
  }
}
