"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  Sparkles, Type, Volume2, Mic, Video, Settings, LogOut,
  Loader2, Copy, Check, Cpu, Zap, HeartPulse, User,
  Upload, X, Image as ImageIcon, Layout, AlignLeft,
  Tag, Layers, Download,
} from "lucide-react";
import SystemAnnouncementBanner from "@/components/SystemAnnouncementBanner";

interface ThumbnailConcept {
  analysis: string;
  emotion: string;
  idea: string;
  prompt1: string;
  prompt2: string;
  keywords: string[];
  layout: string;
}

const SIDEBAR_ITEMS = [
  { label: "Làm Sạch Transcript", path: "/dashboard/cleaner", icon: "sparkles" },
  { label: "Tool viết lại truyện", path: "/dashboard/rewriter", icon: "type" },
  { label: "Giọng Nói AI (ai84)", path: "/dashboard/voice", icon: "volume2" },
  { label: "Giọng Nói AI (ai33)", path: "/dashboard/voice-ai33", icon: "volume2-cyan" },
  { label: "Podcast Studio", path: "/dashboard/podcast", icon: "mic" },
  { label: "Tạo Prompt Video", path: "/dashboard/prompter", icon: "video-prompter" },
  { label: "Radio Sức Khỏe", path: "/dashboard/radio-health", icon: "heartpulse" },
  { label: "Prompt Medical 3.0", path: "/dashboard/medical3", icon: "video" },
  { label: "Character Prompt", path: "/dashboard/storyboard", icon: "user" },
  { label: "Thumbnail Master AI", path: "/dashboard/thumbnail", icon: "thumbnail", active: true },
];

export default function ThumbnailPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [geminiModel, setGeminiModel] = useState<"gemini-2.5-flash" | "gemini-2.5-flash-lite">("gemini-2.5-flash-lite");

  const [title, setTitle] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string>("");
  const [imageMime, setImageMime] = useState<string>("image/jpeg");

  const [concept, setConcept] = useState<ThumbnailConcept | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Auth
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles").select("status, role").eq("id", session.user.id).single();
      if (!profile || profile.status !== "approved") {
        await supabase.auth.signOut(); router.push("/login"); return;
      }
      setUser({ ...session.user, role: profile.role });
    };
    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) { setErrorText("Chỉ hỗ trợ file ảnh."); return; }
    if (file.size > 10 * 1024 * 1024) { setErrorText("Ảnh tối đa 10MB."); return; }
    setErrorText("");
    setImageFile(file);

    // Resize ảnh xuống max 1280px bằng canvas trước khi encode base64
    // → tránh lỗi "Request Entity Too Large" (Next.js giới hạn body 4MB)
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl); // preview dùng ảnh gốc cho đẹp

      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
          else { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        // Luôn output JPEG để giảm size tối đa
        const resized = canvas.toDataURL("image/jpeg", 0.85);
        setImageMime("image/jpeg");
        setImageBase64(resized.split(",")[1]);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleGenerate = async () => {
    if (!user?.id || !title.trim() || !imageBase64) return;
    setLoading(true);
    setErrorText("");
    setConcept(null);
    try {
      const res = await fetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          title: title.trim(),
          imageBase64,
          mimeType: imageMime,
          geminiModel,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Lỗi tạo concept.");
      setConcept(json.concept);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: any) {
      setErrorText(e?.message || "Lỗi hệ thống.");
    } finally {
      setLoading(false);
    }
  };

  const copyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const SidebarIcon = ({ icon }: { icon: string }) => {
    if (icon === "sparkles") return <Sparkles className="w-5 h-5 flex-shrink-0" />;
    if (icon === "type") return <Type className="w-5 h-5 flex-shrink-0 text-fuchsia-300" />;
    if (icon === "volume2") return <Volume2 className="w-5 h-5 flex-shrink-0" />;
    if (icon === "volume2-cyan") return <Volume2 className="w-5 h-5 flex-shrink-0 text-cyan-400" />;
    if (icon === "mic") return <Mic className="w-5 h-5 flex-shrink-0 text-indigo-400" />;
    if (icon === "heartpulse") return <HeartPulse className="w-5 h-5 flex-shrink-0 text-rose-400" />;
    if (icon === "video") return <Video className="w-5 h-5 flex-shrink-0 text-orange-400" />;
    if (icon === "user") return <User className="w-5 h-5 flex-shrink-0 text-violet-400" />;
    if (icon === "video-prompter") return <Video className="w-5 h-5 flex-shrink-0" />;
    if (icon === "thumbnail") return <ImageIcon className="w-5 h-5 flex-shrink-0 text-amber-400" />;
    return null;
  };

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#020617]">
        <Loader2 className="animate-spin text-amber-400 w-10 h-10" />
      </div>
    );
  }

  const canGenerate = !!title.trim() && !!imageBase64 && !loading;

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 md:w-64 bg-[#0f172a]/80 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 z-20">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
          <div className="w-10 h-10 btn-ombre rounded-xl flex items-center justify-center text-white font-bold text-2xl font-serif shadow-lg">
            S
          </div>
          <span className="ml-3 font-serif font-bold text-xl hidden md:block text-gradient">
            NovaForge AI
          </span>
        </div>
        <nav className="flex-1 py-8 px-3 space-y-1 overflow-y-auto">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              className={`w-full flex items-center p-4 rounded-2xl transition-all group ${
                item.active
                  ? "bg-white/[0.03] text-white border border-white/5 shadow-lg"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <SidebarIcon icon={item.icon} />
              <span className="ml-3 font-medium hidden md:block truncate">{item.label}</span>
            </button>
          ))}
          {user?.role === "admin" && (
            <button
              onClick={() => router.push("/admin")}
              className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all"
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
              <span className="ml-3 font-medium hidden md:block">Quản Trị Admin</span>
            </button>
          )}
        </nav>
        <div className="p-6 border-t border-white/5">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all text-sm font-semibold"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden md:block">Đăng Xuất</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto relative p-4 md:p-8">
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-amber-600/8 blur-[140px] rounded-full -z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-[400px] h-[400px] bg-yellow-500/5 blur-[120px] rounded-full -z-10 pointer-events-none" />

        <SystemAnnouncementBanner userId={user?.id} />

        {/* Header */}
        <header className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold text-white font-serif tracking-tight mb-1">
              <span className="bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">
                Thumbnail Master AI
              </span>
            </h1>
            <p className="text-slate-500 text-[11px] uppercase tracking-widest font-black">
              Expert Content Strategy · Bố cục 30/70 triệu view
            </p>
          </div>
          {/* Model selector */}
          <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
            <button
              onClick={() => setGeminiModel("gemini-2.5-flash-lite")}
              className={`px-3 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest ${
                geminiModel === "gemini-2.5-flash-lite"
                  ? "bg-violet-600 text-white shadow-lg"
                  : "text-slate-500 hover:bg-white/5"
              }`}
            >
              <Zap size={10} className="inline mr-1" />Lite
            </button>
            <button
              onClick={() => setGeminiModel("gemini-2.5-flash")}
              className={`px-3 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest ${
                geminiModel === "gemini-2.5-flash"
                  ? "bg-amber-600 text-white shadow-lg"
                  : "text-slate-500 hover:bg-white/5"
              }`}
            >
              <Cpu size={10} className="inline mr-1" />Flash
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Left: Upload + Title */}
          <div className="space-y-4">
            {/* Image Upload */}
            <div className="glass-card rounded-2xl p-5 border-white/5">
              <label className="block text-[10px] font-black text-amber-300 uppercase tracking-widest mb-3">
                1. Nhân Vật Gốc
              </label>
              {imagePreview ? (
                <div className="relative group">
                  <img
                    src={imagePreview}
                    alt="preview"
                    className="w-full h-52 object-cover rounded-xl border border-white/10"
                  />
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(null); setImageBase64(""); }}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-lg text-slate-300 hover:text-white hover:bg-red-500/70 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-2 left-2 text-[10px] bg-black/60 px-2 py-1 rounded-lg text-amber-300 font-bold">
                    {imageFile?.name}
                  </div>
                </div>
              ) : (
                <div
                  ref={dropRef}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  className="border-2 border-dashed border-amber-500/30 hover:border-amber-500/60 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-all bg-amber-500/5 hover:bg-amber-500/10 group"
                >
                  <Upload className="w-8 h-8 text-amber-400/60 group-hover:text-amber-400 transition-all" />
                  <p className="text-sm text-slate-400 text-center">
                    Kéo thả hoặc <span className="text-amber-400 font-semibold">click để chọn ảnh</span>
                  </p>
                  <p className="text-[10px] text-slate-600">PNG, JPG · Tối đa 10MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
              />
            </div>

            {/* Title */}
            <div className="glass-card rounded-2xl p-5 border-white/5">
              <label className="block text-[10px] font-black text-amber-300 uppercase tracking-widest mb-3">
                2. Tiêu Đề Video
              </label>
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: 5 Loại Rau Giải Độc Gan Siêu Đỉnh Mà Bạn Chưa Biết"
                className="w-full h-24 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-amber-500/50 transition-all resize-none leading-relaxed"
              />
              <p className="text-[10px] text-slate-600 mt-1">{title.length} ký tự</p>
            </div>
          </div>

          {/* Right: Info panel */}
          <div className="glass-card rounded-2xl p-6 border-white/5 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="font-bold text-white text-sm">Quy tắc Bố Cục 30/70</p>
                  <p className="text-[10px] text-slate-500">Tiêu chuẩn thumbnail triệu view</p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Vùng Nhân Vật (Trái 30%)", desc: "Cận cảnh từ ngực trở lên, tay cầm sản phẩm" },
                  { label: "Vùng Text Vàng (Phải 70%)", desc: "Không gian trống cực rộng, nền mờ sâu (Bokeh)" },
                  { label: "AI Prompt English", desc: "Sẵn sàng dán vào Midjourney, Flux, DALL·E" },
                  { label: "Từ Khoá Chèn Text", desc: "3 từ khoá impact tối ưu cho thumbnail" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                    <div className="w-5 h-5 rounded-full bg-amber-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[9px] font-black text-amber-300">{i + 1}</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">{item.label}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-[10px] text-amber-300 font-black uppercase tracking-wider mb-1">Tip</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Dùng ảnh chân dung rõ mặt, ánh sáng tốt. Tiêu đề càng cụ thể thì AI càng tạo được concept sắc nét hơn.
              </p>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <div className="mb-6">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-2xl disabled:opacity-30"
            style={{
              background: loading
                ? "rgba(255,255,255,0.05)"
                : "linear-gradient(135deg, #d97706 0%, #fbbf24 100%)",
              color: "white",
            }}
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Đang phân tích & tạo concept...</span>
              </>
            ) : (
              <>
                <ImageIcon className="w-5 h-5" />
                Tạo Thumbnail Concept
              </>
            )}
          </button>
          {errorText && (
            <div className="mt-3 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
              {errorText}
            </div>
          )}
          {!imageBase64 && !loading && (
            <p className="mt-2 text-center text-[11px] text-slate-600">
              {!imageBase64 ? "⬆ Tải ảnh nhân vật lên" : ""}{!title.trim() && !imageBase64 ? " & " : ""}{!title.trim() ? "nhập tiêu đề video" : ""} để bắt đầu
            </p>
          )}
        </div>

        {/* Result */}
        {concept && (
          <div ref={resultRef} className="space-y-4 mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 h-px bg-gradient-to-r from-amber-500/50 to-transparent" />
              <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Kết Quả Phân Tích</span>
              <div className="flex-1 h-px bg-gradient-to-l from-amber-500/50 to-transparent" />
            </div>

            {/* Emotion + Keywords row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card rounded-2xl p-5 border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Cảm Xúc Chủ Đạo</p>
                </div>
                <p className="text-white font-semibold text-sm leading-relaxed">{concept.emotion}</p>
              </div>
              <div className="glass-card rounded-2xl p-5 border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Tag className="w-4 h-4 text-amber-400" />
                  <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Từ Khoá Chèn Text</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {concept.keywords?.map((kw, i) => (
                    <button
                      key={i}
                      onClick={() => copyText(kw, `kw-${i}`)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-200 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center gap-1"
                    >
                      {copiedField === `kw-${i}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Analysis */}
            <ResultCard
              icon={<Layers className="w-4 h-4 text-amber-400" />}
              label="Chiến Lược Bố Cục"
              content={concept.analysis}
              field="analysis"
              copiedField={copiedField}
              onCopy={copyText}
            />

            {/* Idea */}
            <ResultCard
              icon={<ImageIcon className="w-4 h-4 text-amber-400" />}
              label="Mô Tả Cảnh Quay"
              content={concept.idea}
              field="idea"
              copiedField={copiedField}
              onCopy={copyText}
            />

            {/* Layout */}
            <ResultCard
              icon={<Layout className="w-4 h-4 text-amber-400" />}
              label="Vị Trí & Màu Sắc Text"
              content={concept.layout}
              field="layout"
              copiedField={copiedField}
              onCopy={copyText}
            />

            {/* AI Prompt 1 */}
            <div className="glass-card rounded-2xl p-5 border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlignLeft className="w-4 h-4 text-amber-400" />
                  <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">AI Prompt #1</p>
                </div>
                <button
                  onClick={() => copyText(concept.prompt1, "prompt1")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-black uppercase tracking-wider hover:bg-amber-500/30 transition-all"
                >
                  {copiedField === "prompt1" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedField === "prompt1" ? "Đã sao chép" : "Copy"}
                </button>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed font-mono bg-black/30 rounded-xl p-4 border border-white/5 select-all">
                {concept.prompt1}
              </p>
            </div>

            {/* AI Prompt 2 */}
            <div className="glass-card rounded-2xl p-5 border-indigo-500/20 bg-indigo-500/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <AlignLeft className="w-4 h-4 text-indigo-400" />
                  <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">AI Prompt #2</p>
                </div>
                <button
                  onClick={() => copyText(concept.prompt2, "prompt2")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[10px] font-black uppercase tracking-wider hover:bg-indigo-500/30 transition-all"
                >
                  {copiedField === "prompt2" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedField === "prompt2" ? "Đã sao chép" : "Copy"}
                </button>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed font-mono bg-black/30 rounded-xl p-4 border border-white/5 select-all">
                {concept.prompt2}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ResultCard({
  icon, label, content, field, copiedField, onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  content: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 border-white/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">{label}</p>
        </div>
        <button
          onClick={() => onCopy(content, field)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:text-amber-300 hover:bg-amber-500/10 transition-all text-[10px] font-bold"
        >
          {copiedField === field ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <p className="text-sm text-slate-300 leading-relaxed">{content}</p>
    </div>
  );
}
