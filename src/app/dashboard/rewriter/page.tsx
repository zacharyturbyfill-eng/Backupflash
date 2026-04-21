"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Trash2,
  Copy,
  Check,
  LogOut,
  Settings,
  Loader2,
  Type,
  Clock,
  Video,
  Volume2,
  Mic,
} from "lucide-react";
import SystemAnnouncementBanner from "@/components/SystemAnnouncementBanner";

export default function RewriterPage() {
  const [user, setUser] = useState<any>(null);
  const [inputText, setInputText] = useState("");
  const [resultText, setResultText] = useState("");
  const [provider, setProvider] = useState<"gemini" | "openai">("gemini");
  const [renameCharacters, setRenameCharacters] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const router = useRouter();

  const inputChars = inputText.length;
  const outputChars = resultText.length;

  const fetchHistory = async (userId: string) => {
    const { data } = await supabase
      .from("usage_logs")
      .select("*")
      .eq("user_id", userId)
      .ilike("tool_name", "Tool viết lại truyện%")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(data || []);
  };

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
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
      fetchHistory(session.user.id);
    };
    checkUser();

    const seeded = localStorage.getItem("rewriter_prefill_text");
    if (seeded) {
      setInputText(seeded);
      localStorage.removeItem("rewriter_prefill_text");
    }
  }, [router]);

  const handleRewrite = async () => {
    if (!inputText.trim() || !user?.id) return;
    setLoading(true);
    setErrorText("");
    setResultText("");
    setProgressStep(1);

    try {
      setTimeout(() => setProgressStep(2), 600);
      setTimeout(() => setProgressStep(3), 1600);

      const res = await fetch("/api/rewrite-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText,
          userId: user.id,
          provider,
          renameCharacters,
        }),
      });
      const json = await res.json();
            if (!res.ok) throw new Error(json?.error || "Lỗi tool viết lại truyện.");
      setResultText(String(json?.result || ""));
      fetchHistory(user.id);
    } catch (error: any) {
      setErrorText(error?.message || "Lỗi hệ thống.");
    } finally {
      setLoading(false);
      setProgressStep(0);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("storycraft_session_id");
    router.push("/login");
  };

  const statusLabel = useMemo(() => {
    if (progressStep === 1) return "Đang chia chunk theo xuống dòng...";
    if (progressStep === 2) return "Đang rewrite tuần tự từng chunk...";
    if (progressStep === 3) return "Đang hoàn tất và ghép nội dung...";
    return "";
  }, [progressStep]);

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#020617]">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden">
      <aside className="w-20 md:w-64 bg-[#0f172a]/80 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 z-20">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
          <div className="w-10 h-10 btn-ombre rounded-xl flex items-center justify-center text-white font-bold text-2xl font-serif shadow-lg">S</div>
          <span className="ml-3 font-serif font-bold text-xl hidden md:block text-gradient">NovaForge AI</span>
        </div>

        <nav className="flex-1 py-8 px-3 space-y-2">
          <button onClick={() => router.push("/dashboard/cleaner")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Sparkles className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Làm Sạch Transcript</span>
          </button>
          <button onClick={() => router.push("/dashboard/prompter")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Video className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Tạo Prompt Video</span>
          </button>
          <button className="w-full flex items-center p-4 rounded-2xl bg-white/[0.03] text-white border border-white/5 shadow-lg">
            <Type className="w-5 h-5 flex-shrink-0 text-fuchsia-300" />
            <span className="ml-3 font-semibold hidden md:block">Tool viết lại truyện</span>
          </button>
          <button onClick={() => router.push("/dashboard/voice")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Volume2 className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai84)</span>
          </button>
          <button onClick={() => router.push("/dashboard/voice-ai33")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Volume2 className="w-5 h-5 flex-shrink-0 group-hover:text-cyan-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai33)</span>
          </button>
          <button onClick={() => router.push("/dashboard/podcast")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Mic className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Podcast Studio</span>
          </button>
          <button onClick={() => router.push("/dashboard/medical3")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Video className="w-5 h-5 flex-shrink-0 group-hover:text-orange-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Prompt Medical 3.0</span>
          </button>

          {user?.role === "admin" && (
            <button onClick={() => router.push("/admin")} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all group">
              <Settings className="w-5 h-5 flex-shrink-0 group-hover:rotate-90 transition-transform duration-500" />
              <span className="ml-3 font-medium hidden md:block">Quản Trị Admin</span>
            </button>
          )}
        </nav>

        <div className="p-6 border-t border-white/5">
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all text-sm font-semibold">
            <LogOut className="w-4 h-4" /> <span className="hidden md:block">Đăng Xuất</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative p-4 md:p-10">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-fuchsia-600/10 blur-[120px] rounded-full -z-10"></div>
        <SystemAnnouncementBanner userId={user?.id} />

        <header className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-4xl font-bold text-white font-serif tracking-tight mb-2">
              <span className="text-gradient">Tool viết lại truyện</span>
            </h2>
            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black tracking-widest uppercase italic">
              <span>Chunk theo xuống dòng ~2000 ký tự</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setShowHistory(true);
                fetchHistory(user.id);
              }}
              className="flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-2xl border border-white/5 transition-all text-[10px] font-black uppercase tracking-widest"
            >
              <Clock size={14} /> Lịch Sử
            </button>
            <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
              <button
                onClick={() => setProvider("gemini")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${provider === "gemini" ? "btn-ombre text-white shadow-lg" : "text-slate-500 hover:bg-white/5"}`}
              >
                <span className="text-[10px] font-black uppercase tracking-widest">Gemini</span>
              </button>
              <button
                onClick={() => setProvider("openai")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${provider === "openai" ? "bg-emerald-600 text-white shadow-lg" : "text-slate-500 hover:bg-white/5"}`}
              >
                <span className="text-[10px] font-black uppercase tracking-widest">ChatGPT</span>
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-hidden">
          <div className="flex flex-col glass-card rounded-[2.5rem] overflow-hidden border-slate-800/50">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Nội dung gốc</span>
                <span className="px-2 py-0.5 bg-slate-500/5 rounded-md text-[9px] font-mono text-slate-400/70">{inputChars.toLocaleString()} ký tự</span>
              </div>
              <button onClick={() => setInputText("")} className="p-2 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 p-8 bg-transparent text-slate-100 text-base leading-8 outline-none resize-none"
              placeholder="Dán truyện cần viết lại..."
            />
            <div className="p-5 border-t border-white/5 bg-white/[0.01] space-y-4">
              <label className="flex items-center gap-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={renameCharacters}
                  onChange={(e) => setRenameCharacters(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-transparent"
                />
                Tick để AI tự đổi tên nhân vật
              </label>
              <button
                onClick={handleRewrite}
                disabled={loading || !inputText.trim()}
                className="btn-ombre px-10 py-4 rounded-2xl font-bold transition-all shadow-xl flex items-center gap-3 disabled:opacity-30"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {loading ? "Đang viết lại..." : "Bắt đầu viết lại"}
              </button>
              {loading && (
                <div className="text-xs text-slate-400">
                  {statusLabel}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col glass-card rounded-[2.5rem] overflow-hidden relative border-slate-800/50">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-fuchsia-300 uppercase tracking-[0.2em]">Kết quả</span>
                <span className="px-2 py-0.5 bg-fuchsia-500/5 rounded-md text-[9px] font-mono text-fuchsia-300/70">{outputChars.toLocaleString()} ký tự</span>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(resultText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                disabled={!resultText}
                className="px-5 py-2.5 bg-white/5 hover:bg-fuchsia-500/10 rounded-xl transition-all text-fuchsia-200 flex items-center gap-2 text-xs font-bold border border-white/10 disabled:opacity-20"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? "Đã sao chép" : "Sao chép"}
              </button>
            </div>
            <div className="result-font flex-1 p-10 overflow-y-auto text-xl md:text-2xl leading-[2] text-slate-100 scrollbar-hide">
              {resultText ? (
                <div className="whitespace-pre-wrap animate-in fade-in slide-in-from-bottom-4 duration-700">{resultText}</div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-800 space-y-6">
                  <Type className="w-16 h-16 opacity-5" />
                  <p className="text-[10px] font-bold tracking-[0.3em] uppercase opacity-20">Waiting for Output</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {errorText && (
          <div className="mt-5 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">{errorText}</div>
        )}
      </main>
    </div>
  );
}
