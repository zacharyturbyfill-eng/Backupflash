import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const supabaseAdmin = createSupabaseAdminClient();

export const maxDuration = 60;

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
Bạn là chuyên gia thiết kế Thumbnail YouTube triệu view cho các kênh về Sức khỏe, Đời sống và Review.

Nhiệm vụ: Tạo concept thumbnail dựa trên ảnh gốc nhân vật và tiêu đề: "${title}".

QUY TẮC BỐ CỤC "STRICT 30/70" BẮT BUỘC:
1. VÙNG NHÂN VẬT (TRÁI 30%):
   - Nhân vật chiếm chính xác 30% diện tích khung hình bên trái.
   - Cận cảnh từ ngực trở lên (Medium Close-up).
   - Tay cầm sản phẩm hoặc mẫu vật phải nằm gọn trong vùng 30% này.
   - Hướng nhìn: Hơi nghiêng về phía bên phải (vùng 70%) để dẫn dắt mắt người xem vào nội dung chữ sẽ chèn sau.
2. VÙNG TEXT VÀNG (PHẢI 70%):
   - Phải là không gian trống cực rộng hoặc phông nền cực kỳ mờ (Ultra Deep Bokeh).
   - Tuyệt đối không có chi tiết thừa lấn vào vùng 70% này để đảm bảo text khi chèn vào sẽ cực kỳ nổi bật.
3. CHI TIẾT PROMPT KỸ THUẬT:
   - Sử dụng các từ khóa: "Extreme rule of thirds", "Character positioned on the far left 30% vertical section", "Massive empty space on the right 70%", "Clean background for text overlay", "Wide angle 16:9".

ĐỊNH DẠNG TRẢ VỀ JSON (KHÔNG thêm markdown, chỉ JSON thuần):
{
  "analysis": "Chiến lược bố cục: Tại sao tỷ lệ 30/70 lại tối ưu cho tiêu đề này?",
  "emotion": "Cảm xúc chủ đạo",
  "idea": "Mô tả: Tư thế nhân vật ở vùng 30% trái, mẫu vật trên tay, độ mờ của vùng 70% phải",
  "prompt": "Highly detailed AI Image Prompt (English). MUST mandate: 'Subject positioned exactly on the left 30% of the frame', 'Right 70% is massive empty space with deep bokeh for text overlay', 'Hand holding product within the left section', 'Cinematic 8k', '16:9'.",
  "keywords": ["TEXT 1", "TEXT 2", "TEXT 3"],
  "layout": "Vị trí đặt text chính xác trong vùng 70% phải, gợi ý màu sắc tương phản mạnh với nền"
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
