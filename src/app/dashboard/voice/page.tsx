"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import JSZip from "jszip";
import {
  Mic, Play, Download, RefreshCw, User, Type,
  Volume2, CheckCircle2, Loader2, Trash2, Users,
  Plus, Clock, Sparkles, Video, Settings, LogOut,
  Cpu, Zap, AlertCircle, Upload, Coins, Calculator,
  Headphones, Edit3, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import SystemAnnouncementBanner from "@/components/SystemAnnouncementBanner";

interface Voice {
  canonical_voice_id: string;
  name: string;
  created_at: string;
}

interface ConversationLine {
  id: string;
  speaker: string;
  text: string;
  audioUrl?: string;
  status: "idle" | "waiting" | "pending" | "done" | "failed";
  error?: string;
  jobId?: string;
}

interface PronunciationFixRule {
  id: string;
  from: string;
  to: string;
}

const FIX_RULES_STORAGE_KEY = "voice_pronunciation_fix_rules_v1";
const VOICE_MIGRATION_STORAGE_KEY = "voice_cross_provider_migration_v1";
const SPEAKER_VOICE_MAP_STORAGE_KEY = "voice84_speaker_voice_map_v1";
const DEFAULT_FIX_RULES: PronunciationFixRule[] = [
  { id: "r1", from: "im lặng", to: "yên lặng" },
  { id: "r2", from: "ml", to: "mililit" },
  { id: "r3", from: "mg", to: "miligram" },
];

// --- Audio Processing Helper ---
const writeWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels: Float32Array[] = [];
  let i, sample, offset = 0, pos = 0;
  function setUint16(data: number) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data: number) { view.setUint32(pos, data, true); pos += 4; }
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
  for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true); pos += 2;
    }
    offset++;
  }
  return new Blob([bufferArr], { type: "audio/wav" });
};

export default function VoicePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [text, setText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentJob, setCurrentJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"cloned" | "system">("cloned");
  const [keyCount, setKeyCount] = useState(0);
  const [aliveKeys, setAliveKeys] = useState(0);
  const [deadKeys, setDeadKeys] = useState(0);
  const [deadKeyList, setDeadKeyList] = useState<Array<{ label: string; error: string }>>([]);
  const [otherActiveUsers, setOtherActiveUsers] = useState<Array<{ userId: string; userName: string; deviceCode: string; activeAt: string }>>([]);
  const [fixRules, setFixRules] = useState<PronunciationFixRule[]>(DEFAULT_FIX_RULES);
  const [newFixFrom, setNewFixFrom] = useState("");
  const [newFixTo, setNewFixTo] = useState("");
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [fixApplied, setFixApplied] = useState(false);
  const [fixAppliedCount, setFixAppliedCount] = useState<number>(0);

  // Conversation Mode States
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationLines, setConversationLines] = useState<ConversationLine[]>([]);
  const [speakerVoiceMap, setSpeakerVoiceMap] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SPEAKER_VOICE_MAP_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });
  const [isMerging, setIsMerging] = useState(false);
  const [mergedPreviewUrl, setMergedPreviewUrl] = useState<string | null>(null);
  const [mergedDownloadUrl, setMergedDownloadUrl] = useState<string | null>(null);
  const [mergedFilename, setMergedFilename] = useState<string | null>(null);
  const [isExportingSRT, setIsExportingSRT] = useState(false);
  const [isExportingIndividual, setIsExportingIndividual] = useState(false);
  const [concurrencyLimit, setConcurrencyLimit] = useState(3);
  const [requestDelay, setRequestDelay] = useState(3000);
  const [pauseDuration, setPauseDuration] = useState(300);

  // TTS Settings
  const [model, setModel] = useState("speech-2.6-turbo");
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const MAX_CHARS = 100000;

  // Credit & Cost
  const [creditInfo, setCreditInfo] = useState<Array<{ label: string; credits: number; error: string | null }>>([]);
  const [totalCredits, setTotalCredits] = useState(0);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  // Voice Clone
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [isCloning, setIsCloning] = useState(false);

  // Voice Preview
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState<string>("");
  const [needsVoiceRemapAfterSwitch, setNeedsVoiceRemapAfterSwitch] = useState(false);
  const [switchedFromProvider, setSwitchedFromProvider] = useState<"ai84" | "ai33" | null>(null);
  const skipAutoParseRef = useRef(false);

  const migrateToProvider = useCallback((target: "ai84" | "ai33") => {
    const hasWork = conversationLines.some((l) => l.status !== "idle" || Boolean(l.audioUrl));
    if (!hasWork) {
      setError("Chua co tien trinh de chuyen.");
      return;
    }

    const migratedLines: ConversationLine[] = conversationLines.map((line) => {
      if (line.status === "done" && line.audioUrl) return line;
      return {
        ...line,
        status: "failed",
        jobId: undefined,
        error: "Da chuyen he thong. Bam 'Thu lai cac cau loi' de chay tiep.",
      };
    });

    const unfinishedSpeakers = new Set(
      migratedLines.filter((l) => !(l.status === "done" && l.audioUrl)).map((l) => l.speaker)
    );
    const safeVoiceMap = Object.fromEntries(
      Object.entries(speakerVoiceMap).filter(([speaker]) => !unfinishedSpeakers.has(speaker))
    );

    const payload = {
      source: "ai84",
      target,
      text,
      isConversationMode,
      conversationLines: migratedLines,
      projectTitle,
      pauseDuration,
      requestDelay,
      concurrencyLimit,
      speakerVoiceMap: safeVoiceMap,
      migratedAt: Date.now(),
    };
    localStorage.setItem(VOICE_MIGRATION_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(SPEAKER_VOICE_MAP_STORAGE_KEY, JSON.stringify(safeVoiceMap));
    setSpeakerVoiceMap(safeVoiceMap);
    router.push(target === "ai33" ? "/dashboard/voice-ai33" : "/dashboard/voice");
  }, [conversationLines, speakerVoiceMap, text, isConversationMode, projectTitle, pauseDuration, requestDelay, concurrencyLimit, router]);

  const getDeviceCode = useCallback(() => {
    if (typeof window === 'undefined') return 'unknown';
    const existing = localStorage.getItem('storycraft_device_code');
    if (existing) return existing;
    const code = `DV-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    localStorage.setItem('storycraft_device_code', code);
    return code;
  }, []);

  // All ai84 TTS Models (Minimax engine)
  const TTS_MODELS = [
    { id: 'speech-2.6-turbo', name: 'v2.6 Turbo', desc: 'Nhanh nhất, chất lượng tốt' },
    { id: 'speech-2.6-hd', name: 'v2.6 HD', desc: 'Chất lượng cao, chậm hơn' },
    { id: 'speech-2.5-hd-preview', name: 'v2.5 HD Preview', desc: 'HD thế hệ 2.5' },
    { id: 'speech-2.5-turbo-preview', name: 'v2.5 Turbo Preview', desc: 'Turbo thế hệ 2.5' },
    { id: 'speech-02-hd', name: 'v02 HD', desc: 'HD ổn định' },
    { id: 'speech-02-turbo', name: 'v02 Turbo', desc: 'Turbo ổn định' },
    { id: 'speech-01-hd', name: 'v01 HD', desc: 'Thế hệ đầu HD' },
    { id: 'speech-01-turbo', name: 'v01 Turbo', desc: 'Thế hệ đầu Turbo' },
  ];

  // Auth
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (!profile || profile.status !== "approved") { await supabase.auth.signOut(); router.push("/login"); return; }
      setUser({ ...profile, id: session.user.id });
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    const prefillText = localStorage.getItem("voice_prefill_text");
    const prefillMode = localStorage.getItem("voice_prefill_mode");
    const prefillTitle = localStorage.getItem("voice_prefill_title");
    if (prefillText) {
      setText(prefillText);
      if (prefillMode === "conversation") {
        setIsConversationMode(true);
      }
      localStorage.removeItem("voice_prefill_text");
      localStorage.removeItem("voice_prefill_mode");
    }
    if (prefillTitle) {
      setProjectTitle(prefillTitle);
      localStorage.removeItem("voice_prefill_title");
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VOICE_MIGRATION_STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw);
      if (payload?.target !== "ai84") return;
      localStorage.removeItem(VOICE_MIGRATION_STORAGE_KEY);

      if (typeof payload.text === "string") setText(payload.text);
      if (typeof payload.projectTitle === "string") setProjectTitle(payload.projectTitle);
      if (typeof payload.isConversationMode === "boolean") setIsConversationMode(payload.isConversationMode);
      if (typeof payload.pauseDuration === "number") setPauseDuration(payload.pauseDuration);
      if (typeof payload.requestDelay === "number") setRequestDelay(payload.requestDelay);
      if (typeof payload.concurrencyLimit === "number") setConcurrencyLimit(payload.concurrencyLimit);

      if (Array.isArray(payload.conversationLines)) {
        skipAutoParseRef.current = true;
        setConversationLines(payload.conversationLines as ConversationLine[]);
        setNeedsVoiceRemapAfterSwitch(true);
      }
      if (payload.speakerVoiceMap && typeof payload.speakerVoiceMap === "object") {
        setSpeakerVoiceMap(payload.speakerVoiceMap as Record<string, string>);
      }
      if (payload.source === "ai33" || payload.source === "ai84") {
        setSwitchedFromProvider(payload.source);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FIX_RULES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map((r: any, idx: number) => ({
          id: String(r?.id || `rule-${idx}`),
          from: String(r?.from || "").trim(),
          to: String(r?.to || "").trim(),
        }))
        .filter((r: PronunciationFixRule) => r.from && r.to);
      if (normalized.length > 0) {
        setFixRules(normalized);
      }
    } catch {}
  }, []);

  const saveFixRulesToServer = useCallback(async (rules: PronunciationFixRule[]) => {
    if (!user?.id) return;
    await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_fix_rules", userId: user.id, rules }),
    });
  }, [user]);

  useEffect(() => {
    localStorage.setItem(FIX_RULES_STORAGE_KEY, JSON.stringify(fixRules));
  }, [fixRules]);

  useEffect(() => {
    if (!user?.id) return;
    const loadGlobalRules = async () => {
      try {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_fix_rules", userId: user.id }),
        });
        const data = await res.json();
        if (!res.ok) return;
        const serverRules = Array.isArray(data?.rules) ? data.rules : [];
        if (serverRules.length > 0) {
          setFixRules(serverRules);
        } else {
          await saveFixRulesToServer(fixRules);
        }
      } catch {}
    };
    loadGlobalRules();
  }, [user, saveFixRulesToServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch key count + health
  const refreshKeyHealth = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_key_count", userId: user.id }),
      });
      const d = await res.json();
      setKeyCount(d.count || 0);
      setAliveKeys(d.alive ?? d.count ?? 0);
      setDeadKeys(d.dead ?? 0);
      setDeadKeyList(d.deadKeys || []);
    } catch {}
  }, [user]);

  useEffect(() => { refreshKeyHealth(); }, [refreshKeyHealth]);

  const refreshVoicePresence = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "presence_list", userId: user.id }),
      });
      const data = await res.json();
      if (res.ok) setOtherActiveUsers(data.otherActive || []);
    } catch {}
  }, [user]);

  const sendVoicePresence = useCallback(async (state: "ping" | "end") => {
    if (!user) return;
    const action = state === "end" ? "presence_end" : "presence_ping";
    try {
      await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          userId: user.id,
          deviceCode: getDeviceCode(),
        }),
        keepalive: state === "end",
      });
    } catch {}
  }, [getDeviceCode, user]);

  useEffect(() => {
    if (!user) return;
    sendVoicePresence("ping");
    refreshVoicePresence();
    const pingTimer = setInterval(() => sendVoicePresence("ping"), 25000);
    const listTimer = setInterval(() => refreshVoicePresence(), 15000);
    return () => {
      clearInterval(pingTimer);
      clearInterval(listTimer);
      void sendVoicePresence("end");
    };
  }, [refreshVoicePresence, sendVoicePresence, user]);

  const fetchVoices = useCallback(async () => {
    if (!user) return;
    setLoadingVoices(true);
    setError(null);
    try {
      const endpoint = activeTab === "cloned" ? "get_cloned_voices" : "get_system_voices";
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: endpoint, userId: user.id }),
      });
      const result = await res.json();
      const voiceList = result.data || [];
      setVoices(voiceList);
      if (voiceList.length > 0 && !selectedVoice) {
        setSelectedVoice(voiceList[0].canonical_voice_id);
      }
    } catch (err) {
      setError("Lỗi kết nối server khi tải giọng đọc");
    } finally {
      setLoadingVoices(false);
    }
  }, [user, activeTab]);

  useEffect(() => { fetchVoices(); }, [fetchVoices]);

  useEffect(() => {
    if (Object.keys(speakerVoiceMap).length > 0) {
      localStorage.setItem(SPEAKER_VOICE_MAP_STORAGE_KEY, JSON.stringify(speakerVoiceMap));
    }
  }, [speakerVoiceMap]);

  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const applySingleRule = (input: string, rule: PronunciationFixRule): { text: string; count: number } => {
    const from = rule.from.trim();
    const to = rule.to.trim();
    if (!from || !to) return { text: input, count: 0 };

    let count = 0;

    if (/\s/.test(from)) {
      const phraseRegex = new RegExp(escapeRegex(from), "giu");
      const text = input.replace(phraseRegex, () => {
        count++;
        return to;
      });
      return { text, count };
    }

    const tokenRegex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(from)})(?=[^\\p{L}\\p{N}]|$)`, "giu");
    const text = input.replace(tokenRegex, (_m, prefix) => {
      count++;
      return `${prefix}${to}`;
    });
    return { text, count };
  };

  const applyFixWords = () => {
    if (!text.trim()) return;
    let totalCount = 0;
    setText((prev) => {
      let next = prev;
      fixRules.forEach((rule) => {
        const result = applySingleRule(next, rule);
        next = result.text;
        totalCount += result.count;
      });
      return next;
    });
    setFixAppliedCount(totalCount);
    setFixApplied(true);
    setTimeout(() => {
      setFixApplied(false);
      setFixAppliedCount(0);
    }, 1800);
  };

  const safeTitleSlug = useMemo(() => {
    const raw = projectTitle.trim();
    if (!raw) return "voice_output";
    const normalized = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    return normalized || "voice_output";
  }, [projectTitle]);

  const addFixRule = () => {
    const from = newFixFrom.trim();
    const to = newFixTo.trim();
    if (!from || !to) return;
    const duplicate = fixRules.some(
      (r) => r.from.toLowerCase() === from.toLowerCase() && r.to.toLowerCase() === to.toLowerCase()
    );
    if (duplicate) {
      setNewFixFrom("");
      setNewFixTo("");
      return;
    }
    const rule: PronunciationFixRule = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      from,
      to,
    };
    const nextRules = [...fixRules, rule];
    setFixRules(nextRules);
    void saveFixRulesToServer(nextRules);
    setNewFixFrom("");
    setNewFixTo("");
  };

  const removeFixRule = (id: string) => {
    const nextRules = fixRules.filter((r) => r.id !== id);
    setFixRules(nextRules);
    void saveFixRulesToServer(nextRules);
  };

  const getMissingSpeakerMappings = useCallback((lines: ConversationLine[]) => {
    const missing = new Set<string>();
    lines.forEach((line) => {
      if (line.status === "done" && line.audioUrl) return;
      if (!speakerVoiceMap[line.speaker]) missing.add(line.speaker);
    });
    return Array.from(missing);
  }, [speakerVoiceMap]);

  const ensureConversationVoicesSelected = useCallback((lines: ConversationLine[]) => {
    const missing = getMissingSpeakerMappings(lines);
    if (missing.length === 0) {
      setNeedsVoiceRemapAfterSwitch(false);
      return true;
    }
    const preview = missing.slice(0, 4).join(", ");
    const extra = missing.length > 4 ? ` +${missing.length - 4}` : "";
    const fromLabel = switchedFromProvider ? ` sau khi chuyển từ ${switchedFromProvider.toUpperCase()}` : "";
    setError(`Vui lòng chọn giọng cho: ${preview}${extra}${fromLabel}.`);
    return false;
  }, [getMissingSpeakerMappings, switchedFromProvider]);

  // Parse conversation lines
  useEffect(() => {
    if (isConversationMode) {
      if (skipAutoParseRef.current) {
        skipAutoParseRef.current = false;
        return;
      }
      const lines = text.split("\n").filter(l => l.trim() !== "");
      const parsed: ConversationLine[] = lines.map((line, idx) => {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) return { id: `line-${idx}`, speaker: match[1].trim(), text: match[2].trim(), status: "idle" as const };
        return { id: `line-${idx}`, speaker: "Unknown", text: line.trim(), status: "idle" as const };
      });
      setConversationLines(parsed);
      const uniqueSpeakers = Array.from(new Set(parsed.map(p => p.speaker)));
      setSpeakerVoiceMap(prev => {
        const next = { ...prev };
        uniqueSpeakers.forEach(s => { if (!next[s] && selectedVoice) next[s] = selectedVoice; });
        return next;
      });
      setNeedsVoiceRemapAfterSwitch(false);
      setSwitchedFromProvider(null);
    }
  }, [text, isConversationMode, selectedVoice]);

  // --- Core TTS Logic ---
  const pollJobStatus = async (jobId: string, lineId?: string, keyIdx?: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      let consecutiveErrors = 0;
      let pollInterval = 5000;
      let rateLimitHits = 0;
      const startedAt = Date.now();
      const MAX_POLL_MS = 90000;
      const MAX_RATE_LIMIT_HITS = 3;
      const MAX_CONSECUTIVE_ERRORS = 4;

      const poll = async () => {
        if (Date.now() - startedAt > MAX_POLL_MS) {
          reject("Qua thoi gian doi ket qua. Bam 'Thu lai cac cau loi' de tiep tuc.");
          return;
        }
        try {
          const res = await fetch("/api/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "tts_status", userId: user.id, jobId, keyIndex: keyIdx }),
          });
          if (res.status === 429) {
            rateLimitHits++;
            if (rateLimitHits >= MAX_RATE_LIMIT_HITS) {
              reject("API dang gioi han lien tuc. Bam 'Thu lai cac cau loi' de chay vong moi.");
              return;
            }
            pollInterval = Math.min(5000 * Math.pow(1.5, rateLimitHits), 30000);
            if (lineId) setConversationLines(prev => prev.map(l => l.id === lineId ? { ...l, error: `Đang đợi API (Rate Limit), đợi ${Math.round(pollInterval/1000)}s...` } : l));
            setTimeout(poll, pollInterval);
            return;
          }
          const result = await res.json();
          consecutiveErrors = 0;
          rateLimitHits = Math.max(0, rateLimitHits - 1);
          if (result.success) {
            const job = result.job;
            if (job.status === "done") { resolve(job.audio_url); return; }
            if (job.status === "failed") { reject(job.error_message || "Tạo giọng đọc thất bại"); return; }
            if (job.progress !== undefined && lineId) {
              setConversationLines(prev => prev.map(l => l.id === lineId ? { ...l, error: `Đang xử lý: ${job.progress}%` } : l));
            }
          } else {
            consecutiveErrors++;
            if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) { reject("Loi API khi lay trang thai. Bam 'Thu lai cac cau loi'."); return; }
          }
        } catch {
          consecutiveErrors++;
          if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) { reject("Loi ket noi khi kiem tra trang thai."); return; }
          pollInterval = Math.min(pollInterval * 1.5, 20000);
        }
        setTimeout(poll, pollInterval);
      };
      setTimeout(poll, 3000);
    });
  };

  const generateTTS = async () => {
    if (!text.trim()) { setError("Vui lòng nhập văn bản"); return; }
    if (isConversationMode) { generateConversationTTS(); return; }
    if (!selectedVoice) { setError("Vui lòng chọn giọng đọc"); return; }

    setIsGenerating(true); setError(null); setCurrentJob(null);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tts_async", userId: user.id,
          canonical_voice_id: selectedVoice, text, model, speed, pitch, volume,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setCurrentJob({ job_id: result.job_id, status: result.status });
        const url = await pollJobStatus(result.job_id);
        setCurrentJob((prev: any) => prev ? { ...prev, status: "done", audio_url: url } : null);
      } else {
        setError(result.message || "Không thể bắt đầu tạo giọng đọc");
      }
    } catch (err: any) {
      setError("Lỗi kết nối server: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const processLine = async (line: ConversationLine, keyIdx: number, retryCount = 0): Promise<boolean> => {
    const MAX_LINE_RETRY = 1;
    const RETRY_DELAY_MS = 2000;
    const voiceId = speakerVoiceMap[line.speaker];
    if (!voiceId) { setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "failed", error: "Chưa chọn giọng" } : l)); return false; }

    setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "pending", error: "Đang gửi yêu cầu..." } : l));
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tts_async", userId: user.id, keyIndex: keyIdx,
          canonical_voice_id: voiceId, text: line.text, model, speed, pitch, volume,
        }),
      });
      if (res.status === 429) {
        if (retryCount < MAX_LINE_RETRY) {
          setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, error: `Bị giới hạn, đổi key và thử nhanh lại sau ${RETRY_DELAY_MS / 1000}s...` } : l));
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          return processLine(line, keyIdx, retryCount + 1);
        }
        setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "failed", error: "Bị giới hạn tạm thời, bấm 'Thử lại các câu lỗi' để chạy tiếp ngay." } : l));
        return false;
      }
      const result = await res.json();
      if (result.success) {
        // Cập nhật dead key list từ response
        if (result._keyHealth?.deadKeys) setDeadKeyList(result._keyHealth.deadKeys);
        setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, jobId: result.job_id, error: `[✓ ${result._keyHealth?.usedKey || 'Key'}] Đang chờ xử lý...` } : l));
        const url = await pollJobStatus(result.job_id, line.id, keyIdx);
        setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "done", audioUrl: url, error: undefined } : l));
        return false;
      } else {
        if (result._keyHealth?.deadKeys) setDeadKeyList(result._keyHealth.deadKeys);
        const keyLabel = result._keyHealth?.usedKey || 'Key';
        const alive = Number(result?._keyHealth?.aliveKeys ?? 1);
        if (alive <= 0) {
          setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "failed", error: `[${keyLabel}] Het key song. Bam chay lai thu cong.` } : l));
          return true;
        }
        setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "failed", error: `[${keyLabel}] ${result.message}` } : l));
        return false;
      }
    } catch (err: any) {
      const msg = String(err?.message || "");
      const isHardStop = msg.toLowerCase().includes("không có api key khả dụng") || msg.toLowerCase().includes("het key");
      setConversationLines(prev => prev.map(l => l.id === line.id ? { ...l, status: "failed", error: isHardStop ? "Het key song. Bam chay lai thu cong." : "Lỗi kết nối" } : l));
      return isHardStop;
    }
  };

  const generateConversationTTS = async () => {
    const linesToProcess = conversationLines.filter(l => l.status !== "done");
    if (!ensureConversationVoicesSelected(linesToProcess)) return;
    await refreshKeyHealth();
    let aliveNow = 0;
    try {
      const healthRes = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_key_count", userId: user.id }),
      });
      const healthJson = await healthRes.json();
      aliveNow = Number(healthJson?.alive ?? 0);
    } catch {}
    if (aliveNow <= 0) {
      setError("Khong con key song. Bam lai khi key hoi phuc hoac chuyen nha cung cap.");
      return;
    }
    setIsGenerating(true); setError(null);
    setConversationLines(prev => prev.map(l => l.status === "idle" || l.status === "failed" ? { ...l, status: "waiting", error: "Đang trong hàng đợi..." } : l));

    // Phân phối lines vào các key slots — dùng ALIVE keys thay vì tổng
    const numKeys = Math.max(aliveKeys || keyCount, 1);
    const segments: ConversationLine[][] = Array.from({ length: numKeys }, () => []);
    linesToProcess.forEach((line, index) => { segments[index % numKeys].push(line); });

    let hardStopAll = false;
    const workers = segments.map(async (segment, keyIdx) => {
      const queue = [...segment];
      const runNext = async () => {
        if (queue.length === 0 || hardStopAll) return;
        const line = queue.shift()!;
        await new Promise(r => setTimeout(r, requestDelay));
        const hardStop = await processLine(line, keyIdx);
        if (hardStop) {
          hardStopAll = true;
          setError("Tat ca key dang khong kha dung. Da dung tien trinh, ban co the bam chay lai ngay.");
          setConversationLines(prev => prev.map(l => {
            if (l.status === "waiting" || l.status === "pending") {
              return { ...l, status: "failed", error: "Da dung som vi het key song. Bam 'Thử lại các câu lỗi'." };
            }
            return l;
          }));
          return;
        }
        if (queue.length > 0) await runNext();
      };
      const segmentConcurrency = Math.min(concurrencyLimit, queue.length);
      const segmentWorkers = [];
      for (let i = 0; i < segmentConcurrency; i++) {
        segmentWorkers.push((async () => { await new Promise(r => setTimeout(r, i * 3000)); return runNext(); })());
      }
      await Promise.all(segmentWorkers);
    });
    await Promise.all(workers);
    await refreshKeyHealth(); // Cập nhật health sau khi xử lý xong
    setIsGenerating(false);
  };

  const retryFailedLines = async () => {
    const failedLines = conversationLines.filter(l => l.status === "failed");
    if (failedLines.length === 0) return;
    if (!ensureConversationVoicesSelected(failedLines)) return;
    await refreshKeyHealth();
    setIsGenerating(true);
    setConversationLines(prev => prev.map(l => l.status === "failed" ? { ...l, status: "waiting", error: "Đang thử lại..." } : l));

    const numKeys = Math.max(aliveKeys || keyCount, 1);
    const segments: ConversationLine[][] = Array.from({ length: numKeys }, () => []);
    failedLines.forEach((line, i) => { segments[i % numKeys].push(line); });
    let hardStopAll = false;
    const workers = segments.map(async (segment, keyIdx) => {
      for (const line of segment) {
        if (hardStopAll) break;
        await new Promise(r => setTimeout(r, requestDelay));
        const hardStop = await processLine(line, keyIdx);
        if (hardStop) {
          hardStopAll = true;
          setError("Tat ca key dang khong kha dung. Da dung tien trinh, ban co the bam chay lai ngay.");
          break;
        }
      }
    });
    await Promise.all(workers);
    await refreshKeyHealth();
    setIsGenerating(false);
  };

  // --- Audio Merge (Client-Side) ---
  const mergeConversationAudio = async (speakerToExport?: string) => {
    const items = conversationLines
      .filter(l => l.audioUrl)
      .map(l => ({ url: l.audioUrl!, speaker: l.speaker, isMuted: speakerToExport ? l.speaker !== speakerToExport : false }));
    if (items.length === 0) { setError("Không có đoạn audio nào để gộp."); return; }

    setIsMerging(true); setMergedPreviewUrl(null); setMergedDownloadUrl(null); setMergedFilename(null); setError(null);
    let audioCtx: AudioContext | null = null;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const audioBuffers: { buffer: AudioBuffer; isMuted: boolean }[] = [];
      for (let i = 0; i < items.length; i += 5) {
        const chunk = items.slice(i, i + 5);
        const chunkResults = await Promise.all(chunk.map(async (item) => {
          const res = await fetch("/api/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "proxy_audio", userId: user.id, url: item.url }),
          });
          const arrayBuffer = await res.arrayBuffer();
          const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
            audioCtx!.decodeAudioData(arrayBuffer, resolve, () => reject(new Error("Lỗi giải mã âm thanh.")));
          });
          return { buffer: audioBuffer, isMuted: item.isMuted };
        }));
        audioBuffers.push(...chunkResults);
      }

      const sampleRate = audioBuffers[0].buffer.sampleRate;
      const pauseSamples = Math.floor((pauseDuration / 1000) * sampleRate);
      let totalLength = 0;
      for (let i = 0; i < audioBuffers.length; i++) {
        totalLength += audioBuffers[i].buffer.length;
        if (i < audioBuffers.length - 1) totalLength += pauseSamples;
      }

      const resultBuffer = audioCtx.createBuffer(audioBuffers[0].buffer.numberOfChannels, totalLength, sampleRate);
      let offset = 0;
      for (let i = 0; i < audioBuffers.length; i++) {
        const { buffer, isMuted } = audioBuffers[i];
        if (!isMuted) {
          for (let ch = 0; ch < resultBuffer.numberOfChannels; ch++) {
            resultBuffer.getChannelData(ch).set(buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1)), offset);
          }
        }
        offset += buffer.length;
        if (i < audioBuffers.length - 1) offset += pauseSamples;
      }

      const wavBlob = writeWav(resultBuffer);
      const url = URL.createObjectURL(wavBlob);
      setMergedPreviewUrl(url); setMergedDownloadUrl(url);
      setMergedFilename(speakerToExport ? `${safeTitleSlug}_${speakerToExport}_${Date.now()}.wav` : `${safeTitleSlug}_full_${Date.now()}.wav`);
    } catch (err: any) {
      setError(`Lỗi gộp: ${err.message}`);
    } finally {
      if (audioCtx) await audioCtx.close();
      setIsMerging(false);
    }
  };

  const downloadMergedFile = () => {
    if (!mergedDownloadUrl || !mergedFilename) return;
    const a = document.createElement("a");
    a.href = mergedDownloadUrl; a.download = mergedFilename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // --- Export Functions ---
  const formatSRTTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60); const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`;
  };

  const getAudioDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = url; audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => resolve(0);
      setTimeout(() => resolve(0), 10000);
    });
  };

  const exportSRT = async () => {
    const linesWithAudio = conversationLines.filter(l => l.audioUrl);
    if (linesWithAudio.length === 0) return;
    setIsExportingSRT(true); setError(null);
    try {
      const durations = await Promise.all(linesWithAudio.map(l => getAudioDuration(l.audioUrl!)));
      let currentTime = 0;
      const content = linesWithAudio.map((line, idx) => {
        const duration = durations[idx] || 2;
        const block = `[${formatSRTTime(currentTime)}] - [${formatSRTTime(currentTime + duration)}] | [${line.speaker}]: ${line.text}`;
        currentTime += duration + (pauseDuration / 1000);
        return block;
      }).join("\n");
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${safeTitleSlug}_subtitle_${Date.now()}.txt`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err: any) {
      setError(`Lỗi khi xuất TXT: ${err.message}`);
    } finally {
      setIsExportingSRT(false);
    }
  };

  const exportIndividualAudio = async () => {
    const linesWithAudio = conversationLines.filter(l => l.audioUrl);
    if (linesWithAudio.length === 0) return;
    setIsExportingIndividual(true); setError(null);
    try {
      const zip = new JSZip();
      await Promise.all(linesWithAudio.map(async (line, index) => {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "proxy_audio", userId: user.id, url: line.audioUrl }),
        });
        const blob = await res.blob();
        zip.file(`${(index + 1).toString().padStart(3, '0')}_${line.speaker}.mp3`, blob);
      }));
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a"); a.href = url; a.download = `${safeTitleSlug}_audio_tracks_${Date.now()}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err: any) {
      setError(`Lỗi khi tạo file ZIP: ${err.message}`);
    } finally {
      setIsExportingIndividual(false);
    }
  };
  // --- Credit Monitor ---
  const fetchCredits = async () => {
    if (!user) return;
    setLoadingCredits(true);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_credits", userId: user.id }),
      });
      const data = await res.json();
      if (data.success) {
        setCreditInfo(data.keys || []);
        setTotalCredits(data.totalCredits || 0);
      }
    } catch {} finally { setLoadingCredits(false); }
  };

  // --- Cost Estimation ---
  const estimateCost = async (textLength: number) => {
    if (!user || textLength === 0) { setEstimatedCost(null); return; }
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "estimate_cost", userId: user.id,
          serviceType: "tts", provider: "minimax",
          baseAmount: textLength,
          options: { model_id: model, use_cloned_voice: activeTab === "cloned" },
        }),
      });
      const data = await res.json();
      if (data.success) setEstimatedCost(data.cost);
    } catch { setEstimatedCost(null); }
  };

  // Debounce estimate khi text thay đổi
  useEffect(() => {
    const len = isConversationMode
      ? conversationLines.reduce((s, l) => s + l.text.length, 0)
      : text.length;
    const timer = setTimeout(() => estimateCost(len), 800);
    return () => clearTimeout(timer);
  }, [text, model, activeTab, isConversationMode, conversationLines.length]);

  // --- Voice Clone ---
  const cloneVoice = async () => {
    if (!cloneFile || !user) return;
    setIsCloning(true); setError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(cloneFile);
      });

      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "clone_voice", userId: user.id,
          fileBase64: base64,
          fileName: cloneFile.name,
          voiceName: cloneName || cloneFile.name.replace(/\.[^.]+$/, ''),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCloneModal(false);
        setCloneFile(null); setCloneName('');
        fetchVoices(); // Refresh danh sách giọng
      } else {
        setError(data.message || "Lỗi nhân bản giọng");
      }
    } catch (err: any) {
      setError("Lỗi: " + err.message);
    } finally { setIsCloning(false); }
  };

  // --- Voice Preview ---
  const previewVoice = async (voiceId: string) => {
    if (previewingVoice === voiceId) return; // đang preview rồi
    setPreviewingVoice(voiceId);
    setPreviewAudioUrl(null);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview_voice", userId: user.id, voiceId }),
      });
      const data = await res.json();
      if (data.success) {
        setPreviewAudioUrl(data.audioUrl);
      } else {
        setError(data.message || "Không thể tạo preview");
      }
    } catch { setError("Lỗi kết nối khi tạo preview"); }
    finally { setPreviewingVoice(null); }
  };

  const uniqueSpeakers = useMemo(() => Array.from(new Set(conversationLines.map(l => l.speaker))), [conversationLines]);

  if (!user) return <div className="flex h-screen items-center justify-center bg-[#020617]"><Loader2 className="animate-spin text-indigo-500 w-10 h-10"/></div>;

  return (
    <div className="flex h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden">

      {/* SIDEBAR */}
      <aside className="w-20 md:w-64 bg-[#0f172a]/80 backdrop-blur-xl border-r border-white/5 flex flex-col flex-shrink-0 z-20">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
           <div className="w-10 h-10 btn-ombre rounded-xl flex items-center justify-center text-white font-bold text-2xl font-serif shadow-lg">S</div>
           <span className="ml-3 font-serif font-bold text-xl hidden md:block text-gradient">NovaForge AI</span>
        </div>
        <nav className="flex-1 py-8 px-3 space-y-2">
          <button onClick={() => router.push('/dashboard/cleaner')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Làm Sạch Transcript</span>
          </button>
          <button onClick={() => router.push('/dashboard/prompter')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <Video className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Tạo Prompt Video</span>
          </button>
          <button className="w-full flex items-center p-4 rounded-2xl bg-white/[0.03] text-white border border-white/5 shadow-lg">
            <Volume2 className="w-5 h-5 flex-shrink-0 text-indigo-400" />
            <span className="ml-3 font-semibold hidden md:block">Giọng Nói AI (ai84)</span>
          </button>
          <button onClick={() => router.push('/dashboard/voice-ai33')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <Volume2 className="w-5 h-5 flex-shrink-0 text-cyan-400" />
            <span className="ml-3 font-medium hidden md:block">Giọng Nói AI (ai33)</span>
          </button>
          <button onClick={() => router.push('/dashboard/podcast')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <Mic className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Podcast Studio</span>
          </button>
          <button onClick={() => router.push('/dashboard/medical3')} className="w-full flex items-center p-4 rounded-2xl text-slate-400 hover:bg-white/5 hover:text-white transition-all">
            <Video className="w-5 h-5 flex-shrink-0" />
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
          <button onClick={() => { supabase.auth.signOut(); router.push('/login'); }} className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all text-sm font-semibold">
            <LogOut className="w-4 h-4" /> <span className="hidden md:block">Đăng Xuất</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto relative p-4 md:p-10">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full -z-10"></div>
        <SystemAnnouncementBanner userId={user?.id} />

        <header className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-4xl font-bold text-white font-serif tracking-tight mb-2">Giọng Nói <span className="text-gradient">AI Studio</span></h2>
            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black tracking-widest uppercase italic">
              <span>ai84 TTS Integration</span>
              {otherActiveUsers.length > 0 && (
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-300 rounded border border-amber-500/30">
                  {otherActiveUsers.length} người đang dùng
                </span>
              )}
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">{aliveKeys} sống</span>
              {deadKeys > 0 && <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 rounded border border-rose-500/20">{deadKeys} chết</span>}
              <span className="px-2 py-0.5 bg-white/5 text-slate-500 rounded border border-white/10">{keyCount} tổng</span>
            </div>
            <div className="mt-3">
              <input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="Tiêu đề file voice..."
                className="w-[320px] max-w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
              <button onClick={() => setIsConversationMode(false)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${!isConversationMode ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>Đơn lẻ</button>
              <button onClick={() => setIsConversationMode(true)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${isConversationMode ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:bg-white/5'}`}>Hội thoại</button>
            </div>
            {isConversationMode && (
              <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Luồng:</span>
                <input type="number" min="1" max="5" value={concurrencyLimit} onChange={(e) => setConcurrencyLimit(parseInt(e.target.value))}
                  className="w-8 bg-transparent text-[10px] font-bold outline-none text-indigo-400" />
              </div>
            )}
          </div>
        </header>

        {otherActiveUsers.length > 0 && (
          <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-amber-300 mb-1">
              Cảnh báo tải hệ thống giọng nói
            </p>
            <p className="text-xs text-amber-100">
              Hiện có {otherActiveUsers.length} nhân viên đang dùng Giọng Nói AI:{" "}
              {otherActiveUsers.map((u) => `${u.userName} (${u.deviceCode})`).join(", ")}.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 flex-1 min-h-0">
          {/* Left: Voice Selection & Settings */}
          <div className="xl:col-span-4 space-y-6 overflow-y-auto">
            {/* Voice List */}
            <div className="glass-card rounded-[2.5rem] p-6 border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2"><User size={16} className="text-indigo-400"/>Giọng Đọc</h3>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowCloneModal(true)} className="p-2 hover:bg-indigo-500/10 rounded-full text-indigo-400 transition-all" title="Nhân bản giọng mới"><Upload size={14}/></button>
                  <button onClick={fetchVoices} className="p-2 hover:bg-white/5 rounded-full text-slate-500"><RefreshCw size={16} className={loadingVoices ? "animate-spin" : ""}/></button>
                </div>
              </div>
              <div className="flex p-1 bg-white/5 rounded-2xl mb-4">
                <button onClick={() => setActiveTab("cloned")} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === "cloned" ? "bg-white/10 text-white" : "text-slate-500"}`}>Nhân bản</button>
                <button onClick={() => setActiveTab("system")} className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === "system" ? "bg-white/10 text-white" : "text-slate-500"}`}>Hệ thống</button>
              </div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
                {loadingVoices ? <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-indigo-500" size={24}/></div> :
                 voices.length === 0 ? <p className="py-8 text-center text-xs text-slate-600 italic">Không tìm thấy giọng đọc</p> :
                 voices.map((voice) => (
                  <motion.div key={voice.canonical_voice_id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    onClick={() => setSelectedVoice(voice.canonical_voice_id)}
                    className={`p-3 rounded-2xl cursor-pointer border transition-all ${selectedVoice === voice.canonical_voice_id ? "bg-indigo-500/10 border-indigo-500/30" : "bg-white/[0.02] border-white/5 hover:border-white/10"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${selectedVoice === voice.canonical_voice_id ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-500"}`}><Mic size={14}/></div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{voice.name}</p>
                          <p className="text-[9px] text-slate-600">{new Date(voice.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); previewVoice(voice.canonical_voice_id); }}
                          disabled={previewingVoice !== null}
                          className={`p-1.5 rounded-lg transition-all ${previewingVoice === voice.canonical_voice_id ? "bg-indigo-500/20 text-indigo-400" : "hover:bg-white/5 text-slate-600 hover:text-white"}`}
                          title="Nghe thử">
                          {previewingVoice === voice.canonical_voice_id ? <Loader2 size={12} className="animate-spin"/> : <Headphones size={12}/>}
                        </button>
                        {selectedVoice === voice.canonical_voice_id && <CheckCircle2 size={14} className="text-indigo-400"/>}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              {/* Preview Audio Player */}
              {previewAudioUrl && (
                <div className="mt-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">🔊 Preview</span>
                    <button onClick={() => setPreviewAudioUrl(null)} className="p-1 hover:bg-white/5 rounded text-slate-500"><X size={12}/></button>
                  </div>
                  <audio src={previewAudioUrl} controls autoPlay className="w-full h-7"/>
                </div>
              )}
            </div>

            {/* Speaker Assignment (Conversation Mode) */}
            {isConversationMode && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-[2.5rem] p-6 border-white/5">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2 mb-4"><Users size={16} className="text-indigo-400"/>Gán Giọng Nhân Vật</h3>
                <div className="space-y-3">
                  {uniqueSpeakers.map(speaker => (
                    <div key={speaker} className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">{speaker}</label>
                      <select value={speakerVoiceMap[speaker] || ""} onChange={(e) => setSpeakerVoiceMap(prev => ({ ...prev, [speaker]: e.target.value }))}
                        className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 appearance-none">
                        <option value="">Chọn giọng...</option>
                        {voices.map(v => <option key={v.canonical_voice_id} value={v.canonical_voice_id}>{v.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* TTS Settings — Full Models */}
            <div className="glass-card rounded-[2.5rem] p-6 border-white/5">
              <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2 mb-4"><Settings size={16} className="text-indigo-400"/>Cấu Hình TTS</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Model TTS (ai84)</label>
                  <div className="space-y-1.5">
                    {TTS_MODELS.map(m => (
                      <button key={m.id} onClick={() => setModel(m.id)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all border ${model === m.id ? "bg-indigo-500/10 border-indigo-500/30" : "bg-white/[0.02] border-white/5 hover:border-white/10"}`}>
                        <div>
                          <p className="text-[10px] font-bold text-white">{m.name}</p>
                          <p className="text-[9px] text-slate-600">{m.desc}</p>
                        </div>
                        {model === m.id && <CheckCircle2 size={12} className="text-indigo-400 flex-shrink-0"/>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Tốc độ ({speed}x)</label>
                    <input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="w-full accent-indigo-500"/>
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Pitch ({pitch})</label>
                    <input type="range" min="-12" max="12" step="1" value={pitch} onChange={(e) => setPitch(parseInt(e.target.value))} className="w-full accent-indigo-500"/>
                  </div>
                </div>
              </div>
            </div>

            {/* Credit Monitor */}
            <div className="glass-card rounded-[2.5rem] p-6 border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2"><Coins size={16} className="text-amber-400"/>Credit</h3>
                <button onClick={fetchCredits} disabled={loadingCredits} className="p-2 hover:bg-white/5 rounded-full text-slate-500">
                  <RefreshCw size={14} className={loadingCredits ? "animate-spin" : ""}/>
                </button>
              </div>
              {creditInfo.length > 0 ? (
                <div className="space-y-2">
                  {creditInfo.map((ci, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 bg-white/[0.02] rounded-xl border border-white/5">
                      <span className="text-[10px] font-bold text-slate-400 truncate">{ci.label}</span>
                      {ci.error ? (
                        <span className="text-[10px] text-rose-400">Lỗi</span>
                      ) : (
                        <span className={`text-[10px] font-black ${ci.credits > 5000 ? 'text-emerald-400' : ci.credits > 1000 ? 'text-amber-400' : 'text-rose-400'}`}>
                          {ci.credits.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Tổng</span>
                    <span className="text-sm font-black text-amber-400">{totalCredits.toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <button onClick={fetchCredits} className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs text-slate-500 transition-all">
                  Nhấn để kiểm tra credit
                </button>
              )}
            </div>
          </div>

          {/* Right: Text Input & Results */}
          <div className="xl:col-span-8 flex flex-col min-h-0">
            <div className="glass-card rounded-[2.5rem] p-8 border-white/5 flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2"><Type size={16} className="text-indigo-400"/>Soạn Thảo</h3>
                <span className="text-[10px] font-mono text-slate-600">{text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}</span>
              </div>

              <div className="mb-4 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={applyFixWords}
                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                      fixApplied
                        ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                        : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20"
                    }`}
                  >
                    {fixApplied ? `Đã Fix ${fixAppliedCount} lỗi` : "Fix Từ Lỗi"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFixPanel((prev) => !prev)}
                    className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 transition-all flex items-center gap-2"
                  >
                    <Edit3 size={12} />
                    Quản Lý Từ Lỗi ({fixRules.length})
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                  Nhấn 1 lần để thay toàn bộ từ lỗi theo kho quy tắc hiện tại.
                </p>

                {showFixPanel && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        value={newFixFrom}
                        onChange={(e) => setNewFixFrom(e.target.value)}
                        placeholder="Từ lỗi (ví dụ: ml)"
                        className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <input
                        value={newFixTo}
                        onChange={(e) => setNewFixTo(e.target.value)}
                        placeholder="Từ thay thế (ví dụ: mililit)"
                        className="bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={addFixRule}
                        className="px-4 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-200 text-xs font-bold"
                      >
                        Thêm
                      </button>
                    </div>
                    <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                      {fixRules.map((rule) => (
                        <div key={rule.id} className="flex items-center justify-between text-xs bg-black/20 border border-white/5 rounded-lg px-3 py-1.5">
                          <span className="text-slate-200">{rule.from} → {rule.to}</span>
                          <button
                            type="button"
                            onClick={() => removeFixRule(rule.id)}
                            className="text-rose-300 hover:text-rose-200 text-[10px] font-bold uppercase tracking-widest"
                          >
                            Xóa
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_CHARS} disabled={isGenerating}
                placeholder={isConversationMode ? "Nhập hội thoại:\nA: Chào bạn\nB: Chào A, bạn khỏe không?" : "Nhập nội dung chuyển đổi thành giọng nói..."}
                className={`flex-1 w-full bg-white/[0.02] border border-white/5 rounded-3xl p-6 text-sm text-white resize-none outline-none transition-all placeholder:text-slate-700 min-h-[200px] ${isGenerating ? "opacity-50 cursor-not-allowed" : "focus:border-indigo-500/30"}`}/>

              {/* Dead Key Warning Banner */}
              {deadKeyList.length > 0 && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle size={16} className="text-rose-400"/>
                    <span className="text-xs font-bold text-rose-400">⚠ Key đang bị lỗi ({deadKeyList.length} key chết):</span>
                  </div>
                  <div className="space-y-1">
                    {deadKeyList.map((dk, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className="font-bold text-rose-300">✕ {dk.label}</span>
                        <span className="text-rose-400/70">— {dk.error}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-rose-400/50 mt-2 italic">He thong bo qua key loi va thu key khac. Neu van loi, bam chuyen nha cung cap hoac bam thu lai.</p>
                </motion.div>
              )}

              {/* Conversation Progress */}
              {isConversationMode && conversationLines.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Đợi", count: conversationLines.filter(l => l.status === "waiting" || l.status === "idle").length, color: "text-blue-400", bg: "bg-blue-500/10" },
                      { label: "Chạy", count: conversationLines.filter(l => l.status === "pending").length, color: "text-yellow-400", bg: "bg-yellow-500/10" },
                      { label: "Xong", count: conversationLines.filter(l => l.status === "done").length, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                      { label: "Lỗi", count: conversationLines.filter(l => l.status === "failed").length, color: "text-rose-400", bg: "bg-rose-500/10" },
                    ].map(s => (
                      <div key={s.label} className={`${s.bg} p-2 rounded-xl text-center border border-white/5`}>
                        <p className={`text-[9px] font-black uppercase tracking-widest ${s.color} opacity-70`}>{s.label}</p>
                        <p className={`text-lg font-black ${s.color}`}>{s.count}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
                    {conversationLines.map((line, index) => (
                      <div key={line.id} className={`flex items-start gap-3 p-3 rounded-2xl border transition-all ${
                        line.status === "done" ? "bg-emerald-500/5 border-emerald-500/10" :
                        line.status === "failed" ? "bg-rose-500/5 border-rose-500/10" :
                        line.status === "pending" ? "bg-yellow-500/5 border-yellow-500/10" : "bg-white/[0.01] border-white/5"
                      }`}>
                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <span className="text-[9px] font-black text-slate-700">{(index+1).toString().padStart(2,'0')}</span>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            line.status === "done" ? "bg-emerald-500 text-white" :
                            line.status === "failed" ? "bg-rose-500 text-white" :
                            line.status === "pending" ? "bg-yellow-500 text-white animate-pulse" : "bg-white/5 text-indigo-400"
                          }`}>{line.speaker[0]}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 truncate">{line.speaker}</span>
                              {line.error && <span className={`text-[9px] truncate ${line.status === "failed" ? "text-rose-400" : "text-yellow-400"}`}>({line.error})</span>}
                            </div>
                            {line.status === "pending" && <Loader2 size={12} className="animate-spin text-yellow-400"/>}
                            {line.status === "done" && <CheckCircle2 size={12} className="text-emerald-400"/>}
                            {line.status === "failed" && <button onClick={() => processLine(line, 0)} className="p-1 hover:bg-rose-500/10 rounded text-rose-400"><RefreshCw size={12}/></button>}
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed">{line.text}</p>
                          {line.audioUrl && <audio src={line.audioUrl} className="mt-2 h-7 w-full" controls/>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost Estimation */}
              {estimatedCost !== null && estimatedCost > 0 && (
                <div className="mt-4 flex items-center gap-3 p-3 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
                  <Calculator size={14} className="text-amber-400 flex-shrink-0"/>
                  <span className="text-[10px] text-amber-400">
                    Ước tính: <span className="font-black">{estimatedCost.toLocaleString()}</span> credit
                    {totalCredits > 0 && (
                      <span className={`ml-2 ${estimatedCost > totalCredits ? 'text-rose-400 font-bold' : 'text-slate-500'}`}>
                        ({estimatedCost > totalCredits ? '⚠ Không đủ credit!' : `còn ${(totalCredits - estimatedCost).toLocaleString()} sau khi chạy`})
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <button onClick={generateTTS} disabled={isGenerating || keyCount === 0}
                    className={`flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 transition-all ${isGenerating || keyCount === 0 ? "bg-white/5 text-slate-600 cursor-not-allowed" : "btn-ombre text-white shadow-lg shadow-indigo-500/20 active:scale-[0.98]"}`}>
                    {isGenerating ? <><Loader2 className="animate-spin" size={20}/>Đang xử lý...</> : <><Play size={20} fill="currentColor"/>{isConversationMode ? "Tạo Hội Thoại" : "Bắt Đầu Chuyển Đổi"}</>}
                  </button>
                  {isConversationMode && conversationLines.some(l => l.status !== "idle") && !isGenerating && (
                    <button onClick={() => {
                      setNeedsVoiceRemapAfterSwitch(false);
                      setSwitchedFromProvider(null);
                      setConversationLines(prev => prev.map(l => ({ ...l, status: "idle" as const, audioUrl: undefined, error: undefined })));
                    }} className="p-4 bg-white/5 text-slate-500 rounded-2xl hover:bg-white/10 transition-all"><Trash2 size={20}/></button>
                  )}
                </div>
                {isConversationMode && needsVoiceRemapAfterSwitch && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[11px] text-amber-300">
                    Đã chuyển hệ từ {switchedFromProvider?.toUpperCase() || "hệ khác"}. Vui lòng chọn lại giọng cho các nhân vật chưa xong trước khi chạy.
                  </div>
                )}

                {isConversationMode && conversationLines.some(l => l.status === "failed") && (
                  <button onClick={retryFailedLines} disabled={isGenerating}
                    className="w-full py-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 hover:bg-rose-500/20 transition-all">
                    <RefreshCw size={18} className={isGenerating ? "animate-spin" : ""}/> Thử lại các câu lỗi
                  </button>
                )}

                {isConversationMode && conversationLines.some(l => l.status !== "idle" || l.audioUrl) && !isGenerating && (
                  <button
                    onClick={() => migrateToProvider("ai33")}
                    className="w-full py-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 rounded-2xl font-bold text-sm flex items-center justify-center gap-3 hover:bg-cyan-500/20 transition-all"
                  >
                    <Zap size={18}/> Chuyen tien trinh sang Giọng Nói AI (ai33)
                  </button>
                )}

                {/* Export Buttons */}
                {isConversationMode && conversationLines.every(l => l.status === "done") && conversationLines.length > 0 && (
                  <div className="space-y-3 p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <Clock size={14} className="text-slate-500"/>
                      <span className="text-[10px] font-bold text-slate-500">Khoảng nghỉ:</span>
                      <input type="number" value={pauseDuration} onChange={(e) => setPauseDuration(Number(e.target.value))}
                        className="w-16 bg-white/5 px-2 py-1 rounded-lg text-xs font-bold text-white focus:outline-none border border-white/10"/>
                      <span className="text-[9px] text-slate-600">ms</span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => mergeConversationAudio()} disabled={isMerging}
                        className="flex-1 py-3 bg-white/5 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-white/10 transition-all border border-white/5">
                        {isMerging ? <Loader2 className="animate-spin" size={16}/> : <Download size={16}/>} Merge Tổng
                      </button>
                      <button onClick={exportIndividualAudio} disabled={isExportingIndividual}
                        className="flex-1 py-3 btn-ombre text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg">
                        {isExportingIndividual ? <Loader2 className="animate-spin" size={16}/> : <Download size={16}/>} Audio Lẻ (.zip)
                      </button>
                      <button onClick={exportSRT} disabled={isExportingSRT}
                        className="flex-1 py-3 bg-white/5 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-white/10 transition-all border border-white/5">
                        {isExportingSRT ? <Loader2 className="animate-spin" size={16}/> : <Type size={16}/>} Xuất TXT
                      </button>
                    </div>

                    {mergedPreviewUrl && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-indigo-400">Audio đã sẵn sàng!</span>
                          <button onClick={downloadMergedFile} className="px-4 py-2 btn-ombre text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg"><Download size={14}/> Tải về</button>
                        </div>
                        <audio src={mergedPreviewUrl} controls className="w-full h-8"/>
                      </motion.div>
                    )}

                    <div className="space-y-2 pt-2 border-t border-white/5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">Xuất Timeline Nhân Vật (Mute người khác)</p>
                      <div className="flex flex-wrap gap-2">
                        {uniqueSpeakers.map(speaker => (
                          <button key={speaker} onClick={() => mergeConversationAudio(speaker)} disabled={isMerging}
                            className="px-3 py-1.5 bg-white/5 hover:btn-ombre hover:text-white rounded-lg text-[10px] font-bold text-slate-400 transition-all border border-white/5 flex items-center gap-1.5">
                            <User size={12}/> {speaker}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Single Mode Result */}
              {!isConversationMode && (currentJob || error) && (
                <div className="mt-6">
                  {error && (
                    <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-center gap-3 text-rose-400">
                      <AlertCircle size={18}/> <p className="text-xs font-medium">{error}</p>
                    </div>
                  )}
                  {currentJob && (
                    <div className="glass-card p-6 rounded-3xl border-white/5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${currentJob.status === 'done' ? 'bg-emerald-500' : 'bg-yellow-500 animate-pulse'}`}/>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Trạng thái: {currentJob.status}</span>
                        </div>
                        {currentJob.status === 'done' && <a href={currentJob.audio_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-white/5 hover:bg-white/10 rounded-full"><Download size={16}/></a>}
                      </div>
                      {currentJob.status === 'done' && currentJob.audio_url ? (
                        <audio controls className="w-full h-10"><source src={currentJob.audio_url} type="audio/mpeg"/>Trình duyệt không hỗ trợ.</audio>
                      ) : (
                        <div className="py-4 space-y-2">
                          <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <motion.div className="bg-indigo-500 h-full" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 15, ease: "linear" }}/>
                          </div>
                          <p className="text-center text-[10px] text-slate-600">Vui lòng đợi...</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Clone Voice Modal */}
      <AnimatePresence>
        {showCloneModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => !isCloning && setShowCloneModal(false)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="w-full max-w-lg glass-card rounded-[2.5rem] p-8 border-white/10 space-y-6">

              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-3"><Upload size={20} className="text-indigo-400"/>Nhân Bản Giọng Nói</h3>
                <button onClick={() => !isCloning && setShowCloneModal(false)} className="p-2 hover:bg-white/5 rounded-full text-slate-500"><X size={18}/></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Tên giọng</label>
                  <input type="text" value={cloneName} onChange={(e) => setCloneName(e.target.value)}
                    placeholder="VD: Giọng_NV_Minh"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-3 text-sm text-white outline-none focus:border-indigo-500/50 transition-all"/>
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2 block">File Audio (10s-5 phút, ≤20MB)</label>
                  <div className="relative">
                    <input type="file" accept="audio/mp3,audio/mpeg,audio/m4a,audio/wav,audio/ogg,audio/flac,.mp3,.m4a,.wav,.ogg,.flac"
                      onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"/>
                    <div className={`flex items-center justify-center gap-3 p-6 bg-white/[0.03] border-2 border-dashed rounded-2xl transition-all ${cloneFile ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-white/10 hover:border-white/20'}`}>
                      {cloneFile ? (
                        <div className="text-center">
                          <Mic size={24} className="text-indigo-400 mx-auto mb-2"/>
                          <p className="text-xs font-bold text-white">{cloneFile.name}</p>
                          <p className="text-[9px] text-slate-500">{(cloneFile.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <Upload size={24} className="text-slate-600 mx-auto mb-2"/>
                          <p className="text-xs text-slate-500">Kéo thả hoặc nhấn để chọn file audio</p>
                          <p className="text-[9px] text-slate-700 mt-1">MP3, WAV, M4A, OGG, FLAC</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => { setShowCloneModal(false); setCloneFile(null); setCloneName(''); }}
                  disabled={isCloning}
                  className="flex-1 py-3 bg-white/5 text-slate-400 rounded-2xl font-bold text-sm hover:bg-white/10 transition-all">
                  Hủy
                </button>
                <button onClick={cloneVoice} disabled={!cloneFile || isCloning}
                  className={`flex-1 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${!cloneFile || isCloning ? 'bg-white/5 text-slate-600 cursor-not-allowed' : 'btn-ombre text-white shadow-lg'}`}>
                  {isCloning ? <><Loader2 className="animate-spin" size={16}/>Đang nhân bản...</> : <><Mic size={16}/>Nhân Bản Giọng</>}
                </button>
              </div>

              <p className="text-[9px] text-slate-600 italic text-center">File audio cần rõ ràng, ít tạp âm. Thời lượng tối ưu: 30s - 2 phút.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
