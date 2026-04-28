"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Clock, LogOut, Mic, Settings, Sparkles, Type, User, Volume2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import SystemAnnouncementBanner from '@/components/SystemAnnouncementBanner';

// ─── TYPES ────────────────────────────────────────────────────────────────────
enum ContentCategory { MEDICAL = 'MEDICAL', FOOD = 'FOOD', LIFESTYLE = 'LIFESTYLE', STORYTELLING = 'STORYTELLING', GENERAL = 'GENERAL' }
enum Country { VIETNAM = 'VIETNAM', KOREA = 'KOREA', JAPAN = 'JAPAN', USA = 'USA' }
enum VisualStyle {
  REALISTIC = 'REALISTIC', GHIBLI = 'GHIBLI', WEBTOON = 'WEBTOON',
  ANIME_CINEMATIC = 'ANIME_CINEMATIC', CARTOON_3D = 'CARTOON_3D', IRASUTOYA = 'IRASUTOYA',
}
type ModelProvider = 'gemini' | 'openai';
type SeoPackage = { title: string; description: string; timestamps: string[]; hashtags: string[]; keywords: string[] };
type SeoLanguage = 'vi' | 'ja' | 'ko' | 'en';
type GenerationSettings = { category: ContentCategory; country: Country; style: VisualStyle };
type VideoSegment = { index: number; startTimeMs: number; endTimeMs: number; relevantContext: string; generatedPrompt?: string };
type UserPromptReminder = { enabled: boolean; message: string; imageUrl: string; confirmTimes: number; onPrompt: boolean; onTitle: boolean };

const VEO_SEGMENT_DURATION_MS = 8000;

// ─── PARSERS ──────────────────────────────────────────────────────────────────
const parseTimestampToMs = (ts: string): number | null => {
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
  if (!m) return null;
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]);
};

const parseTranscript = (rawText: string) => {
  const parsedLines: Array<{ startTimeMs: number; endTimeMs: number; speaker: string; text: string }> = [];
  let globalStart = Infinity, globalEnd = -Infinity;
  const normalized = rawText.replace(/\r\n/g, '\n').trim();

  // Try SRT blocks
  const srtBlocks = normalized.split(/\n\s*\n/);
  let isSrt = false;
  for (const block of srtBlocks) {
    const m = block.match(/^\d+\s*\n(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*\n([\s\S]*)$/);
    if (!m) continue;
    isSrt = true;
    const startMs = parseTimestampToMs(m[1]);
    const endMs = parseTimestampToMs(m[2]);
    const content = m[3].trim().replace(/\n/g, ' ');
    if (startMs === null || endMs === null) continue;
    parsedLines.push({ startTimeMs: startMs, endTimeMs: endMs, speaker: 'Speaker', text: content });
    if (startMs < globalStart) globalStart = startMs;
    if (endMs > globalEnd) globalEnd = endMs;
  }

  // Try pipe format
  if (!isSrt) {
    for (const line of normalized.split('\n')) {
      const m = line.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*-\s*\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*\|\s*(.*)/);
      if (!m) continue;
      const startMs = parseTimestampToMs(m[1]);
      const endMs = parseTimestampToMs(m[2]);
      if (startMs === null || endMs === null) continue;
      const content = m[3].trim();
      const colonIdx = content.indexOf(':');
      const speaker = colonIdx !== -1 && colonIdx < 30 ? content.substring(0, colonIdx).trim() : 'Speaker';
      const text = colonIdx !== -1 && colonIdx < 30 ? content.substring(colonIdx + 1).trim() : content;
      parsedLines.push({ startTimeMs: startMs, endTimeMs: endMs, speaker, text });
      if (startMs < globalStart) globalStart = startMs;
      if (endMs > globalEnd) globalEnd = endMs;
    }
  }

  return {
    lines: parsedLines,
    startTimeMs: globalStart === Infinity ? 0 : globalStart,
    endTimeMs: globalEnd === -Infinity ? 0 : globalEnd,
  };
};

const createSegments = (startMs: number, endMs: number, lines: any[]): VideoSegment[] => {
  const segments: VideoSegment[] = [];
  const total = endMs - startMs;
  const count = Math.ceil(total / VEO_SEGMENT_DURATION_MS);
  for (let i = 0; i < count; i++) {
    const segStart = startMs + i * VEO_SEGMENT_DURATION_MS;
    const segEnd = segStart + VEO_SEGMENT_DURATION_MS;
    const relevant = lines.filter((l) => l.startTimeMs < segEnd && l.endTimeMs > segStart).map((l) => l.text).join(' ');
    segments.push({ index: i + 1, startTimeMs: segStart, endTimeMs: segEnd, relevantContext: relevant || '[NO_CONTENT_AMBIENT_SHOT]' });
  }
  return segments;
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function StoryboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [characterName, setCharacterName] = useState('');
  const [transcript, setTranscript] = useState('');
  const [settings, setSettings] = useState<GenerationSettings>({
    category: ContentCategory.LIFESTYLE,
    country: Country.VIETNAM,
    style: VisualStyle.REALISTIC,
  });
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [spacingMode, setSpacingMode] = useState<'single' | 'double'>('single');
  const [copied, setCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [provider, setProvider] = useState<ModelProvider>('gemini');
  const [geminiModel, setGeminiModel] = useState<'gemini-2.5-flash' | 'gemini-2.5-flash-lite'>('gemini-2.5-flash-lite');
  const [seoPackage, setSeoPackage] = useState<SeoPackage | null>(null);
  const [showSeoBox, setShowSeoBox] = useState(false);
  const [copiedSeo, setCopiedSeo] = useState(false);
  const [generatingSeo, setGeneratingSeo] = useState(false);
  const [translatingSeo, setTranslatingSeo] = useState<SeoLanguage | null>(null);
  const [seoLang, setSeoLang] = useState<SeoLanguage>('vi');
  const [showKidsWarn, setShowKidsWarn] = useState(false);
  const [reminderStep, setReminderStep] = useState(1);
  const [reminderAgree, setReminderAgree] = useState(false);
  const [activeReminder, setActiveReminder] = useState<UserPromptReminder | null>(null);
  const kidsWarnRef = useRef<((value: boolean) => void) | null>(null);

  const fetchHistory = async (userId: string) => {
    const { data } = await supabase.from('prompt_history').select('*')
      .eq('user_id', userId).eq('style', 'storyboard')
      .order('created_at', { ascending: false }).limit(20);
    setHistory(data || []);
  };

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      const { data: profile } = await supabase.from('profiles').select('status, role').eq('id', session.user.id).single();
      if (!profile || profile.status !== 'approved') { await supabase.auth.signOut(); router.push('/login'); return; }
      setUser({ ...session.user, role: profile.role });
      fetchHistory(session.user.id);
    };
    checkUser();
  }, [router]);

  const getUserReminder = async (): Promise<UserPromptReminder | null> => {
    if (!user?.id) return null;
    try {
      const res = await fetch('/api/admin/vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_user_prompt_reminder', targetUserId: user.id }) });
      const json = await res.json();
      if (!res.ok || !json?.reminder) return null;
      const r = json.reminder;
      return { enabled: Boolean(r.enabled), message: String(r.message || ''), imageUrl: String(r.imageUrl || ''), confirmTimes: Math.max(1, Math.min(10, Number(r.confirmTimes || 1))), onPrompt: r.onPrompt === undefined ? true : Boolean(r.onPrompt), onTitle: Boolean(r.onTitle) };
    } catch { return null; }
  };

  const confirmReminderIfNeeded = async (trigger: 'prompt' | 'title') => {
    const reminder = await getUserReminder();
    if (!reminder?.enabled) return true;
    const matched = trigger === 'prompt' ? reminder.onPrompt : reminder.onTitle;
    if (!matched) return true;
    return new Promise<boolean>((resolve) => {
      kidsWarnRef.current = resolve;
      setActiveReminder(reminder); setReminderStep(1); setReminderAgree(false); setShowKidsWarn(true);
    });
  };

  const confirmKidsStep = () => {
    if (!activeReminder || !reminderAgree) return;
    if (reminderStep < activeReminder.confirmTimes) { setReminderStep((p) => p + 1); setReminderAgree(false); return; }
    setShowKidsWarn(false);
    if (kidsWarnRef.current) { kidsWarnRef.current(true); kidsWarnRef.current = null; }
    setActiveReminder(null);
  };

  const cancelKids = () => {
    setShowKidsWarn(false); setReminderStep(1); setReminderAgree(false); setActiveReminder(null);
    if (kidsWarnRef.current) { kidsWarnRef.current(false); kidsWarnRef.current = null; }
  };

  const handleGenerate = async () => {
    if (!transcript.trim() || !characterName.trim() || !user) return;
    const ok = await confirmReminderIfNeeded('prompt');
    if (!ok) return;
    setIsProcessing(true); setProgress(1);
    try {
      const { lines, startTimeMs, endTimeMs } = parseTranscript(transcript);
      if (lines.length === 0) { alert('Không tìm thấy dữ liệu. Kiểm tra lại định dạng SRT/transcript.'); setIsProcessing(false); return; }

      const initialSegments = createSegments(startTimeMs, endTimeMs, lines);
      const totalSegments = initialSegments.length;
      setSegments(initialSegments); setProgress(5);

      // Build overall context from full transcript (first pass)
      const allText = lines.map((l) => l.text).join(' ');
      const overallContext = allText.slice(0, 3000);

      const BATCH_SIZE = 10;
      const current = [...initialSegments];
      for (let i = 0; i < totalSegments; i += BATCH_SIZE) {
        const batch = current.slice(i, Math.min(i + BATCH_SIZE, totalSegments));
        // Local context: surrounding lines for this batch
        const startLineIdx = Math.max(0, Math.floor((i / totalSegments) * lines.length) - 3);
        const localContext = `${overallContext.slice(0, 600)} ... ${lines.slice(startLineIdx, startLineIdx + 10).map((l) => l.text).join(' ')}`;

        const res = await fetch('/api/storyboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_batch',
            provider, geminiModel, userId: user.id,
            segments: batch.map((b) => ({ index: b.index, relevantContext: b.relevantContext })),
            localContext,
            characterName: characterName.trim(),
            settings,
          }),
        });
        const json = await res.json();
        const results = json.results || [];

        results.forEach((r: any) => {
          const idx = current.findIndex((s) => s.index === r.segmentIndex);
          if (idx !== -1) current[idx].generatedPrompt = r.prompt;
        });

        // Fallback for missed segments
        batch.forEach((seg) => {
          const idx = current.findIndex((s) => s.index === seg.index);
          if (idx !== -1 && !current[idx].generatedPrompt) {
            const raw = seg.relevantContext !== '[NO_CONTENT_AMBIENT_SHOT]' ? seg.relevantContext : 'A quiet ambient scene';
            current[idx].generatedPrompt = `${characterName} in a ${settings.style.toLowerCase().replace('_', ' ')} scene: ${raw.slice(0, 120)}. Cinematic, ${settings.country.toLowerCase()} setting.`;
          }
        });

        setSegments([...current]);
        setProgress(5 + ((i + batch.length) / totalSegments) * 90);
        await new Promise((r) => setTimeout(r, 150));
      }

      // Save history
      const saveRes = await fetch('/api/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_history', provider, geminiModel, userId: user.id, transcript, characterName: characterName.trim(), settings, segments: current }),
      });
      const saveJson = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveJson.error || 'Lỗi lưu lịch sử');
      fetchHistory(user.id);
    } catch (error: any) {
      alert(error?.message || 'Đã có lỗi xảy ra.');
    } finally {
      setIsProcessing(false); setProgress(100);
    }
  };

  const handleCopy = () => {
    const text = segments.filter((s) => s.generatedPrompt).map((s) => `${s.index}. ${s.generatedPrompt}`).join(spacingMode === 'single' ? '\n' : '\n\n');
    navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateSeo = async () => {
    if (!transcript.trim() || !user?.id || generatingSeo) return;
    const ok = await confirmReminderIfNeeded('title');
    if (!ok) return;
    setGeneratingSeo(true);
    try {
      const res = await fetch('/api/storyboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate_seo', userId: user.id, provider, geminiModel, transcript }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Lỗi tạo SEO');
      setSeoPackage(json.seo); setSeoLang(json?.lang || 'vi'); setShowSeoBox(true);
    } catch (err: any) { alert(err?.message || 'Lỗi tạo SEO'); } finally { setGeneratingSeo(false); }
  };

  const handleTranslateSeo = async (targetLang: SeoLanguage) => {
    if (!seoPackage || !user?.id || translatingSeo) return;
    setTranslatingSeo(targetLang);
    try {
      const res = await fetch('/api/storyboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'translate_seo', userId: user.id, provider, geminiModel, seo: seoPackage, targetLang }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Lỗi dịch SEO');
      setSeoPackage(json.seo); setSeoLang(json?.lang || targetLang);
    } catch (err: any) { alert(err?.message || 'Lỗi dịch SEO'); } finally { setTranslatingSeo(null); }
  };

  const buildSeoText = (pkg: SeoPackage) => {
    const heading = seoLang === 'ja' ? '詳細タイムスタンプ' : seoLang === 'ko' ? '상세 타임스탬프' : seoLang === 'en' ? 'DETAILED TIMESTAMPS' : 'NỘI DUNG CHI TIẾT (TIME STAMPS)';
    const keyLabel = seoLang === 'ja' ? '追加SEOキーワード' : seoLang === 'ko' ? '추가 SEO 키워드' : seoLang === 'en' ? 'ADDITIONAL SEO KEYWORDS' : 'TỪ KHÓA SEO BỔ SUNG';
    return [pkg.title, '', pkg.description, '', `${heading}:`, ...pkg.timestamps, '', pkg.hashtags.join(' '), '', `${keyLabel}: ${pkg.keywords.join(', ')}`].join('\n');
  };

  if (!user) return <div className="min-h-screen bg-slate-900" />;

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-20 md:w-64 bg-[#0f172a]/80 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 z-20">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
          <div className="w-10 h-10 btn-ombre rounded-xl flex items-center justify-center text-white font-bold text-2xl font-serif">S</div>
          <span className="ml-3 font-serif font-bold text-xl hidden md:block text-gradient">NovaForge AI</span>
        </div>
        <nav className="flex-1 py-8 px-3 space-y-2">
          <button onClick={() => router.push('/dashboard/cleaner')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group"><Sparkles className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" /><span className="ml-3 font-medium hidden md:block">Làm Sạch Transcript</span></button>
          <button onClick={() => router.push('/dashboard/voice')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group"><Volume2 className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" /><span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai84)</span></button>
          <button onClick={() => router.push('/dashboard/voice-ai33')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group"><Volume2 className="w-5 h-5 flex-shrink-0 group-hover:text-cyan-400 transition-colors" /><span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai33)</span></button>
          <button onClick={() => router.push('/dashboard/podcast')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group"><Mic className="w-5 h-5 flex-shrink-0 group-hover:text-indigo-400 transition-colors" /><span className="ml-3 font-medium hidden md:block">Podcast Studio</span></button>
          <button onClick={() => router.push('/dashboard/rewriter')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group"><Type className="w-5 h-5 flex-shrink-0 group-hover:text-fuchsia-400 transition-colors" /><span className="ml-3 font-medium hidden md:block">Tool viết lại truyện</span></button>
          <button onClick={() => router.push('/dashboard/medical3')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all group"><Sparkles className="w-5 h-5 flex-shrink-0 group-hover:text-orange-400 transition-colors" /><span className="ml-3 font-medium hidden md:block">Prompt Medical 3.0</span></button>
          <button className="w-full flex items-center p-4 rounded-2xl bg-white/[0.03] text-white border border-white/5 shadow-lg"><User className="w-5 h-5 flex-shrink-0 text-violet-400" /><span className="ml-3 font-semibold hidden md:block">Character Prompt</span></button>
          {user?.role === 'admin' && (
            <button onClick={() => router.push('/admin')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-slate-800/50 hover:text-white transition-all group"><Settings className="w-5 h-5 flex-shrink-0 group-hover:rotate-90 transition-transform duration-500" /><span className="ml-3 font-medium hidden md:block">Quản Trị Admin</span></button>
          )}
        </nav>
        <div className="p-6 border-t border-white/5">
          <button onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }} className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all text-sm font-semibold">
            <LogOut className="w-4 h-4" /><span className="hidden md:block">Đăng Xuất</span>
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
        <SystemAnnouncementBanner userId={user?.id} />

        {/* HEADER */}
        <div className="bg-slate-900 border border-slate-800 p-4 sticky top-0 z-20 rounded-xl mb-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg">
                <User className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">Character Prompt</h1>
                <p className="text-[10px] text-violet-400 uppercase font-bold tracking-widest">Nhân Vật Nhất Quán • Theo SRT • Output Tiếng Anh</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-3">
              <button onClick={() => { setShowHistory(true); fetchHistory(user.id); }} className="flex items-center gap-2 px-5 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg border border-slate-700 text-xs font-bold">
                <Clock size={14} /> Lịch sử
              </button>
              {isProcessing && <span className="flex items-center gap-2 text-xs font-bold text-violet-400 animate-pulse bg-violet-500/10 px-3 py-1 rounded-full border border-violet-500/20">⚡ ĐANG TẠO PROMPTS...</span>}
            </div>
          </div>
        </div>

        {/* SEO BOX */}
        <div className="mb-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-blue-300">Mô Tả Video SEO</p>
              <p className="text-[10px] text-slate-500">Tạo riêng cho video YouTube chuẩn SEO</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowSeoBox((v) => !v)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-slate-700 text-[10px] font-bold uppercase tracking-widest text-slate-300">{showSeoBox ? 'Thu Gọn' : 'Xổ Ra'}</button>
              <button type="button" onClick={() => { if (!seoPackage) return; navigator.clipboard.writeText(buildSeoText(seoPackage)); setCopiedSeo(true); setTimeout(() => setCopiedSeo(false), 1800); }} disabled={!seoPackage} className="px-4 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-[10px] font-bold uppercase tracking-widest text-indigo-100 disabled:opacity-40">{copiedSeo ? 'Đã Copy' : 'Copy Mô Tả'}</button>
            </div>
          </div>
          {showSeoBox && (
            <div className="mt-3 rounded-xl bg-slate-950 border border-slate-800 p-4">
              {!seoPackage ? <p className="text-xs text-slate-500 italic">Chưa có dữ liệu mô tả. Hãy bấm nút "Tạo mô tả YouTube chuẩn SEO".</p> : (
                <div className="space-y-3 text-sm text-slate-200">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">{buildSeoText(seoPackage)}</pre>
                  <div className="pt-2 border-t border-slate-800">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Dịch nhanh mô tả</p>
                    <div className="flex flex-wrap gap-2">
                      {(['vi', 'ja', 'ko', 'en'] as SeoLanguage[]).map((lang) => (
                        <button key={lang} onClick={() => handleTranslateSeo(lang)} disabled={!!translatingSeo}
                          className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase border ${seoLang === lang ? 'bg-blue-600/30 text-blue-100 border-blue-400/40' : 'bg-white/5 text-slate-300 border-slate-700'} disabled:opacity-40`}>
                          {translatingSeo === lang ? '...' : lang.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-270px)]">
          {/* LEFT: Config + Inputs */}
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl flex flex-col h-full overflow-y-auto">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <User className="h-6 w-6 text-violet-400" /> Cấu hình & Nội dung
            </h2>

            {/* Model selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-400 mb-2">Mô hình ngôn ngữ</label>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => { setProvider('gemini'); setGeminiModel('gemini-2.5-flash'); }} disabled={isProcessing}
                  className={`h-10 rounded-lg border text-sm font-semibold transition-all ${provider === 'gemini' && geminiModel === 'gemini-2.5-flash' ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'}`}>
                  Gemini Flash
                </button>
                <button onClick={() => setProvider('openai')} disabled={isProcessing}
                  className={`h-10 rounded-lg border text-sm font-semibold transition-all ${provider === 'openai' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'}`}>
                  GPT-4.1 mini
                </button>
                <button onClick={() => { setProvider('gemini'); setGeminiModel('gemini-2.5-flash-lite'); }} disabled={isProcessing}
                  className={`h-10 rounded-lg border text-sm font-semibold transition-all ${provider === 'gemini' && geminiModel === 'gemini-2.5-flash-lite' ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'}`}>
                  Flash Lite
                </button>
              </div>
            </div>

            {/* Character name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-400 mb-2">Tên nhân vật chính <span className="text-rose-400">*</span></label>
              <input
                type="text"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                placeholder='VD: Minh, Sakura, John...'
                disabled={isProcessing}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white font-semibold focus:ring-2 focus:ring-violet-500 outline-none placeholder:text-slate-600 text-sm"
              />
              <p className="text-[10px] text-slate-500 mt-1">AI sẽ nhắc tên này nhất quán trong mọi prompt. Bạn thêm ảnh tham chiếu vào tool video sau.</p>
            </div>

            {/* Settings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Thể loại</label>
                <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-violet-500 outline-none text-sm" value={settings.category} onChange={(e) => setSettings({ ...settings, category: e.target.value as ContentCategory })} disabled={isProcessing}>
                  <option value={ContentCategory.LIFESTYLE}>Đời Sống</option>
                  <option value={ContentCategory.MEDICAL}>Y Tế</option>
                  <option value={ContentCategory.FOOD}>Ẩm Thực</option>
                  <option value={ContentCategory.STORYTELLING}>Kể Chuyện</option>
                  <option value={ContentCategory.GENERAL}>Chung</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Quốc gia</label>
                <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-violet-500 outline-none text-sm" value={settings.country} onChange={(e) => setSettings({ ...settings, country: e.target.value as Country })} disabled={isProcessing}>
                  <option value={Country.VIETNAM}>Việt Nam</option>
                  <option value={Country.KOREA}>Hàn Quốc</option>
                  <option value={Country.JAPAN}>Nhật Bản</option>
                  <option value={Country.USA}>Mỹ</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Phong cách</label>
                <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-violet-500 outline-none text-sm" value={settings.style} onChange={(e) => setSettings({ ...settings, style: e.target.value as VisualStyle })} disabled={isProcessing}>
                  <option value={VisualStyle.REALISTIC}>Đời thật (Realistic)</option>
                  <option value={VisualStyle.GHIBLI}>Studio Ghibli</option>
                  <option value={VisualStyle.WEBTOON}>Webtoon / Manhwa</option>
                  <option value={VisualStyle.ANIME_CINEMATIC}>Anime Cinematic</option>
                  <option value={VisualStyle.CARTOON_3D}>Hoạt hình 3D</option>
                  <option value={VisualStyle.IRASUTOYA}>Irasutoya (いらすとや)</option>
                </select>
              </div>
            </div>

            {/* SRT textarea */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-sm font-medium text-slate-400 mb-1">
                Nhập SRT / Transcript (Có Timestamp) <span className="text-rose-400">*</span>
                <span className="text-xs text-slate-500 ml-2 block sm:inline">Hỗ trợ SRT chuẩn & format [00:00:00.000] - [00:00:08.000] | text</span>
              </label>
              <textarea
                className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-4 text-sm text-slate-300 font-mono focus:ring-2 focus:ring-violet-500 outline-none resize-none"
                placeholder={"1\n00:00:00,000 --> 00:00:08,000\nMinh bước vào bệnh viện, tay cầm tờ kết quả..."}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                disabled={isProcessing}
              />
            </div>

            {/* Buttons */}
            <div className="mt-4 space-y-2">
              {isProcessing ? (
                <div className="w-full bg-slate-700 rounded-full h-12 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute left-0 top-0 h-full bg-violet-600 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                  <span className="relative z-10 font-bold text-white flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    Đang tạo... {Math.round(progress)}%
                  </span>
                </div>
              ) : (
                <>
                  <button onClick={handleGenerate} disabled={!transcript.trim() || !characterName.trim()}
                    className="w-full h-12 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg transition active:scale-[0.98] flex items-center justify-center gap-2">
                    <User className="h-5 w-5" /> Tạo Character Prompts
                  </button>
                  <button type="button" onClick={handleGenerateSeo} disabled={generatingSeo || !transcript.trim()}
                    className="w-full h-11 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-200 text-xs font-bold uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2">
                    {generatingSeo ? (<><svg className="animate-spin h-4 w-4 text-blue-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Đang tạo mô tả YouTube...</>) : 'Tạo mô tả YouTube chuẩn SEO'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Results */}
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl h-full flex flex-col">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white">Danh Sách Prompts ({segments.length})</h2>
                <span className="px-2 py-0.5 bg-violet-500/20 text-violet-400 text-[10px] uppercase tracking-wider font-bold rounded border border-violet-500/30">8s Segments</span>
                {characterName && <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 text-[10px] uppercase tracking-wider font-bold rounded border border-indigo-500/30">{characterName.toUpperCase()}</span>}
              </div>
              <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
                <button onClick={() => setSpacingMode('single')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${spacingMode === 'single' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>Đơn</button>
                <button onClick={() => setSpacingMode('double')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${spacingMode === 'double' ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>Đôi</button>
              </div>
            </div>

            {segments.length === 0 ? (
              <div className="bg-slate-900 rounded-xl border border-slate-700 flex-1 flex flex-col items-center justify-center text-slate-500">
                <User className="h-16 w-16 mb-4 opacity-20" />
                <p className="text-center font-medium">Chưa có kết quả.<br /><span className="text-sm opacity-60">Nhập tên nhân vật + SRT để bắt đầu.</span></p>
              </div>
            ) : (
              <>
                <div className="flex-1 bg-slate-900 rounded-lg p-5 overflow-y-auto border border-slate-700 font-mono text-sm leading-relaxed text-slate-300">
                  {segments.map((seg) => (
                    <div key={seg.index} className={spacingMode === 'double' ? 'mb-8' : 'mb-4'}>
                      <div className="text-violet-400 font-bold mb-1">{seg.index}. Transcript:</div>
                      <div className="text-slate-400 italic mb-2 bg-slate-800/50 p-2 rounded">{seg.relevantContext}</div>
                      <div className="text-violet-400 font-bold mb-1">Prompt:</div>
                      <div className="text-slate-200">{seg.generatedPrompt || <span className="text-slate-600 animate-pulse italic">Đang kiến tạo...</span>}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <button onClick={handleCopy} className={`w-full h-12 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.97] ${copied ? 'bg-emerald-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white'}`}>
                    {copied ? '✓ Đã Sao Chép! (Định dạng đánh số)' : 'Sao Chép Danh Sách Prompts'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {/* HISTORY DRAWER */}
      <AnimatePresence>
        {showHistory && (
          <div className="fixed inset-0 z-50 flex justify-end bg-[#020617]/80 backdrop-blur-md">
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="w-full max-w-lg bg-[#0f172a] h-full shadow-2xl flex flex-col border-l border-white/5">
              <div className="p-8 border-b border-white/5 flex items-center justify-between">
                <div><h3 className="text-xl font-bold text-white font-serif">Lịch sử Character Prompt</h3><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Lưu trữ theo nhân vật</p></div>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/10 rounded-full text-slate-500">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                {history.length > 0 ? history.map((h) => (
                  <button key={h.id} onClick={() => {
                    setTranscript(h.input_transcript || '');
                    setSegments(Array.isArray(h.results) ? h.results : []);
                    setCharacterName(h.genre || '');
                    setSettings((prev) => ({ ...prev, nationality: (h.nationality as Country) || prev.country }));
                    setProvider(h.provider === 'openai' ? 'openai' : 'gemini');
                    setShowHistory(false);
                  }} className="w-full p-5 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/5 transition-all text-left">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-violet-500/10 text-violet-300 text-[9px] font-black uppercase tracking-widest rounded border border-violet-500/20">{h.genre || 'CHARACTER'}</span>
                        <span className="px-2 py-1 bg-slate-700 text-slate-400 text-[9px] font-black uppercase tracking-widest rounded">{h.provider}</span>
                      </div>
                      <span className="text-[9px] text-slate-600 font-mono">{new Date(h.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed italic opacity-70">"{(h.input_transcript || '').slice(0, 150)}..."</p>
                  </button>
                )) : <div className="h-full flex items-center justify-center opacity-20 italic text-sm">Chưa có lịch sử</div>}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* REMINDER MODAL */}
      <AnimatePresence>
        {showKidsWarn && activeReminder && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#020617]/95 backdrop-blur-2xl">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="max-w-xl w-full bg-slate-900 border border-amber-500/20 rounded-[2rem] p-8 shadow-2xl space-y-5">
              {activeReminder.imageUrl && <img src={activeReminder.imageUrl} alt="Reminder" className="w-full rounded-xl max-h-64 object-cover border border-white/10" />}
              <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{activeReminder.message}</div>
              {activeReminder.confirmTimes > 1 && <p className="text-[10px] text-amber-400 text-center font-bold uppercase tracking-widest">Bước {reminderStep}/{activeReminder.confirmTimes}</p>}
              <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={reminderAgree} onChange={(e) => setReminderAgree(e.target.checked)} className="h-4 w-4 rounded" /><span className="text-sm text-slate-300">Tôi đã đọc và đồng ý</span></label>
              <div className="flex gap-3">
                <button onClick={cancelKids} className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 transition-all font-semibold text-sm">Hủy</button>
                <button onClick={confirmKidsStep} disabled={!reminderAgree} className="flex-1 py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 transition-all font-semibold text-sm">Tiếp tục</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
