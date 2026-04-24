"use client";

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { 
  Sparkles, Trash2, Copy, Check, LogOut, Settings, 
  AlertCircle, X, ChevronDown, Cpu, Zap, Loader2, Type, 
  Clock, Eye, ChevronRight, Video, Volume2, Mic
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SystemAnnouncementBanner from '@/components/SystemAnnouncementBanner';

export default function CleanerPage() {
  const [inputText, setInputText] = useState('');
  const [resultText, setResultText] = useState('');
  const [detectedTitle, setDetectedTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [geminiModel, setGeminiModel] = useState<'gemini-2.5-flash' | 'gemini-2.5-flash-lite'>('gemini-2.5-flash');
  
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<any>(null);

  const [progressStep, setProgressStep] = useState(0); 
  const [errorStatus, setErrorStatus] = useState<{message: string, details: string} | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{ title: string; who: string; when: string } | null>(null);
  const duplicatePromptResolverRef = useRef<((value: boolean) => void) | null>(null);

  const router = useRouter();

  const askDuplicateConfirm = (payload: { title: string; who: string; when: string }) => {
    return new Promise<boolean>((resolve) => {
      duplicatePromptResolverRef.current = resolve;
      setDuplicatePrompt(payload);
    });
  };

  const closeDuplicatePrompt = (value: boolean) => {
    if (duplicatePromptResolverRef.current) {
      duplicatePromptResolverRef.current(value);
      duplicatePromptResolverRef.current = null;
    }
    setDuplicatePrompt(null);
  };

  const ensureSessionId = async (userId: string) => {
    let sessionId = localStorage.getItem('storycraft_session_id');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem('storycraft_session_id', sessionId);
    }
    await supabase.from('profiles').update({ current_session_id: sessionId }).eq('id', userId);
    return sessionId;
  };

  const fetchHistory = async (userId: string) => {
    const { data } = await supabase
      .from('cleaning_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    setHistory(data || []);
  };

  const extractTranscriptTitle = (rawText: string) => {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return '';
    const title = lines[0].replace(/\s*-\s*YouTube\s*$/i, '').trim();
    return title.slice(0, 180);
  };

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('status, role')
        .eq('id', session.user.id)
        .single();

      if (profile?.status !== 'approved') {
        await supabase.auth.signOut();
        router.push('/login');
        return;
      }

      await ensureSessionId(session.user.id);
      setUser({ ...session.user, role: profile?.role });
      fetchHistory(session.user.id);
    };
    checkUser();
  }, [router]);

  const handleProcess = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    setResultText('');
    setErrorStatus(null);
    setProgressStep(1); 

    const sessionId = await ensureSessionId(user.id);

    const runClean = async (confirmDuplicate = false) => {
      return fetch('/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: inputText, 
          userId: user.id,
          sessionId: sessionId,
          provider: provider,
          geminiModel,
          confirmDuplicate,
        }),
      });
    };

    try {
      const responsePromise = runClean(false);
      setTimeout(() => setProgressStep(2), 800);
      setTimeout(() => setProgressStep(3), 2000);

      let response = await responsePromise;
      let data = await response.json();

      if (response.status === 409 && data?.duplicate) {
        const who = data.duplicate.userEmail ? String(data.duplicate.userEmail).split('@')[0] : 'một người dùng khác';
        const when = data.duplicate.createdAt ? new Date(data.duplicate.createdAt).toLocaleString() : 'trước đó';
        const title = data.duplicate.title || extractTranscriptTitle(inputText);
        const shouldContinue = await askDuplicateConfirm({ title, who, when });
        if (!shouldContinue) {
          setLoading(false);
          setProgressStep(0);
          return;
        }
        response = await runClean(true);
        data = await response.json();
      }

      if (!response.ok) {
        throw { message: data.error, details: data.details };
      }
      setResultText(data.result);
      setDetectedTitle(data.title || extractTranscriptTitle(inputText));
      // Tải lại lịch sử ngay lập tức
      fetchHistory(user.id);
    } catch (err: any) {
      setErrorStatus({
        message: err.message || 'Đã xảy ra lỗi hệ thống',
        details: err.details || ''
      });
      setProgressStep(0);
    } finally {
      setLoading(false);
      setProgressStep(0);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('storycraft_session_id');
    router.push('/login');
  };

  const sendToPodcast = () => {
    if (!resultText.trim()) return;
    const title = detectedTitle || extractTranscriptTitle(inputText);
    localStorage.setItem('podcast_prefill_text', resultText);
    if (title) localStorage.setItem('podcast_prefill_title', title);
    router.push('/dashboard/podcast');
  };

  const sendToRewriter = () => {
    if (!resultText.trim()) return;
    localStorage.setItem('rewriter_prefill_text', resultText);
    router.push('/dashboard/rewriter');
  };

  if (!user) return (
    <div className="flex h-screen items-center justify-center bg-[#020617]">
      <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden">
      
      {/* SIDEBAR BÊN TRÁI: CHỈ GIỮ CÁC TÍNH NĂNG CHÍNH */}
      <aside className="w-20 md:w-64 bg-[#0f172a]/80 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 z-20">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
           <div className="w-10 h-10 btn-ombre rounded-xl flex items-center justify-center text-white font-bold text-2xl font-serif shadow-lg">S</div>
           <span className="ml-3 font-serif font-bold text-xl hidden md:block text-gradient">NovaForge AI</span>
        </div>
        
        <nav className="flex-1 py-8 px-3 space-y-2">
          {/* Module chính: Làm sạch transcript */}
          <button className="w-full flex items-center p-4 rounded-2xl bg-white/[0.03] text-white border border-white/5 shadow-lg">
            <Sparkles className="w-5 h-5 flex-shrink-0 text-indigo-400" />
            <span className="ml-3 font-semibold hidden md:block">Làm Sạch Transcript</span>
          </button>


          {/* Module Giọng Nói AI */}
          <button onClick={() => router.push('/dashboard/voice')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Volume2 className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai84)</span>
          </button>

          <button onClick={() => router.push('/dashboard/voice-ai33')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Volume2 className="w-5 h-5 flex-shrink-0 group-hover:text-cyan-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai33)</span>
          </button>

          <button onClick={() => router.push('/dashboard/podcast')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Mic className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Podcast Studio</span>
          </button>

          <button onClick={() => router.push('/dashboard/rewriter')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Type className="w-5 h-5 flex-shrink-0 group-hover:text-fuchsia-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Tool viết lại truyện</span>
          </button>

          <button onClick={() => router.push('/dashboard/medical3')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group">
            <Video className="w-5 h-5 flex-shrink-0 group-hover:text-orange-400 transition-colors" />
            <span className="ml-3 font-medium hidden md:block">Prompt Medical 3.0</span>
          </button>
          
          {user?.role === 'admin' && (
            <button onClick={() => router.push('/admin')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all group">
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

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative p-4 md:p-10">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full -z-10"></div>
        <SystemAnnouncementBanner userId={user?.id} />

        <header className="mb-8 flex items-start justify-between">
          <div>
             <h2 className="text-4xl font-bold text-white font-serif tracking-tight mb-2">Hệ Thống <span className="text-gradient">Xử Lý TTS</span></h2>
             <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black tracking-widest uppercase italic">
               <span>Làm sạch văn bản chuyên nghiệp</span>
             </div>
             {detectedTitle && (
               <p className="text-xs text-amber-300 mt-2">
                 Tiêu đề nhận diện: <span className="font-bold">{detectedTitle}</span>
               </p>
             )}
          </div>

          {/* KHU VỰC ĐIỀU KHIỂN BÊN PHẢI: CHUYỂN NÚT LỊCH SỬ QUA ĐÂY */}
          <div className="flex items-center gap-4">
              <button 
                onClick={() => { setShowHistory(true); fetchHistory(user.id); }}
                className="flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-2xl border border-white/5 transition-all text-[10px] font-black uppercase tracking-widest"
              >
                <Clock size={14}/> Lịch Sử Làm Sạch
              </button>

              <div className="flex items-center gap-2">
                <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
                  <button onClick={() => setProvider('gemini')} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${provider === 'gemini' ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>
                    <Cpu size={14} /><span className="text-[10px] font-black uppercase tracking-widest">Gemini</span>
                  </button>
                  <button onClick={() => setProvider('openai')} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${provider === 'openai' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>
                    <Zap size={14} /><span className="text-[10px] font-black uppercase tracking-widest">ChatGPT</span>
                  </button>
                </div>
                {provider === 'gemini' && (
                  <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
                    <button onClick={() => setGeminiModel('gemini-2.5-flash')} className={`px-3 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest ${geminiModel === 'gemini-2.5-flash' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>Flash</button>
                    <button onClick={() => setGeminiModel('gemini-2.5-flash-lite')} className={`px-3 py-2 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest ${geminiModel === 'gemini-2.5-flash-lite' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>Lite</button>
                  </div>
                )}
              </div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-hidden">
          {/* Input Area */}
          <div className="flex flex-col glass-card rounded-[2.5rem] overflow-hidden border-slate-800/50">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Nguồn vào</span>
                <span className="px-2 py-0.5 bg-white/5 rounded-md text-[9px] font-mono text-slate-600">{inputText.length.toLocaleString()} ký tự</span>
              </div>
              <button onClick={() => setInputText('')} className="p-2 hover:bg-rose-500/10 hover:text-rose-400 transition-all rounded-lg text-slate-600"><Trash2 className="w-4 h-4" /></button>
            </div>
            <textarea
              className="flex-1 p-8 bg-transparent focus:outline-none resize-none text-slate-300 leading-relaxed text-lg scrollbar-hide"
              placeholder="Dán transcript thô tại đây..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <div className="p-6 border-t border-white/5 bg-white/[0.01]">
               <div className="flex items-center justify-between">
                  <div className="w-1/2">
                    {loading && (
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse">
                          {progressStep === 1 ? "Connecting..." : progressStep === 2 ? "Processing..." : "TTS Optimizing..."}
                        </span>
                        <div className="w-full h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
                           <motion.div initial={{ width: "0%" }} animate={{ width: progressStep === 1 ? "30%" : progressStep === 2 ? "60%" : "95%" }} className="h-full btn-ombre progress-bar-shine"/>
                        </div>
                      </div>
                    )}
                  </div>
                  <button onClick={handleProcess} disabled={loading || !inputText} className="btn-ombre px-10 py-4 rounded-2xl font-bold transition-all shadow-xl flex items-center gap-3 disabled:opacity-30">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    {loading ? 'Đang Xử Lý...' : 'Bắt Đầu Làm Sạch'}
                  </button>
               </div>
            </div>
          </div>

          {/* Result Area */}
          <div className="flex flex-col glass-card rounded-[2.5rem] overflow-hidden relative border-slate-800/50">
             <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] text-gradient">Kết Quả AI (Chuẩn 100%)</span>
                  <span className="px-2 py-0.5 bg-indigo-500/5 rounded-md text-[9px] font-mono text-indigo-400/70">{resultText.length.toLocaleString()} ký tự</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={sendToPodcast}
                    disabled={!resultText}
                    className="px-5 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-xl transition-all text-indigo-300 flex items-center gap-2 text-xs font-bold border border-indigo-500/20 disabled:opacity-20"
                  >
                    <Mic className="w-4 h-4" />
                    Gửi Sang Podcast
                  </button>
                  <button
                    onClick={sendToRewriter}
                    disabled={!resultText}
                    className="px-5 py-2.5 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 rounded-xl transition-all text-fuchsia-200 flex items-center gap-2 text-xs font-bold border border-fuchsia-500/20 disabled:opacity-20"
                  >
                    <Type className="w-4 h-4" />
                    Gửi sang tool viết lại truyện
                  </button>
                  <button 
                    onClick={() => { navigator.clipboard.writeText(resultText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    disabled={!resultText}
                    className="px-5 py-2.5 bg-white/5 hover:bg-indigo-500/10 rounded-xl transition-all text-indigo-300 flex items-center gap-2 text-xs font-bold border border-white/10 disabled:opacity-20"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Đã Lưu' : 'Sao Chép'}
                  </button>
                </div>
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

        {/* Modal Lịch sử - Drawer */}
        <AnimatePresence>
          {showHistory && (
            <div className="fixed inset-0 z-50 flex justify-end bg-[#020617]/80 backdrop-blur-md">
               <motion.div 
                 initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
                 className="w-full max-w-lg bg-[#0f172a] h-full shadow-2xl flex flex-col border-l border-white/5"
               >
                  <div className="p-8 border-b border-white/5 flex items-center justify-between">
                     <div>
                       <h3 className="text-xl font-bold text-white font-serif tracking-tight">Lịch Sử Làm Sạch</h3>
                       <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Dữ liệu lưu trữ nội dung</p>
                     </div>
                     <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/10 rounded-full text-slate-500"><X/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                     {history.length > 0 ? history.map((h) => (
                       <button 
                         key={h.id}
                         onClick={() => {
                           setSelectedHistory(h);
                           setShowHistory(false);
                           setInputText(h.input_content);
                           setResultText(h.output_content);
                           setDetectedTitle(extractTranscriptTitle(h.input_content || ''));
                         }}
                         className="w-full p-6 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/5 transition-all text-left group"
                       >
                          <div className="flex justify-between items-start mb-4">
                             <div className="flex items-center gap-2 px-2 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">{h.provider}</span>
                             </div>
                             <span className="text-[9px] text-slate-600 font-mono italic">{new Date(h.created_at).toLocaleString()}</span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed mb-4 opacity-70 italic">"{h.input_content.slice(0, 150)}..."</p>
                       </button>
                     )) : (
                       <div className="h-full flex flex-col items-center justify-center opacity-20 italic">Chưa có lịch sử làm sạch</div>
                     )}
                  </div>
               </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Error Modal */}
        <AnimatePresence>
          {duplicatePrompt && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[95] flex items-center justify-center p-6 bg-[#020617]/90 backdrop-blur-xl">
              <motion.div initial={{ y: 20, scale: 0.98 }} animate={{ y: 0, scale: 1 }} className="max-w-2xl w-full bg-slate-900 border border-amber-500/20 rounded-[2rem] p-8 shadow-2xl">
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">Phát hiện nội dung trùng</h3>
                    <p className="text-sm text-slate-400 mt-1">
                      Tiêu đề này đã được xử lý trước đó. Bạn có muốn tiếp tục làm sạch không?
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-slate-200 space-y-2">
                  <p><span className="text-slate-500">Tiêu đề:</span> <span className="font-semibold text-amber-300">{duplicatePrompt.title}</span></p>
                  <p><span className="text-slate-500">Người xử lý trước:</span> {duplicatePrompt.who}</p>
                  <p><span className="text-slate-500">Thời gian:</span> {duplicatePrompt.when}</p>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    onClick={() => closeDuplicatePrompt(false)}
                    className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 transition-all font-semibold text-sm"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={() => closeDuplicatePrompt(true)}
                    className="px-5 py-2.5 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-200 hover:bg-amber-500/30 transition-all font-semibold text-sm"
                  >
                    Vẫn tiếp tục
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {errorStatus && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-[#020617]/95 backdrop-blur-2xl">
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="max-w-xl w-full bg-slate-900 border border-rose-500/20 rounded-[3rem] p-10 text-center space-y-6">
                  <AlertCircle className="w-16 h-16 text-rose-500 mx-auto" />
                  <h3 className="text-2xl font-bold text-white">Lỗi Hệ Thống</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{errorStatus.message}</p>
                  <button onClick={() => setErrorStatus(null)} className="w-full py-4 btn-ombre rounded-2xl font-bold">Quay Lại Công Việc</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
