"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Type,
  Volume2,
  Mic,
  Video,
  Settings,
  LogOut,
  Loader2,
  Copy,
  Check,
  Cpu,
  Zap,
  HeartPulse,
  User,
} from "lucide-react";
import SystemAnnouncementBanner from "@/components/SystemAnnouncementBanner";

type HealthFormat = "STUDIO_PODCAST" | "HOTLINE_CALL";
type DoctorRole = "DOCTOR" | "PSYCHOLOGIST";
type CallerMode = "NAME" | "ANONYMOUS" | "LOCATION";

const SIDEBAR_ITEMS = [
  { label: "Làm Sạch Transcript", path: "/dashboard/cleaner", icon: "sparkles" },
  { label: "Tool viết lại truyện", path: "/dashboard/rewriter", icon: "type" },
  { label: "Giọng Nói AI (ai84)", path: "/dashboard/voice", icon: "volume2" },
  { label: "Giọng Nói AI (ai33)", path: "/dashboard/voice-ai33", icon: "volume2-cyan" },
  { label: "Podcast Studio", path: "/dashboard/podcast", icon: "mic" },
  { label: "Tạo Prompt Video", path: "/dashboard/prompter", icon: "video-prompter" },
  { label: "Radio Sức Khỏe", path: "/dashboard/radio-health", icon: "heartpulse", active: true },
  { label: "Prompt Medical 3.0", path: "/dashboard/medical3", icon: "video" },
  { label: "Character Prompt", path: "/dashboard/storyboard", icon: "user" },
];

export default function RadioHealthPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [provider, setProvider] = useState<"gemini" | "openai">("gemini");
  const [geminiModel, setGeminiModel] = useState<"gemini-2.5-flash" | "gemini-2.5-flash-lite">(
    "gemini-2.5-flash-lite"
  );

  // Config state
  const [programName, setProgramName] = useState("");
  const [format, setFormat] = useState<HealthFormat>("STUDIO_PODCAST");
  const [hostName, setHostName] = useState("");
  const [hostGender, setHostGender] = useState("Nữ");
  const [doctorName, setDoctorName] = useState("");
  const [doctorGender, setDoctorGender] = useState("Nam");
  const [doctorRole, setDoctorRole] = useState<DoctorRole>("DOCTOR");
  const [callerIdentityMode, setCallerIdentityMode] = useState<CallerMode>("NAME");
  const [callerName, setCallerName] = useState("");
  const [detailedIdea, setDetailedIdea] = useState("");
  const [sampleScript, setSampleScript] = useState("");
  const [characterDNA, setCharacterDNA] = useState("");
  const [charCount, setCharCount] = useState(20000);

  // Output state
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const [progressStep, setProgressStep] = useState("");
  const [errorText, setErrorText] = useState("");
  const [copied, setCopied] = useState(false);

  const outputChars = result.length;

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("status, role")
        .eq("id", session.user.id)
        .single();
      if (!profile || profile.status !== "approved") {
        await supabase.auth.signOut();
        router.push("/login");
        return;
      }
      setUser({ ...session.user, role: profile.role });
    };
    checkAuth();
  }, [router]);

  const handleGenerate = async () => {
    if (!user?.id || !detailedIdea.trim() || !sampleScript.trim()) return;
    if (loading) return; // ← Chống double-click / double-trigger
    setLoading(true);
    setErrorText("");
    setResult("");
    setProgressStep("Đang phân tích ý tưởng và tạo dàn ý...");

    const steps = [
      "Đang phân tích ý tưởng và tạo dàn ý...",
      "Đang biên tập từng phần kịch bản...",
      "Đang rà soát nhân vật và xưng hô...",
      "Đang hoàn thiện kịch bản cuối cùng...",
    ];
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      stepIdx = (stepIdx + 1) % steps.length;
      setProgressStep(steps[stepIdx]);
    }, 4000);

    try {
      const res = await fetch("/api/radio-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          provider,
          geminiModel,
          config: {
            programName,
            format,
            hostName,
            hostGender,
            doctorName,
            doctorGender,
            doctorRole,
            callerIdentityMode,
            callerName,
            detailedIdea,
            sampleScript,
            characterDNA,
            charCount,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Lỗi tạo kịch bản.");
      if (!json.result) throw new Error(`AI trả về kết quả rỗng.`);
      setResult(json.result);
      // Auto-scroll xuống kết quả
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e: any) {
      setErrorText(e?.message || "Lỗi hệ thống.");
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
      setProgressStep("");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
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
    return null;
  };

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#020617]">
        <Loader2 className="animate-spin text-rose-400 w-10 h-10" />
      </div>
    );
  }

  const callerPlaceholder =
    callerIdentityMode === "LOCATION"
      ? "VD: Hà Nội, Hải Phòng..."
      : callerIdentityMode === "ANONYMOUS"
      ? "Thính giả giấu tên"
      : "Nhập tên thính giả";

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
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-rose-600/8 blur-[140px] rounded-full -z-10 pointer-events-none" />
        <SystemAnnouncementBanner userId={user?.id} />

        {/* Header */}
        <header className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-4xl font-bold text-white font-serif tracking-tight mb-1">
              <span className="bg-gradient-to-r from-rose-400 to-orange-400 bg-clip-text text-transparent">
                Radio Sức Khỏe AI
              </span>
            </h2>
            <p className="text-slate-500 text-[11px] uppercase tracking-widest font-black">
              Biên kịch tự động · Outline → Phần → Finalize
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Provider */}
            <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
              <button
                onClick={() => setProvider("gemini")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
                  provider === "gemini" ? "btn-ombre text-white shadow-lg" : "text-slate-500 hover:bg-white/5"
                }`}
              >
                <Cpu size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">Gemini</span>
              </button>
              <button
                onClick={() => setProvider("openai")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${
                  provider === "openai" ? "bg-emerald-600 text-white shadow-lg" : "text-slate-500 hover:bg-white/5"
                }`}
              >
                <Zap size={14} />
                <span className="text-[10px] font-black uppercase tracking-widest">ChatGPT</span>
              </button>
            </div>
            {/* Gemini model */}
            {provider === "gemini" && (
              <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
                <button
                  onClick={() => setGeminiModel("gemini-2.5-flash-lite")}
                  className={`px-3 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest ${
                    geminiModel === "gemini-2.5-flash-lite"
                      ? "bg-violet-600 text-white shadow-lg"
                      : "text-slate-500 hover:bg-white/5"
                  }`}
                >
                  Lite
                </button>
                <button
                  onClick={() => setGeminiModel("gemini-2.5-flash")}
                  className={`px-3 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest ${
                    geminiModel === "gemini-2.5-flash"
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "text-slate-500 hover:bg-white/5"
                  }`}
                >
                  Flash
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Config form */}
        <div className="space-y-6 mb-6">
          {/* Row 1: Tên chương trình + Hình thức */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-5 border-white/5">
              <label className="block text-[10px] font-black text-rose-300 uppercase tracking-widest mb-2">
                Tên Chương Trình Radio
              </label>
              <input
                value={programName}
                onChange={(e) => setProgramName(e.target.value)}
                placeholder="VD: Sức Khỏe Trong Tầm Tay"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-rose-500/50 transition-all"
              />
            </div>
            <div className="glass-card rounded-2xl p-5 border-white/5">
              <label className="block text-[10px] font-black text-rose-300 uppercase tracking-widest mb-2">
                Hình Thức Radio
              </label>
              <div className="flex gap-3">
                {(["STUDIO_PODCAST", "HOTLINE_CALL"] as HealthFormat[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                      format === f
                        ? "bg-rose-600/30 border-rose-500/40 text-rose-200"
                        : "bg-white/5 border-white/10 text-slate-500 hover:bg-white/10"
                    }`}
                  >
                    {f === "STUDIO_PODCAST" ? "🎙 Tại Phòng Thu" : "📞 Hotline Trực Tiếp"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Nhân vật */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* MC */}
            <div className="glass-card rounded-2xl p-5 border-white/5 space-y-3">
              <p className="text-[10px] font-black text-rose-300 uppercase tracking-widest">MC Dẫn Chương Trình</p>
              <input
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="VD: Thành Văn"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-rose-500/50 transition-all"
              />
              <div className="flex gap-2">
                {["Nam", "Nữ"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setHostGender(g)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                      hostGender === g
                        ? "bg-rose-600/40 border border-rose-500/40 text-rose-200"
                        : "bg-white/5 border border-white/10 text-slate-500"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Khách mời */}
            <div className="glass-card rounded-2xl p-5 border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black text-rose-300 uppercase tracking-widest">Khách Mời Tư Vấn</p>
                <div className="flex gap-2">
                  {(["DOCTOR", "PSYCHOLOGIST"] as DoctorRole[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setDoctorRole(r)}
                      className={`py-0.5 px-2 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${
                        doctorRole === r ? "bg-rose-600/40 text-rose-200" : "text-slate-500"
                      }`}
                    >
                      {r === "DOCTOR" ? "Bác Sĩ" : "Chuyên Gia"}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="VD: Thúy Hải"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-rose-500/50 transition-all"
              />
              <div className="flex gap-2">
                {["Nam", "Nữ"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setDoctorGender(g)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                      doctorGender === g
                        ? "bg-rose-600/40 border border-rose-500/40 text-rose-200"
                        : "bg-white/5 border border-white/10 text-slate-500"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Thính giả */}
            <div className="glass-card rounded-2xl p-5 border-white/5 space-y-3">
              <p className="text-[10px] font-black text-rose-300 uppercase tracking-widest">Thính Giả Kết Nối</p>
              <div className="flex gap-1 flex-wrap">
                {(["NAME", "ANONYMOUS", "LOCATION"] as CallerMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setCallerIdentityMode(m)}
                    className={`py-1 px-2 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${
                      callerIdentityMode === m ? "bg-rose-600/40 text-rose-200" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {m === "NAME" ? "Tên" : m === "ANONYMOUS" ? "Ẩn Danh" : "Địa Danh"}
                  </button>
                ))}
              </div>
              <input
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
                placeholder={callerPlaceholder}
                disabled={callerIdentityMode === "ANONYMOUS"}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-rose-500/50 transition-all disabled:opacity-40"
              />
            </div>
          </div>

          {/* Row 3: Ý tưởng + Độ dài */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 glass-card rounded-2xl p-5 border-white/5">
              <label className="block text-[10px] font-black text-rose-300 uppercase tracking-widest mb-2">
                Ý Tưởng / Vấn Đề Cần Khai Thác
              </label>
              <textarea
                value={detailedIdea}
                onChange={(e) => setDetailedIdea(e.target.value)}
                placeholder="VD: Thính giả tâm sự về việc mất ngủ lâu năm, bác sĩ đưa ra lời khuyên và phương pháp điều trị..."
                className="w-full h-24 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-rose-500/50 transition-all resize-none leading-relaxed"
              />
            </div>
            <div className="glass-card rounded-2xl p-5 border-white/5 flex flex-col justify-between">
              <div>
                <label className="block text-[10px] font-black text-rose-300 uppercase tracking-widest mb-1">
                  Độ Dài Kịch Bản
                </label>
                <p className="text-2xl font-black text-white">{charCount.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500">ký tự</p>
              </div>
              <input
                type="range"
                min={5000}
                max={80000}
                step={5000}
                value={charCount}
                onChange={(e) => setCharCount(parseInt(e.target.value))}
                className="w-full accent-rose-500 mt-3"
              />
              <div className="flex justify-between text-[9px] text-slate-600 mt-1">
                <span>5K</span><span>80K</span>
              </div>
            </div>
          </div>

          {/* Row 4: ADN */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-5 border-white/5">
              <label className="block text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-1">
                ADN Phong Cách · Kịch Bản Mẫu
              </label>
              <p className="text-[10px] text-slate-500 italic mb-2">Dán kịch bản có cấu trúc bạn muốn AI học theo.</p>
              <textarea
                value={sampleScript}
                onChange={(e) => setSampleScript(e.target.value)}
                placeholder="Dán kịch bản mẫu tại đây..."
                className="w-full h-40 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:border-indigo-500/50 transition-all resize-none font-mono leading-relaxed"
              />
            </div>
            <div className="glass-card rounded-2xl p-5 border-rose-500/10 border">
              <label className="block text-[10px] font-black text-rose-300 uppercase tracking-widest mb-1">
                ADN Lời Thoại · Giọng Văn Nhân Vật
              </label>
              <p className="text-[10px] text-slate-500 italic mb-2">
                Dán các câu thoại đặc trưng của Đinh Đoàn, Thành Văn, Thúy Hải...
              </p>
              <textarea
                value={characterDNA}
                onChange={(e) => setCharacterDNA(e.target.value)}
                placeholder={`VD: Đinh Đoàn: "Câu chuyện của bạn thực sự làm tôi suy nghĩ..."`}
                className="w-full h-40 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-300 outline-none focus:border-rose-500/50 transition-all resize-none font-mono leading-relaxed"
              />
            </div>
          </div>
        </div>

        {/* Generate button */}
        <div className="mb-6">
          <button
            onClick={handleGenerate}
            disabled={loading || !detailedIdea.trim() || !sampleScript.trim()}
            className="w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-2xl disabled:opacity-30"
            style={{
              background: loading
                ? "rgba(255,255,255,0.05)"
                : "linear-gradient(135deg, #e11d48 0%, #f97316 100%)",
              color: "white",
            }}
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">{progressStep || "Đang biên tập..."}</span>
              </>
            ) : (
              <>
                <HeartPulse className="w-5 h-5" />
                Bắt Đầu Biên Kịch Radio
              </>
            )}
          </button>
          {errorText && (
            <div className="mt-3 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
              {errorText}
            </div>
          )}
        </div>

        {/* DEBUG - xóa sau khi fix */}
        <div className="mb-2 text-xs text-yellow-400 font-mono bg-yellow-400/10 p-2 rounded-lg">
          DEBUG: result.length = {result.length} | loading = {String(loading)} | error = "{errorText}"
        </div>

        {/* Output */}
        {result && (
          <div ref={resultRef} style={{border: '2px solid #f43f5e', borderRadius: '1rem', padding: '1.5rem', marginBottom: '1rem', background: '#0f172a'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
              <span style={{color:'#fb7185', fontWeight:'bold', fontSize:'12px', letterSpacing:'0.1em'}}>
                KỊCH BẢN RADIO HOÀN CHỈNH · {result.length.toLocaleString()} ký tự
              </span>
              <button
                onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                style={{padding:'8px 16px', background:'rgba(244,63,94,0.2)', border:'1px solid rgba(244,63,94,0.4)', borderRadius:'8px', color:'#fda4af', fontSize:'12px', cursor:'pointer'}}
              >
                {copied ? "✓ Đã sao chép" : "Sao chép"}
              </button>
            </div>
            <textarea
              readOnly
              value={result}
              style={{width:'100%', height:'600px', background:'transparent', border:'none', color:'#e2e8f0', fontSize:'13px', lineHeight:'1.8', resize:'vertical', outline:'none', fontFamily:'monospace'}}
            />
          </div>
        )}


      </main>
    </div>
  );
}
