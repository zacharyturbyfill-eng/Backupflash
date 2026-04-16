"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { 
  Users, Key, ChevronLeft, Save, ShieldCheck, 
  History, UserX, UserCheck, Activity, Globe, Cpu, Zap, X, Eye, FileText, Clock, AlertTriangle, Sparkles, AlertCircle, Trash2, LayoutDashboard, Video, Copy, Check, Volume2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AdminPage() {
  type UserTaskHistory = {
    id: string;
    type: 'clean' | 'prompt' | 'voice' | 'activity';
    created_at: string;
    provider?: string | null;
    char_count?: number | null;
    summary: string;
    input_preview?: string;
    full_text?: string;
  };

  const isMinimaxProvider = (provider?: string | null) =>
    typeof provider === 'string' && provider.startsWith('minimax');
  const isProxyProvider = (provider?: string | null) =>
    typeof provider === 'string' && provider.startsWith('proxy:');
  const isProxyConfigProvider = (provider?: string | null) =>
    provider === 'proxy_config:enabled';
  const isAi33Provider = (provider?: string | null) =>
    typeof provider === 'string' && provider.startsWith('ai33');
  const encodeMinimaxLabel = (label: string) => {
    const utf8 = encodeURIComponent(label).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16))
    );
    return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const decodeMinimaxLabel = (token: string) => {
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(padded);
      const encoded = Array.from(binary)
        .map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('');
      return decodeURIComponent(encoded);
    } catch {
      return '';
    }
  };
  const decodeAi33Label = (token: string) => {
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const binary = atob(padded);
      const encoded = Array.from(binary)
        .map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('');
      return decodeURIComponent(encoded);
    } catch {
      return '';
    }
  };
  const getMinimaxLabel = (provider?: string | null, fallbackIndex?: number) => {
    if (!provider || !provider.startsWith('minimax:')) {
      return typeof fallbackIndex === 'number' ? `Key #${fallbackIndex + 1}` : '';
    }
    const parts = provider.split(':');
    if (parts.length >= 3) {
      const decoded = decodeMinimaxLabel(parts[1]);
      if (decoded) return decoded;
    }
    return typeof fallbackIndex === 'number' ? `Key #${fallbackIndex + 1}` : '';
  };
  const makeMinimaxProviderId = (label?: string) => {
    const note = label?.trim();
    const encodedLabel = note ? encodeMinimaxLabel(note) : '';
    const idPrefix = encodedLabel ? `minimax:${encodedLabel}:` : 'minimax:';
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${idPrefix}${crypto.randomUUID()}`;
      }
    } catch {}
    return `${idPrefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  const makeAi33ProviderId = () => {
    const note = String(tempKeys.ai33Label || '').trim();
    const encodedLabel = note ? encodeMinimaxLabel(note) : '';
    const idPrefix = encodedLabel ? `ai33:${encodedLabel}:` : 'ai33:';
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${idPrefix}${crypto.randomUUID()}`;
      }
    } catch {}
    return `${idPrefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  const getAi33Label = (provider?: string | null, fallbackIndex?: number) => {
    if (!provider || !provider.startsWith('ai33:')) {
      return typeof fallbackIndex === 'number' ? `ai33 Key #${fallbackIndex + 1}` : '';
    }
    const parts = provider.split(':');
    if (parts.length >= 3) {
      const decoded = decodeAi33Label(parts[1]);
      if (decoded) return decoded;
    }
    return typeof fallbackIndex === 'number' ? `ai33 Key #${fallbackIndex + 1}` : '';
  };

  const [profiles, setProfiles] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [vaultKeys, setVaultKeys] = useState<any[]>([]);
  const [promptLogs, setPromptLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'vault' | 'prompts'>('users');
  
  const [editingKeysId, setEditingKeysId] = useState<string | null>(null);
  const [tempKeys, setTempKeys] = useState<any>({});
  const [minimaxSaveState, setMinimaxSaveState] = useState<{ kind: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [ai33SaveState, setAi33SaveState] = useState<{ kind: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxySaveState, setProxySaveState] = useState<{ kind: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [proxyLiveById, setProxyLiveById] = useState<Record<string, { live: boolean; egressIp?: string | null; ai84Status?: number; error?: string }>>({});
  
  const [selectedUserHistory, setSelectedUserHistory] = useState<UserTaskHistory[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [ai84UsageByUser, setAi84UsageByUser] = useState<Record<string, { total: number; today: number }>>({});
  const [textUsageByUser, setTextUsageByUser] = useState<Record<string, number>>({});
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});

  const [selectedPrompt, setSelectedPrompt] = useState<any>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);

  const [selectedUserIPs, setSelectedUserIPs] = useState<any[]>([]);
  const [showIPModal, setShowIPModal] = useState(false);
  const [latestDeviceByUser, setLatestDeviceByUser] = useState<Record<string, string>>({});
  const [announcementTitle, setAnnouncementTitle] = useState('Thông báo hệ thống');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  
  const router = useRouter();

  const getAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  };

  const fetchData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', session.user.id).single();
      if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        router.push('/login');
        return;
      }

      const { data: staffData } = await supabase.from('profiles').select('*').order('last_active_at', { ascending: false });
      setProfiles(staffData || []);

      const vaultResponse = await fetch('/api/admin/vault');
      const vaultData = await vaultResponse.json();
      if (!vaultResponse.ok) {
        setVaultKeys([]);
        setMinimaxSaveState({
          kind: 'error',
          message: vaultData.error || 'Không tải được kho khóa tổng.',
        });
      } else {
        setVaultKeys(vaultData.items || []);
        const proxyConfigRow = (vaultData.items || []).find((v: any) => isProxyConfigProvider(v.provider));
        setProxyEnabled(String(proxyConfigRow?.api_key || 'false').toLowerCase() === 'true');
      }

      const { data: usageData } = await supabase.from('usage_logs').select('*').order('created_at', { ascending: false }).limit(20);
      setLogs(usageData || []);
      const accessToken = session.access_token || await getAccessToken();
      const statsRes = await fetch('/api/admin/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'stats' }),
      });
      const statsJson = await statsRes.json();
      if (statsRes.ok) {
        setAi84UsageByUser(statsJson.ai84UsageByUser || {});
        setTextUsageByUser(statsJson.textUsageByUser || {});
        setLatestDeviceByUser(statsJson.latestDeviceByUser || {});
      } else {
        setAi84UsageByUser({});
        setTextUsageByUser({});
        setLatestDeviceByUser({});
        setMinimaxSaveState({
          kind: 'error',
          message: statsJson?.error || 'Không tải được thống kê ký tự nhân viên.',
        });
      }

      const { data: pData } = await supabase.from('prompt_history').select('*').order('created_at', { ascending: false }).limit(50);
      setPromptLogs(pData || []);
    } catch (error: any) {
      setMinimaxSaveState({
        kind: 'error',
        message: error?.message || 'Không thể tải dữ liệu admin.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [router]);

  const handleStatusUpdate = async (userId: string, status: string) => {
    await supabase.from('profiles').update({ status }).eq('id', userId);
    fetchData();
  };

  const saveVaultKey = async (provider: string, key: string) => {
    const res = await fetch('/api/admin/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert_provider', provider, api_key: key }),
    });
    const data = await res.json();
    if (!res.ok) alert("Lỗi lưu khóa: " + (data.error || 'Unknown error'));
    setEditingKeysId(null);
    fetchData();
  };

  const addMinimaxKey = async () => {
    let newKey = tempKeys.minimaxNew?.trim();
    if (!newKey) {
      const fromPrompt = prompt('Dán API key ai84 vào đây:');
      if (fromPrompt === null) return;
      newKey = fromPrompt.trim();
    }
    if (!newKey) {
      setMinimaxSaveState({ kind: 'error', message: 'Vui lòng nhập API Key ai84.' });
      alert('Vui lòng nhập API Key ai84.');
      return;
    }

    const label = tempKeys.minimaxLabel?.trim();
    const providerId = makeMinimaxProviderId(label);

    try {
      setMinimaxSaveState({ kind: 'loading', message: 'Đang lưu key ai84...' });

      const res = await fetch('/api/admin/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert_key', provider: providerId, api_key: newKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || 'Không thể thêm key ai84.';
        setMinimaxSaveState({ kind: 'error', message });
        alert('Lỗi thêm key ai84: ' + message);
        return;
      }

      setTempKeys((prev: any) => ({ ...prev, minimaxNew: '', minimaxLabel: '' }));
      await fetchData();
      setMinimaxSaveState({ kind: 'success', message: 'Đã thêm key ai84.' });
      alert('Đã thêm key ai84 thành công.');
    } catch (err: any) {
      const message = err?.message || 'Không thể thêm key ai84.';
      setMinimaxSaveState({
        kind: 'error',
        message,
      });
      alert('Lỗi thêm key ai84: ' + message);
    }
  };

  const addAi33Key = async () => {
    let newKey = tempKeys.ai33New?.trim();
    if (!newKey) {
      const fromPrompt = prompt('Dán API key ai33 vào đây:');
      if (fromPrompt === null) return;
      newKey = fromPrompt.trim();
    }
    if (!newKey) {
      setAi33SaveState({ kind: 'error', message: 'Vui lòng nhập API Key ai33.' });
      alert('Vui lòng nhập API Key ai33.');
      return;
    }

    try {
      setAi33SaveState({ kind: 'loading', message: 'Đang lưu key ai33...' });
      const res = await fetch('/api/admin/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert_key', provider: makeAi33ProviderId(), api_key: newKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || 'Không thể thêm key ai33.';
        setAi33SaveState({ kind: 'error', message });
        alert('Lỗi thêm key ai33: ' + message);
        return;
      }
      setTempKeys((prev: any) => ({ ...prev, ai33New: '', ai33Label: '' }));
      await fetchData();
      setAi33SaveState({ kind: 'success', message: 'Đã thêm key ai33.' });
      alert('Đã thêm key ai33 thành công.');
    } catch (err: any) {
      const message = err?.message || 'Không thể thêm key ai33.';
      setAi33SaveState({ kind: 'error', message });
      alert('Lỗi thêm key ai33: ' + message);
    }
  };

  const toggleProxyEnabled = async (enabled: boolean) => {
    setProxySaveState({ kind: 'loading', message: 'Đang cập nhật trạng thái proxy...' });
    try {
      const res = await fetch('/api/admin/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_proxy_enabled', enabled }),
      });
      const json = await res.json();
      if (!res.ok) {
        setProxySaveState({ kind: 'error', message: json.error || 'Không thể cập nhật trạng thái proxy.' });
        return;
      }
      setProxyEnabled(enabled);
      setProxySaveState({ kind: 'success', message: enabled ? 'Đã bật proxy cho ai84.' : 'Đã tắt proxy cho ai84.' });
      fetchData();
    } catch (error: any) {
      setProxySaveState({ kind: 'error', message: error?.message || 'Không thể cập nhật proxy.' });
    }
  };

  const addProxy = async () => {
    const proxyUrl = String(tempKeys.proxyNew || '').trim();
    if (!proxyUrl) {
      alert('Vui lòng nhập Proxy URL.');
      return;
    }
    setProxySaveState({ kind: 'loading', message: 'Đang thêm proxy...' });
    try {
      const res = await fetch('/api/admin/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_proxy', proxy_url: proxyUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        setProxySaveState({ kind: 'error', message: json.error || 'Không thể thêm proxy.' });
        return;
      }
      setTempKeys((prev: any) => ({ ...prev, proxyNew: '' }));
      setProxySaveState({ kind: 'success', message: 'Đã thêm proxy.' });
      fetchData();
    } catch (error: any) {
      setProxySaveState({ kind: 'error', message: error?.message || 'Không thể thêm proxy.' });
    }
  };

  const checkProxyLive = async (proxyId: string, proxyUrl: string) => {
    setProxyLiveById((prev) => ({ ...prev, [proxyId]: { live: false, error: 'Đang kiểm tra...' } }));
    try {
      const res = await fetch('/api/admin/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_proxy_live', proxy_url: proxyUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        setProxyLiveById((prev) => ({ ...prev, [proxyId]: { live: false, error: json.error || json.message || 'Proxy offline' } }));
        return;
      }
      setProxyLiveById((prev) => ({
        ...prev,
        [proxyId]: {
          live: true,
          egressIp: json.egressIp || null,
          ai84Status: json.ai84Status,
        },
      }));
    } catch (error: any) {
      setProxyLiveById((prev) => ({ ...prev, [proxyId]: { live: false, error: error?.message || 'Proxy check failed' } }));
    }
  };

  const viewUserWorkHistory = async (userId: string) => {
    const accessToken = await getAccessToken();
    const res = await fetch('/api/admin/analytics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: 'user_history', userId }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Không tải được lịch sử công việc.');
      return;
    }

    setSelectedUserHistory((data.history || []) as UserTaskHistory[]);
    setExpandedHistoryIds({});
    setShowHistoryModal(true);
  };

  const viewUserIPs = async (userId: string) => {
    const { data } = await supabase.from('login_history').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    setSelectedUserIPs(data || []);
    setShowIPModal(true);
  };

  const extractDeviceCode = (agent: string | null | undefined) => {
    const raw = String(agent || '');
    const match = raw.match(/device:([a-zA-Z0-9_-]+)/);
    return match?.[1] || 'N/A';
  };

  const publishAnnouncement = async () => {
    const content = announcementContent.trim();
    if (!content) {
      alert('Vui lòng nhập nội dung thông báo.');
      return;
    }
    setSendingAnnouncement(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch('/api/system/announcement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: 'publish',
          title: announcementTitle.trim() || 'Thông báo hệ thống',
          content,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || 'Không thể gửi thông báo.');
        return;
      }
      setAnnouncementContent('');
      alert('Đã gửi thông báo tới toàn bộ nhân viên.');
    } finally {
      setSendingAnnouncement(false);
    }
  };

  const formatTimeAgo = (date: string | null) => {
    if (!date) return 'Chưa hoạt động';
    const now = new Date();
    const past = new Date(date);
    const diff = Math.floor((now.getTime() - past.getTime()) / 1000);
    if (diff < 60) return 'Vừa mới đây';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    return past.toLocaleDateString();
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-[#020617]">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] p-6 md:p-10 font-sans text-slate-200 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center justify-between mb-12">
          <button onClick={() => router.push('/dashboard/cleaner')} className="group flex items-center text-slate-400 hover:text-white transition-all">
            <ChevronLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
            <span className="ml-2 font-bold font-serif uppercase tracking-widest text-[10px]">Trở lại Workspace</span>
          </button>
          
          <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
              <button onClick={() => setActiveTab('users')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${activeTab === 'users' ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                <Users size={14}/> Nhân Viên
              </button>
              <button onClick={() => setActiveTab('prompts')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${activeTab === 'prompts' ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                <Video size={14}/> Lịch Sử Prompt
              </button>
              <button onClick={() => setActiveTab('vault')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${activeTab === 'vault' ? 'btn-ombre text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                <Key size={14}/> Kho Khóa Tổng
              </button>
          </div>

          <div className="hidden md:flex btn-ombre px-6 py-2.5 rounded-full shadow-lg items-center gap-2">
            <ShieldCheck size={16} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Cổng Quản Trị Hệ Thống</span>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          <div className="xl:col-span-3">
            <AnimatePresence mode="wait">
              {activeTab === 'users' ? (
                <motion.section key="users" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="glass-card rounded-[2.5rem] overflow-hidden">
                   <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-white/5 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-white/5">
                        <tr>
                          <th className="px-8 py-6">Nickname</th>
                          <th className="px-8 py-6">IP / Hoạt động</th>
                          <th className="px-8 py-6">Kiểm soát</th>
                          <th className="px-8 py-6">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {profiles.map((p) => (
                          <tr key={p.id} className="hover:bg-white/[0.02] transition-all group text-xs">
                            <td className="px-8 py-6">
                               <div className="flex flex-col">
                                 <span className="text-sm font-bold text-slate-100">{p.email.split('@')[0]}</span>
                                 <span className={`text-[9px] font-black uppercase tracking-widest mt-1 ${p.status === 'approved' ? 'text-emerald-500' : 'text-rose-500'}`}>{p.status}</span>
                               </div>
                            </td>
                            <td className="px-8 py-6 text-[10px] font-mono">
                               <p className="text-indigo-400">{p.current_ip || '---'}</p>
                               <p className="text-slate-600 mt-1">{formatTimeAgo(p.last_active_at)}</p>
                               <p className="text-slate-500 mt-1">
                                 Thiết bị: <span className="text-cyan-300/70">{latestDeviceByUser[p.id] || 'N/A'}</span>
                               </p>
                               <p className="text-orange-400/80 mt-2">
                                 ai84 hôm nay: {(ai84UsageByUser[p.id]?.today || 0).toLocaleString()} ký tự
                               </p>
                               <p className="text-orange-300/60 mt-1">
                                 ai84 tổng: {(ai84UsageByUser[p.id]?.total || 0).toLocaleString()} ký tự
                               </p>
                               <p className="text-cyan-300/70 mt-1">
                                 Tổng ký tự task: {(textUsageByUser[p.id] || 0).toLocaleString()}
                               </p>
                            </td>
                            <td className="px-8 py-6">
                               <div className="flex gap-2">
                                 <button onClick={() => viewUserIPs(p.id)} className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-500 hover:text-white transition-all"><Globe size={14}/></button>
                                 <button onClick={() => viewUserWorkHistory(p.id)} className="p-2.5 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-xl text-indigo-400 transition-all border border-indigo-500/10"><FileText size={14}/></button>
                               </div>
                            </td>
                            <td className="px-8 py-6">
                               <div className="flex gap-2">
                                 <button onClick={() => handleStatusUpdate(p.id, p.status === 'blocked' ? 'approved' : 'blocked')} className={`p-2.5 rounded-xl transition-all ${p.status === 'blocked' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                   {p.status === 'blocked' ? <UserCheck size={16}/> : <UserX size={16}/>}
                                 </button>
                                 <button onClick={async () => { if(confirm("Xóa tài khoản?")) { await supabase.from('profiles').delete().eq('id', p.id); fetchData(); } }} className="p-2.5 bg-rose-500/5 text-rose-500/50 hover:text-rose-500 rounded-xl transition-all"><Trash2 size={16}/></button>
                               </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.section>
              ) : activeTab === 'prompts' ? (
                <motion.section key="prompts" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="glass-card rounded-[2.5rem] overflow-hidden">
                   <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-white/5 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-white/5">
                        <tr>
                          <th className="px-8 py-6">Nhân Viên / Thời gian</th>
                          <th className="px-8 py-6">Cấu Hình</th>
                          <th className="px-8 py-6">Nội dung</th>
                          <th className="px-8 py-6">Soi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {promptLogs.map((h) => (
                          <tr key={h.id} className="hover:bg-white/[0.02] transition-all group">
                            <td className="px-8 py-6">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-white">{h.user_email.split('@')[0]}</span>
                                <span className="text-[10px] text-slate-600 mt-1">{formatTimeAgo(h.created_at)}</span>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex flex-wrap gap-2">
                                <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 text-[8px] font-black uppercase rounded border border-indigo-500/20">{h.style}</span>
                                <span className="px-2 py-0.5 bg-white/5 text-slate-500 text-[8px] font-black uppercase rounded border border-white/10">{h.nationality}</span>
                              </div>
                            </td>
                            <td className="px-8 py-6 max-w-xs">
                              <p className="text-xs text-slate-500 italic line-clamp-1">"{h.input_transcript}"</p>
                            </td>
                            <td className="px-8 py-6">
                              <button onClick={() => { setSelectedPrompt(h); setShowPromptModal(true); }} className="p-3 bg-indigo-500/5 hover:bg-indigo-500/10 rounded-xl text-indigo-400 border border-indigo-500/10"><Eye size={16}/></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.section>
              ) : (
                <motion.section key="vault" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-6">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {['gemini', 'openai'].map((prov) => {
                        const vKey = vaultKeys.find(v => v.provider === prov);
                        return (
                          <div key={prov} className="glass-card rounded-[2.5rem] p-8 border-white/5 flex flex-col justify-between min-h-[250px] relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none">
                               {prov === 'gemini' ? <Cpu size={120}/> : <Zap size={120}/>}
                             </div>
                             <div>
                                <div className="flex items-center gap-3 mb-6">
                                   <div className={`p-3 rounded-2xl ${prov === 'gemini' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                      {prov === 'gemini' ? <Cpu size={24}/> : <Zap size={24}/>}
                                   </div>
                                   <div>
                                      <h4 className="text-xl font-bold text-white capitalize font-serif">{prov} Vault</h4>
                                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{vKey ? 'Key đã lưu' : 'Chưa có Key'}</p>
                                   </div>
                                </div>
                                <div className="p-4 bg-black/40 rounded-2xl border border-white/5 font-mono text-[10px] text-slate-500 mb-6 truncate">{vKey?.api_key || 'Dùng phao cứu sinh hệ thống'}</div>
                             </div>
                             <button
                               onClick={async () => {
                                 const current = vKey?.api_key || "";
                                 const next = prompt(`Nhập API key cho ${prov.toUpperCase()}:`, current);
                                 if (next === null) return;
                                 const key = next.trim();
                                 if (!key) {
                                   alert("API key không được để trống.");
                                   return;
                                 }
                                 await saveVaultKey(prov, key);
                               }}
                               className="w-full py-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition-all flex items-center justify-center gap-2"
                             >
                               <Save size={14}/> Cập Nhật Khóa
                             </button>
                          </div>
                        );
                      })}
                   </div>

                   {/* ===== ai84 MULTI-KEY VAULT ===== */}
                   <div className="glass-card rounded-[2.5rem] p-8 border-white/5 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Volume2 size={150}/></div>
                     <div className="flex items-center gap-3 mb-6">
                       <div className="p-3 rounded-2xl bg-orange-500/10 text-orange-400"><Volume2 size={24}/></div>
                       <div>
                         <h4 className="text-xl font-bold text-white font-serif">ai84 Voice Vault</h4>
                         <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                           {vaultKeys.filter(v => isMinimaxProvider(v.provider)).length} Key ai84 đã lưu — Hệ thống tự phân phối
                         </p>
                       </div>
                     </div>

                     {/* Danh sách keys hiện có */}
                     <div className="space-y-2 mb-6 max-h-[300px] overflow-y-auto scrollbar-hide">
                        {vaultKeys.filter(v => isMinimaxProvider(v.provider)).map((vk, idx) => (
                          <div key={`${vk.id}-${vk.provider}`} className="p-4 bg-black/40 rounded-2xl border border-white/5 group/item">
                           <div className="flex items-center justify-between mb-2">
                             <div className="flex items-center gap-3 overflow-hidden flex-1">
                               <div className="w-7 h-7 bg-orange-500/10 rounded-full flex items-center justify-center text-[10px] font-bold text-orange-400 flex-shrink-0">{idx + 1}</div>
                               <input
                                  defaultValue={getMinimaxLabel(vk.provider, idx)}
                                 placeholder="Nhập ghi chú (VD: Key_NV_Minh)..."
                                  onBlur={async (e) => {
                                    const newLabel = e.target.value.trim();
                                    const currentLabel = getMinimaxLabel(vk.provider, idx);
                                    if (newLabel !== currentLabel) {
                                       const res = await fetch('/api/admin/vault', {
                                         method: 'POST',
                                         headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ action: 'update_label', id: vk.id, label: newLabel }),
                                      });
                                      if (res.ok) fetchData();
                                    }
                                  }}
                                 className="flex-1 bg-transparent border-b border-transparent hover:border-white/10 focus:border-orange-500/50 text-sm font-bold text-white outline-none py-1 transition-all placeholder:text-slate-700 placeholder:text-xs"
                               />
                             </div>
                             <button
                                onClick={async () => {
                                  if (confirm("Xóa key này?")) {
                                    const res = await fetch('/api/admin/vault', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ action: 'delete_key', id: vk.id }),
                                    });
                                    if (res.ok) fetchData();
                                  }
                                }}
                               className="p-2 text-rose-500/30 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl opacity-0 group-hover/item:opacity-100 transition-all flex-shrink-0 ml-2"
                             ><Trash2 size={14}/></button>
                           </div>
                           <span className="text-[9px] font-mono text-slate-600 ml-10">{vk.api_key.substring(0, 12)}...{vk.api_key.substring(vk.api_key.length - 6)}</span>
                         </div>
                       ))}
                       {vaultKeys.filter(v => isMinimaxProvider(v.provider)).length === 0 && (
                         <p className="text-center py-6 text-xs text-slate-600 italic border-2 border-dashed border-white/5 rounded-2xl">Chưa có Key nào. Thêm Key ai84 để nhân viên bắt đầu sử dụng.</p>
                       )}
                     </div>

                     {/* Form thêm key mới */}
                     <div className="space-y-3">
                       <div className="flex gap-3">
                         <input
                           type="text"
                           placeholder="Ghi chú (VD: Key_NV_Minh)"
                           value={tempKeys.minimaxLabel || ''}
                           onChange={(e) => setTempKeys((prev: any) => ({ ...prev, minimaxLabel: e.target.value }))}
                           className="w-40 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-orange-500/50 transition-all"
                         />
                         <input
                           type="password"
                           placeholder="Dán API Key ai84 vào đây..."
                           value={tempKeys.minimaxNew || ''}
                           onChange={(e) => setTempKeys((prev: any) => ({ ...prev, minimaxNew: e.target.value }))}
                           className="flex-1 bg-black/40 border border-white/10 rounded-xl px-5 py-3 text-sm text-white outline-none focus:border-orange-500/50 transition-all font-mono"
                         />
                          <button
                            type="button"
                            onClick={addMinimaxKey}
                            disabled={minimaxSaveState.kind === 'loading'}
                            className="px-6 py-3 btn-ombre text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                           <Save size={14}/> {minimaxSaveState.kind === 'loading' ? 'Đang lưu...' : 'Thêm Key'}
                         </button>
                       </div>
                       {minimaxSaveState.kind !== 'idle' && (
                         <p className={`text-[10px] font-bold ${minimaxSaveState.kind === 'error' ? 'text-rose-400' : minimaxSaveState.kind === 'success' ? 'text-emerald-400' : 'text-slate-500'}`}>
                           {minimaxSaveState.message}
                         </p>
                       )}
                     </div>
                     <p className="text-[9px] text-slate-600 mt-3 italic">* Key ai84 (api.ai84.pro) dùng để truy cập dịch vụ TTS. Ghi chú sẽ hiển thị khi key lỗi để bạn biết cần thay.</p>
                   </div>

                   <div className="glass-card rounded-[2.5rem] p-8 border-white/5 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Volume2 size={150}/></div>
                     <div className="flex items-center gap-3 mb-6">
                       <div className="p-3 rounded-2xl bg-cyan-500/10 text-cyan-400"><Volume2 size={24}/></div>
                       <div>
                         <h4 className="text-xl font-bold text-white font-serif">ai33 Voice Vault</h4>
                         <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                           {vaultKeys.filter(v => isAi33Provider(v.provider)).length} Key ai33 đã lưu — Dùng cho module Giọng Nói AI (ai33)
                         </p>
                       </div>
                     </div>

                     <div className="space-y-2 mb-6 max-h-[220px] overflow-y-auto scrollbar-hide">
                       {vaultKeys.filter(v => isAi33Provider(v.provider)).map((vk, idx) => (
                         <div key={`${vk.id}-${vk.provider}`} className="p-4 bg-black/40 rounded-2xl border border-white/5 group/item">
                           <div className="flex items-center justify-between mb-2">
                             <div className="flex items-center gap-3 overflow-hidden flex-1">
                               <div className="w-7 h-7 bg-cyan-500/10 rounded-full flex items-center justify-center text-[10px] font-bold text-cyan-400 flex-shrink-0">{idx + 1}</div>
                               <input
                                 defaultValue={getAi33Label(vk.provider, idx)}
                                 placeholder="Nhập ghi chú (VD: Key_NV_Lan)..."
                                 onBlur={async (e) => {
                                   const newLabel = e.target.value.trim();
                                   const currentLabel = getAi33Label(vk.provider, idx);
                                   if (newLabel !== currentLabel) {
                                     const res = await fetch('/api/admin/vault', {
                                       method: 'POST',
                                       headers: { 'Content-Type': 'application/json' },
                                       body: JSON.stringify({ action: 'update_label', id: vk.id, label: newLabel }),
                                     });
                                     if (res.ok) fetchData();
                                   }
                                 }}
                                 className="flex-1 bg-transparent border-b border-transparent hover:border-white/10 focus:border-cyan-500/50 text-sm font-bold text-white outline-none py-1 transition-all placeholder:text-slate-700 placeholder:text-xs"
                               />
                             </div>
                             <button
                               onClick={async () => {
                                 if (confirm("Xóa key ai33 này?")) {
                                   const res = await fetch('/api/admin/vault', {
                                     method: 'POST',
                                     headers: { 'Content-Type': 'application/json' },
                                     body: JSON.stringify({ action: 'delete_key', id: vk.id }),
                                   });
                                   if (res.ok) fetchData();
                                 }
                               }}
                               className="p-2 text-rose-500/30 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl opacity-0 group-hover/item:opacity-100 transition-all flex-shrink-0 ml-2"
                             ><Trash2 size={14}/></button>
                           </div>
                           <span className="text-[9px] font-mono text-slate-600 ml-10">{vk.api_key.substring(0, 12)}...{vk.api_key.substring(vk.api_key.length - 6)}</span>
                         </div>
                       ))}
                       {vaultKeys.filter(v => isAi33Provider(v.provider)).length === 0 && (
                         <p className="text-center py-6 text-xs text-slate-600 italic border-2 border-dashed border-white/5 rounded-2xl">Chưa có Key ai33 nào.</p>
                       )}
                     </div>

                     <div className="space-y-3">
                       <div className="flex gap-3">
                         <input
                           type="text"
                           placeholder="Ghi chú (VD: Key_NV_Lan)"
                           value={tempKeys.ai33Label || ''}
                           onChange={(e) => setTempKeys((prev: any) => ({ ...prev, ai33Label: e.target.value }))}
                           className="w-40 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all"
                         />
                         <input
                           type="password"
                           placeholder="Dán API Key ai33 vào đây..."
                           value={tempKeys.ai33New || ''}
                           onChange={(e) => setTempKeys((prev: any) => ({ ...prev, ai33New: e.target.value }))}
                           className="flex-1 bg-black/40 border border-white/10 rounded-xl px-5 py-3 text-sm text-white outline-none focus:border-cyan-500/50 transition-all font-mono"
                         />
                         <button
                           type="button"
                           onClick={addAi33Key}
                           disabled={ai33SaveState.kind === 'loading'}
                           className="px-6 py-3 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/30 rounded-xl font-bold text-xs flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                         >
                           <Save size={14}/> {ai33SaveState.kind === 'loading' ? 'Đang lưu...' : 'Thêm Key'}
                         </button>
                       </div>
                       {ai33SaveState.kind !== 'idle' && (
                         <p className={`text-[10px] font-bold ${ai33SaveState.kind === 'error' ? 'text-rose-400' : ai33SaveState.kind === 'success' ? 'text-emerald-400' : 'text-slate-500'}`}>
                           {ai33SaveState.message}
                         </p>
                       )}
                     </div>
                     <p className="text-[9px] text-slate-600 mt-3 italic">* Key ai33 (api.ai33.pro) dùng cho module Giọng Nói AI (ai33).</p>
                   </div>

                   <div className="glass-card rounded-[2.5rem] p-8 border-white/5 relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Globe size={150}/></div>
                     <div className="flex items-center justify-between gap-3 mb-6">
                       <div className="flex items-center gap-3">
                         <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-400"><Globe size={24}/></div>
                         <div>
                           <h4 className="text-xl font-bold text-white font-serif">Proxy Manager (ai84)</h4>
                           <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                             {vaultKeys.filter(v => isProxyProvider(v.provider)).length} proxy | mapping cố định 2 key / 1 proxy
                           </p>
                         </div>
                       </div>
                       <button
                         type="button"
                         onClick={() => toggleProxyEnabled(!proxyEnabled)}
                         className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${proxyEnabled ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                       >
                         {proxyEnabled ? 'Proxy ON' : 'Proxy OFF'}
                       </button>
                     </div>

                     <div className="space-y-2 mb-6 max-h-[220px] overflow-y-auto scrollbar-hide">
                       {vaultKeys.filter(v => isProxyProvider(v.provider)).map((proxy, idx) => {
                         const live = proxyLiveById[proxy.id];
                         return (
                           <div key={proxy.id} className="p-4 bg-black/40 rounded-2xl border border-white/5">
                             <div className="flex items-center justify-between gap-3 mb-2">
                               <div className="flex items-center gap-3 min-w-0">
                                 <div className="w-7 h-7 bg-blue-500/10 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-400 flex-shrink-0">{idx + 1}</div>
                                 <div className="min-w-0">
                                   <p className="text-xs font-bold text-white truncate">{proxy.api_key}</p>
                                   <p className="text-[9px] text-slate-600">Phục vụ key #{idx * 2 + 1} và #{idx * 2 + 2}</p>
                                 </div>
                               </div>
                               <div className="flex items-center gap-2 flex-shrink-0">
                                 <button
                                   type="button"
                                   onClick={() => checkProxyLive(proxy.id, proxy.api_key)}
                                   className="px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[10px] font-bold uppercase tracking-widest"
                                 >
                                   Check Live
                                 </button>
                                 <button
                                   type="button"
                                   onClick={async () => {
                                     if (!confirm('Xóa proxy này?')) return;
                                     await fetch('/api/admin/vault', {
                                       method: 'POST',
                                       headers: { 'Content-Type': 'application/json' },
                                       body: JSON.stringify({ action: 'delete_key', id: proxy.id }),
                                     });
                                     fetchData();
                                   }}
                                   className="p-2 text-rose-500/40 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl"
                                 >
                                   <Trash2 size={14} />
                                 </button>
                               </div>
                             </div>
                             {live && (
                               <p className={`text-[10px] font-semibold ${live.live ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {live.error
                                   ? live.error
                                   : `LIVE | Egress IP: ${live.egressIp || 'N/A'} | ai84 health: ${live.ai84Status ?? 'N/A'}`}
                               </p>
                             )}
                           </div>
                         );
                       })}
                       {vaultKeys.filter(v => isProxyProvider(v.provider)).length === 0 && (
                         <p className="text-center py-6 text-xs text-slate-600 italic border-2 border-dashed border-white/5 rounded-2xl">Chưa có proxy nào.</p>
                       )}
                     </div>

                     <div className="flex gap-3">
                       <input
                         type="text"
                         placeholder="Proxy URL (vd: http://user:pass@host:port)"
                         value={tempKeys.proxyNew || ''}
                         onChange={(e) => setTempKeys((prev: any) => ({ ...prev, proxyNew: e.target.value }))}
                         className="flex-1 bg-black/40 border border-white/10 rounded-xl px-5 py-3 text-sm text-white outline-none focus:border-blue-500/50 transition-all font-mono"
                       />
                       <button
                         type="button"
                         onClick={addProxy}
                         className="px-6 py-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/30 rounded-xl font-bold text-xs flex items-center gap-2"
                       >
                         <Save size={14}/> Thêm Proxy
                       </button>
                     </div>
                     {proxySaveState.kind !== 'idle' && (
                       <p className={`text-[10px] mt-3 font-bold ${proxySaveState.kind === 'error' ? 'text-rose-400' : proxySaveState.kind === 'success' ? 'text-emerald-400' : 'text-slate-500'}`}>
                         {proxySaveState.message}
                       </p>
                     )}
                     <p className="text-[9px] text-slate-600 mt-3 italic">* Khi bật Proxy ON, mọi request ai84 sẽ fail-closed qua proxy (không gọi thẳng).</p>
                   </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-8">
            <section className="glass-card rounded-[2.5rem] overflow-hidden border-white/5 p-8 space-y-4">
              <div className="flex items-center gap-3 text-amber-400">
                <AlertTriangle size={20} />
                <h3 className="font-bold text-white uppercase tracking-widest text-[10px]">Thông Báo Hệ Thống</h3>
              </div>
              <input
                type="text"
                value={announcementTitle}
                onChange={(e) => setAnnouncementTitle(e.target.value)}
                placeholder="Tiêu đề thông báo"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none"
              />
              <textarea
                value={announcementContent}
                onChange={(e) => setAnnouncementContent(e.target.value)}
                placeholder="Nhập thông báo gửi toàn bộ nhân viên..."
                className="w-full min-h-28 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none resize-y"
              />
              <button
                type="button"
                onClick={publishAnnouncement}
                disabled={sendingAnnouncement}
                className="w-full py-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs border border-amber-500/30 disabled:opacity-40"
              >
                {sendingAnnouncement ? 'Đang gửi...' : 'Gửi Thông Báo Cho Toàn Bộ Nhân Viên'}
              </button>
            </section>
            <section className="glass-card rounded-[2.5rem] overflow-hidden border-white/5 p-8 space-y-6">
              <div className="flex items-center gap-3 text-indigo-400">
                 <Activity size={20} />
                 <h3 className="font-bold text-white uppercase tracking-widest text-[10px]">Usage Logs</h3>
              </div>
              <div className="space-y-4 max-h-[600px] overflow-y-auto scrollbar-hide">
                 {logs.map((log, idx) => (
                   <div key={idx} className="p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                      <p className="text-[10px] font-bold text-indigo-400 mb-1">{log.user_email.split('@')[0]}</p>
                      <p className="text-[11px] text-slate-300 line-clamp-1">{log.tool_name}</p>
                      <p className="text-[9px] text-slate-600 mt-2">{formatTimeAgo(log.created_at)}</p>
                   </div>
                 ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Modal Soi Prompt CHI TIẾT */}
      <AnimatePresence>
        {showPromptModal && selectedPrompt && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-[#020617]/95 backdrop-blur-3xl">
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="max-w-6xl w-full h-[85vh] glass-card border-white/10 rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col">
               <div className="p-10 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                  <div>
                    <h3 className="text-3xl font-bold text-white font-serif">Soi Visual Prompt</h3>
                    <p className="text-xs text-indigo-400 mt-1 uppercase tracking-widest font-black">{selectedPrompt.style} | {selectedPrompt.nationality} | {selectedPrompt.user_email}</p>
                  </div>
                  <button onClick={() => setShowPromptModal(false)} className="p-3 bg-white/5 hover:bg-rose-500/20 rounded-full transition-all text-slate-500 hover:text-rose-500"><X/></button>
               </div>
               <div className="flex-1 overflow-y-auto p-10 space-y-8 scrollbar-hide">
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Transcript gốc</h4>
                    <div className="p-8 bg-white/[0.02] border border-white/5 rounded-3xl text-slate-400 text-sm italic italic leading-relaxed whitespace-pre-wrap">{selectedPrompt.input_transcript}</div>
                  </div>
                  <div className="space-y-6">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400">Timeline Phân Cảnh Video</h4>
                    <div className="grid grid-cols-1 gap-4">
                       {selectedPrompt.results.map((res: any, idx: number) => (
                         <div key={idx} className="bg-white/[0.03] border border-white/5 rounded-3xl p-6 flex flex-col md:flex-row gap-6">
                            <div className="md:w-32 flex-shrink-0">
                               <span className="text-xs font-mono font-black text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-lg">{res.timestamp}</span>
                            </div>
                            <div className="flex-1 space-y-4">
                               <p className="text-xs text-slate-500 font-medium leading-relaxed">"{res.text}"</p>
                               <div className="bg-black/30 p-5 rounded-2xl border border-white/5 text-sm text-slate-100 leading-relaxed font-serif italic">{res.prompt}</div>
                            </div>
                         </div>
                       ))}
                    </div>
                  </div>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Re-use other modals (History/IP) if needed - logic remains in the fetchData and state */}
      <AnimatePresence>
        {showHistoryModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-[#020617]/95 backdrop-blur-2xl">
            {/* ... (Đoạn Modal Nhật ký làm sạch cũ) ... */}
            <motion.div className="max-w-4xl w-full h-[70vh] glass-card rounded-[3rem] p-10 relative">
               <button onClick={() => setShowHistoryModal(false)} className="absolute top-8 right-8 text-slate-500"><X/></button>
               <h3 className="text-2xl font-bold mb-8">Lịch sử công việc của nhân viên</h3>
               <div className="overflow-y-auto h-full pr-4 space-y-4 scrollbar-hide">
                  {selectedUserHistory.map((h) => (
                    <div key={h.id} className="p-6 bg-white/5 rounded-2xl border border-white/5 text-xs">
                       <p className="text-indigo-400 font-mono mb-2">
                         {formatTimeAgo(h.created_at)} | {h.type?.toUpperCase()} | {h.provider || 'n/a'}
                       </p>
                       <p className="text-slate-200 text-[11px] mb-2">{h.summary}</p>
                       {typeof h.char_count === 'number' && (
                         <p className="text-orange-400/80 mb-2">Ký tự: {h.char_count.toLocaleString()}</p>
                       )}
                       {(h.input_preview || h.full_text) && (
                         <div>
                           <p className={`text-slate-400 whitespace-pre-wrap ${expandedHistoryIds[h.id] ? '' : 'line-clamp-3'}`}>
                             "{expandedHistoryIds[h.id] ? (h.full_text || h.input_preview) : h.input_preview}"
                           </p>
                           {h.full_text && h.full_text.length > (h.input_preview || '').length && (
                             <button
                               type="button"
                               onClick={() =>
                                 setExpandedHistoryIds((prev) => ({ ...prev, [h.id]: !prev[h.id] }))
                               }
                               className="mt-2 text-[10px] font-bold uppercase tracking-widest text-indigo-300 hover:text-indigo-200"
                             >
                               {expandedHistoryIds[h.id] ? 'Thu gọn' : 'Xem thêm'}
                             </button>
                           )}
                         </div>
                       )}
                    </div>
                  ))}
                  {selectedUserHistory.length === 0 && (
                    <p className="text-slate-500 text-xs italic">Chưa có lịch sử công việc.</p>
                  )}
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showIPModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-[#020617]/95 backdrop-blur-2xl">
            <motion.div className="max-w-md w-full glass-card rounded-[3rem] p-10 relative">
               <button onClick={() => setShowIPModal(false)} className="absolute top-8 right-8 text-slate-500"><X/></button>
               <h3 className="text-2xl font-bold mb-8">Lịch sử IP</h3>
               <div className="space-y-4">
                  {selectedUserIPs.map((ip, i) => (
                    <div key={i} className="p-4 bg-white/5 rounded-xl">
                       <div className="flex justify-between items-center">
                         <span className="font-mono text-indigo-400">{ip.ip_address}</span>
                         <span className="text-slate-500 text-[10px]">{formatTimeAgo(ip.created_at)}</span>
                       </div>
                       <p className="text-[10px] text-cyan-300/70 mt-2">
                         Mã thiết bị: {extractDeviceCode(ip.user_agent)}
                       </p>
                    </div>
                  ))}
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
