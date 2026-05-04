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
  prompt1: string;
  prompt2: string;
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
KHÔNG mô tả ngoại hình (da, tóc, trang phục) — AI image tool đã có reference.
TẬP TRUNG vào:
  1. BIỂU CẢM (Expression): Đề xuất biểu cảm cụ thể, mạnh mẽ phù hợp tiêu đề "${title}"
  2. ĐẠO CỤ (Props): Đạo cụ nên cầm tay để truyền tải chủ đề (Chỉ nhắc: "hand holding product")
  3. TƯ THẾ: Tư thế phải cân đối chính giữa, nhìn thẳng (KHÔNG nghiêng người)

QUY TẮC BỐ CỤC "STRICT 30/70" BẮT BUỘC:
- TRÁI 30%: Nhân vật cận cảnh từ ngực lên, tư thế cân đối chính giữa, nhìn thẳng, tay cầm sản phẩm.
- PHẢI 70%: Không gian trống hoàn toàn, Ultra Deep Bokeh — vùng chèn text.
- TUYỆT ĐỐI KHÔNG CÓ CHỮ (NO TEXT): Ảnh gen ra phải sạch hoàn toàn, không có bất kỳ chữ, ký tự hay văn bản nào.

Hai AI IMAGE PROMPT phải:
- BẮT BUỘC bắt đầu: "Using provided reference image of the subject,"
- Tập trung: biểu cảm micro-expression + đạo cụ + tư thế cân đối chính giữa.
- KHÔNG mô tả ngoại hình, KHÔNG mô tả ánh sáng chi tiết, KHÔNG nghiêng người.
- TUYỆT ĐỐI KHÔNG có chữ: Thêm các từ khóa "no text, no letters, no words, clean background".
- Kết thúc: "subject on far left 30% of the frame, centered balanced front-facing posture, massive empty space right 70% for text overlay, ultra deep bokeh, no text, no letters, no words, 8K, 16:9 YouTube thumbnail"

ĐỊNH DẠNG JSON (KHÔNG markdown):
{
  "analysis": "Chiến lược bố cục + lý do biểu cảm này gây click mạnh",
  "emotion": "Biểu cảm CỤ THỂ (VD: Ánh mắt kiên định, lông mày hơi nhướng, nụ cười một bên tự tin)",
  "idea": "Mô tả ngắn: đạo cụ cầm tay, tư thế cân đối chính giữa nhìn thẳng",
  "prompt1": "Using provided reference image of the subject, [biểu cảm version A cực kỳ cụ thể], hand holding product, centered balanced front-facing posture, subject on far left 30% of the frame, massive empty space right 70% for text overlay, ultra deep bokeh, no text, no letters, no words, 8K, 16:9 YouTube thumbnail",
  "prompt2": "Using provided reference image of the subject, [biểu cảm version B khác biệt với A], hand holding product, centered balanced front-facing posture, subject on far left 30% of the frame, massive empty space right 70% for text overlay, ultra deep bokeh, no text, no letters, no words, 8K, 16:9 YouTube thumbnail",
  "keywords": ["TỪ KHÓA TEXT CHÍNH", "TỪ KHÓA PHỤ", "TỪ KHÓA 3"],
  "layout": "Vị trí và màu text trong vùng 70% phải"
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
