"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { 
  Sparkles, Trash2, Copy, Check, LogOut, Settings, 
  AlertCircle, X, ChevronDown, Cpu, Zap, Loader2, Type, 
  Clock, Video, Languages, Palette, Layout, ArrowRight, Volume2, Mic
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SystemAnnouncementBanner from '@/components/SystemAnnouncementBanner';

export default function PrompterPage() {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [user, setUser] = useState<any>(null);
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  
  const [genre, setGenre] = useState('Medical Documentary');
  const [style, setStyle] = useState('Cinematic Realism');
  const [nationality, setNationality] = useState('Vietnamese');

  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const router = useRouter();

  // Logic chia đoạn nguyên bản (8 giây ~ 20 từ)
  const getSegments = (text: string) => {
    const words = text.trim().split(/\s+/);
    const segments = [];
    const wordsPerSegment = 20;

    for (let i = 0; i < words.length; i += wordsPerSegment) {
      const chunk = words.slice(i, i + wordsPerSegment).join(" ");
      const s = (i / wordsPerSegment) * 8;
      const formatTime = (v: number) => {
        const mins = Math.floor(v / 60);
        const secs = Math.floor(v % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };

      segments.push({
        id: Math.floor(i / wordsPerSegment),
        text: chunk,
        timestamp: `${formatTime(s)} - ${formatTime(s + 8)}`,
        prompt: ""
      });
    }
    return segments;
  };

  // Tính toán tổng số cảnh quay dự kiến
  const estimatedSegments = inputText.trim() ? Math.ceil(inputText.trim().split(/\s+/).length / 20) : 0;

  const fetchHistory = async (userId: string) => {
    const { data } = await supabase
      .from('prompt_history')
      .select('*')
      .eq('user_id', userId)
      .neq('style', 'podcast')
      .order('created_at', { ascending: false })
      .limit(10);
    setHistory(data || []);
  };

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: profile } = await supabase.from('profiles').select('status, role').eq('id', session.user.id).single();
      if (profile?.status !== 'approved') { await supabase.auth.signOut(); router.push('/login'); return; }

      setUser({ ...session.user, role: profile?.role });
      fetchHistory(session.user.id);
    };
    checkUser();
  }, [router]);

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    setProgress(0);
    
    const allSegments = getSegments(inputText);
    setResults(allSegments); // Hiển thị khung trước khi có prompt

    const chunkSize = 10;
    const finalResults = [...allSegments];

    try {
      for (let i = 0; i < allSegments.length; i += chunkSize) {
        const chunk = allSegments.slice(i, i + chunkSize);
        
        const response = await fetch('/api/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            segments: chunk.map(s => ({ segmentIndex: s.id, text: s.text })), 
            userId: user.id,
            genre, style, nationality, provider
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        // Cập nhật kết quả vào danh sách ngay lập tức
        const chunkResults = data.results;
        chunkResults.forEach((r: any) => {
          const target = finalResults.find(fr => fr.id === r.id);
          if (target) target.prompt = r.prompt;
        });

        const newResults = [...finalResults];
        setResults(newResults);
        
        // Cập nhật tiến độ dựa trên số lượng cảnh đã xong
        const processedCount = Math.min(i + chunkSize, allSegments.length);
        setProgress((processedCount / allSegments.length) * 100);
      }

      // Cuối cùng: Lưu lịch sử 1 lần duy nhất
      await fetch('/api/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          isFinal: true,
          fullTranscript: inputText,
          allResults: finalResults,
          userId: user.id,
          genre, style, nationality, provider
        }),
      });

      fetchHistory(user.id);
    } catch (err: any) {
      alert(err.message || 'Lỗi tạo Prompt');
    } finally {
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 1000);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyAllPrompts = () => {
    const allText = results.map((res, i) => `${i + 1} . ${res.prompt}`).join('\n');
    navigator.clipboard.writeText(allText);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(null as any), 2000);
  };

  if (!user) return <div className="flex h-screen items-center justify-center bg-[#020617]"><Loader2 className="animate-spin text-indigo-500 w-10 h-10"/></div>;

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden">
      
      {/* SIDEBAR */}
      <aside className="w-20 md:w-64 bg-[#0f172a]/80 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 z-20">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
           <div className="w-10 h-10 btn-ombre rounded-xl flex items-center justify-center text-white font-bold text-2xl font-serif">S</div>
           <span className="ml-3 font-serif font-bold text-xl hidden md:block text-gradient">NovaForge AI</span>
        </div>
        
        <nav className="flex-1 py-8 px-3 space-y-2">
          <button onClick={() => router.push('/dashboard/cleaner')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Làm Sạch Transcript</span>
          </button>

          <button className="w-full flex items-center p-4 rounded-2xl bg-white/[0.03] text-white border border-white/5 shadow-lg">
            <Video className="w-5 h-5 flex-shrink-0 text-indigo-400" />
            <span className="ml-3 font-semibold hidden md:block">Tạo Prompt Video</span>
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
          <button onClick={() => { supabase.auth.signOut(); router.push('/login'); }} className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all text-sm font-semibold text-center">
            <LogOut className="w-4 h-4" /> <span className="hidden md:block">Đăng Xuất</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative p-4 md:p-10">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full -z-10"></div>
        <SystemAnnouncementBanner userId={user?.id} />

        <header className="mb-8 flex items-start justify-between">
          <div>
             <h2 className="text-4xl font-bold text-white font-serif tracking-tight mb-2">Tạo <span className="text-gradient">Prompt Video</span></h2>
             <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black tracking-widest uppercase italic">
               <span>Veo3 Realism Engine Integration</span>
             </div>
          </div>

          <div className="flex items-center gap-4">
              <button 
                onClick={() => { setShowHistory(true); fetchHistory(user.id); }}
                className="flex items-center gap-2 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-2xl border border-white/5 transition-all text-[10px] font-black uppercase tracking-widest"
              >
                <Clock size={14}/> Lịch Sử Prompt
              </button>

              <div className="glass-card p-1.5 rounded-2xl border-white/10 flex items-center gap-1 shadow-2xl">
                  <button onClick={() => setProvider('gemini')} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${provider === 'gemini' ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>
                    <Cpu size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">Gemini</span>
                  </button>
                  <button onClick={() => setProvider('openai')} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ${provider === 'openai' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>
                    <Zap size={14} /> <span className="text-[10px] font-black uppercase tracking-widest">ChatGPT</span>
                  </button>
              </div>
          </div>
        </header>

        {/* Cấu hình Tool gốc */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
           <div className="glass-card p-6 rounded-3xl border-white/5 space-y-3">
              <div className="flex items-center gap-2 text-slate-500"><Layout size={16}/> <span className="text-[10px] font-black uppercase tracking-widest">Thể loại (Genre)</span></div>
              <select value={genre} onChange={(e) => setGenre(e.target.value)} className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-indigo-500 transition-all text-white appearance-none">
                <option value="Medical Documentary" className="bg-[#0f172a]">📽️ Phim tài liệu y khoa</option>
                <option value="Surgical Tutorial" className="bg-[#0f172a]">✂️ Hướng dẫn phẫu thuật</option>
                <option value="Patient Story" className="bg-[#0f172a]">👨‍👩‍👧‍👦 Câu chuyện bệnh nhân</option>
                <option value="Food & Culinary" className="bg-[#0f172a]">🍲 Ẩm thực & Nấu ăn</option>
                <option value="Lifestyle & Travel" className="bg-[#0f172a]">✈️ Đời sống & Du lịch</option>
              </select>
           </div>
           <div className="glass-card p-6 rounded-3xl border-white/5 space-y-3">
              <div className="flex items-center gap-2 text-slate-500"><Palette size={16}/> <span className="text-[10px] font-black uppercase tracking-widest">Phong cách (Style)</span></div>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-indigo-500 transition-all text-white appearance-none">
                <option value="Cinematic Realism" className="bg-[#0f172a]">🎬 Điện ảnh chân thực</option>
                <option value="Macro Scientific" className="bg-[#0f172a]">🔬 Khoa học vi mô (Macro)</option>
                <option value="3D Medical Animation" className="bg-[#0f172a]">🧊 Hoạt hình y khoa 3D</option>
                <option value="Studio Ghibli Art" className="bg-[#0f172a]">🎨 Phong cách Ghibli</option>
                <option value="Irasutoya Style" className="bg-[#0f172a]">🎌 Phong cách Irasutoya</option>
                <option value="Làng quê Đông Hồ" className="bg-[#0f172a]">🇻🇳 Làng quê Đông Hồ</option>
              </select>
           </div>
           <div className="glass-card p-6 rounded-3xl border-white/5 space-y-3">
              <div className="flex items-center gap-2 text-slate-500"><Languages size={16}/> <span className="text-[10px] font-black uppercase tracking-widest">Quốc gia (Nationality)</span></div>
              <select value={nationality} onChange={(e) => setNationality(e.target.value)} className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-3 text-sm focus:outline-none focus:border-indigo-500 transition-all text-white appearance-none">
                <option value="Vietnamese" className="bg-[#0f172a]">🇻🇳 Việt Nam</option>
                <option value="Japanese" className="bg-[#0f172a]">🇯🇵 Nhật Bản</option>
                <option value="Korean" className="bg-[#0f172a]">🇰🇷 Hàn Quốc</option>
                <option value="Western/European" className="bg-[#0f172a]">🇪🇺 Phương Tây / Châu Âu</option>
                <option value="USA/Global" className="bg-[#0f172a]">🌎 Mỹ / Quốc tế</option>
              </select>
           </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-hidden">
          {/* Input Area */}
          <div className="flex flex-col glass-card rounded-[2.5rem] overflow-hidden border-slate-800/50">
            <div className="p-6 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Dán Transcript vào đây</span>
                {estimatedSegments > 0 && (
                  <span className="px-3 py-1 bg-indigo-500/10 rounded-full text-[10px] font-black text-indigo-400 border border-indigo-500/20">
                    ~ {estimatedSegments} Cảnh quay
                  </span>
                )}
              </div>
              <button onClick={() => setInputText('')} className="p-2 hover:text-rose-400"><Trash2 size={16}/></button>
            </div>
            <textarea
              className="flex-1 p-8 bg-transparent focus:outline-none resize-none text-slate-300 leading-relaxed text-lg scrollbar-hide"
              placeholder="Paste transcript here..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <div className="p-6 border-t border-white/5 bg-white/[0.01]">
               <button onClick={handleGenerate} disabled={loading || !inputText} className="w-full btn-ombre py-4 rounded-2xl font-bold transition-all shadow-xl flex items-center justify-center gap-3 disabled:opacity-30">
                 {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                 {loading ? `Đang xử lý... (${Math.round(progress)}%)` : 'Tạo Visual Prompts'}
               </button>
            </div>
          </div>

          {/* Timeline Result Area */}
          <div className="flex flex-col glass-card rounded-[2.5rem] overflow-hidden border-slate-800/50 bg-[#0f172a]/50 relative">
             {loading && (
               <div className="absolute top-0 left-0 h-1 bg-indigo-500 z-30 transition-all duration-500" style={{ width: `${progress}%` }}></div>
             )}
             
             <div className="p-6 border-b border-white/5 bg-white/[0.01] flex justify-between items-center">
                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">
                  Timeline Phân Cảnh {results.length > 0 && `(${results.length} cảnh)`}
                </span>
                
                {results.length > 0 && (
                  <button 
                    onClick={copyAllPrompts}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${copiedAll ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20'}`}
                  >
                    {copiedAll ? <Check size={12}/> : <Copy size={12}/>}
                    {copiedAll ? 'Đã Copy Tất Cả' : 'Copy Tất Cả (1. 2. ...)'}
                  </button>
                )}
             </div>
             <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                {results.length > 0 ? results.map((res, index) => (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} key={index} className="bg-white/[0.03] border border-white/5 rounded-3xl overflow-hidden">
                    <div className="px-6 py-3 bg-white/5 flex justify-between items-center">
                       <span className="text-[10px] font-mono font-black text-emerald-400 tracking-widest">{res.timestamp}</span>
                       <button onClick={() => copyToClipboard(res.prompt, index)} className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-300 hover:text-white transition-all">
                          {copiedIndex === index ? <Check size={12}/> : <Copy size={12}/>}
                          {copiedIndex === index ? 'Copied' : 'Copy Prompt'}
                       </button>
                    </div>
                    <div className="p-6 space-y-4">
                       <p className="text-xs text-slate-500 italic">"{res.text}"</p>
                       <div className="bg-black/40 p-5 rounded-2xl text-sm leading-relaxed text-slate-200 border border-white/5 min-h-[60px] flex items-center">
                          {res.prompt ? (
                            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{res.prompt}</motion.span>
                          ) : (
                            <div className="flex items-center gap-2 text-indigo-400/50 animate-pulse">
                               <Loader2 size={14} className="animate-spin" />
                               <span className="text-[10px] font-black uppercase tracking-widest">Đang vẽ cảnh...</span>
                            </div>
                          )}
                       </div>
                    </div>
                  </motion.div>
                )) : (
                  <div className="h-full flex flex-col items-center justify-center opacity-10 space-y-4">
                    <Layout size={64}/>
                    <p className="text-xs font-black uppercase tracking-widest text-center">Chưa có dữ liệu phân cảnh</p>
                  </div>
                )}
             </div>
          </div>
        </div>

        {/* History Drawer */}
        <AnimatePresence>
          {showHistory && (
            <div className="fixed inset-0 z-50 flex justify-end bg-[#020617]/80 backdrop-blur-md">
               <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} className="w-full max-w-lg bg-[#0f172a] h-full shadow-2xl flex flex-col border-l border-white/5">
                  <div className="p-8 border-b border-white/5 flex items-center justify-between">
                     <h3 className="text-xl font-bold text-white font-serif">Lịch Sử Tạo Prompt</h3>
                     <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/10 rounded-full text-slate-500"><X/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                     {history.map((h) => (
                       <button key={h.id} onClick={() => { setInputText(h.input_transcript); setResults(h.results); setGenre(h.genre); setStyle(h.style); setNationality(h.nationality); setShowHistory(false); }} className="w-full p-6 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/5 transition-all text-left group">
                          <div className="flex justify-between items-start mb-4">
                             <div className="px-2 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-[9px] font-black text-indigo-400 uppercase">{h.style}</div>
                             <span className="text-[9px] text-slate-600 font-mono italic">{new Date(h.created_at).toLocaleString()}</span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-2 italic opacity-70">"{h.input_transcript.slice(0, 100)}..."</p>
                       </button>
                     ))}
                  </div>
               </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
