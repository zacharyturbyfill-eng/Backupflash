"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { 
  Users, Key, ChevronLeft, Save, ShieldCheck, 
  History, UserX, UserCheck, Activity, Globe, Cpu, Zap, X, Eye, FileText, Clock, AlertTriangle, Sparkles, AlertCircle, Trash2, LayoutDashboard, Video, Copy, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AdminPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [vaultKeys, setVaultKeys] = useState<any[]>([]);
  const [promptLogs, setPromptLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'vault' | 'prompts'>('users');
  
  const [editingKeysId, setEditingKeysId] = useState<string | null>(null);
  const [tempKeys, setTempKeys] = useState<any>({});
  
  const [selectedUserHistory, setSelectedUserHistory] = useState<any[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const [selectedPrompt, setSelectedPrompt] = useState<any>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);

  const [selectedUserIPs, setSelectedUserIPs] = useState<any[]>([]);
  const [showIPModal, setShowIPModal] = useState(false);
  
  const router = useRouter();

  const fetchData = async () => {
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

    const { data: vaultData } = await supabase.from('api_vault').select('*');
    setVaultKeys(vaultData || []);

    const { data: usageData } = await supabase.from('usage_logs').select('*').order('created_at', { ascending: false }).limit(20);
    setLogs(usageData || []);

    const { data: pData } = await supabase.from('prompt_history').select('*').order('created_at', { ascending: false }).limit(50);
    setPromptLogs(pData || []);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [router]);

  const handleStatusUpdate = async (userId: string, status: string) => {
    await supabase.from('profiles').update({ status }).eq('id', userId);
    fetchData();
  };

  const saveVaultKey = async (provider: string, key: string) => {
    const { error } = await supabase.from('api_vault').upsert({ provider, api_key: key }, { onConflict: 'provider' });
    if (error) alert("Lỗi lưu khóa: " + error.message);
    setEditingKeysId(null);
    fetchData();
  };

  const viewUserWorkHistory = async (userId: string) => {
    const { data } = await supabase.from('cleaning_history').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    setSelectedUserHistory(data || []);
    setShowHistoryModal(true);
  };

  const viewUserIPs = async (userId: string) => {
    const { data } = await supabase.from('login_history').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    setSelectedUserIPs(data || []);
    setShowIPModal(true);
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
                             <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:scale-110 transition-transform duration-700">
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
                             <button onClick={() => { setEditingKeysId(prov); setTempKeys({ key: vKey?.api_key || "" }); }} className="w-full py-4 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition-all flex items-center justify-center gap-2">
                               <Save size={14}/> Cập Nhật Khóa
                             </button>
                          </div>
                        );
                      })}
                   </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-8">
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
               <h3 className="text-2xl font-bold mb-8">Lịch sử làm sạch của nhân viên</h3>
               <div className="overflow-y-auto h-full pr-4 space-y-4 scrollbar-hide">
                  {selectedUserHistory.map((h, i) => (
                    <div key={i} className="p-6 bg-white/5 rounded-2xl border border-white/5 text-xs">
                       <p className="text-indigo-400 font-mono mb-2">{formatTimeAgo(h.created_at)} | {h.provider}</p>
                       <p className="text-slate-300 line-clamp-3">"{h.output_content.slice(0, 200)}..."</p>
                    </div>
                  ))}
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
                    <div key={i} className="p-4 bg-white/5 rounded-xl flex justify-between">
                       <span className="font-mono text-indigo-400">{ip.ip_address}</span>
                       <span className="text-slate-500 text-[10px]">{formatTimeAgo(ip.created_at)}</span>
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
