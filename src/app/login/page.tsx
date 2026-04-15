"use client";

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, User, ChevronRight, Sparkles, UserPlus, LogIn, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const [nickname, setNickname] = useState(''); // Chuyển từ email sang nickname
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const router = useRouter();

  // Mẹo: Chuyển nickname thành email ảo để Supabase hiểu
  const getFakeEmail = (nick: string) => `${nick.trim().toLowerCase()}@portal.local`;
  const getDeviceCode = () => {
    const existing = localStorage.getItem('storycraft_device_code');
    if (existing) return existing;
    const random = Math.random().toString(36).slice(2, 10).toUpperCase();
    const code = `DV-${random}`;
    localStorage.setItem('storycraft_device_code', code);
    return code;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const fakeEmail = getFakeEmail(nickname);

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: fakeEmail,
      password,
    });

    if (authError) {
      if (authError.message.includes('Email not confirmed')) {
        setError('Tài khoản chưa được kích hoạt.');
      } else if (authError.message.includes('Invalid login credentials')) {
        setError('Tên đăng nhập hoặc mật khẩu không đúng.');
      } else {
        setError(authError.message);
      }
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('status, id')
      .eq('id', data.user.id)
      .single();

    if (!profile) {
      setError('Hồ sơ của bạn không tồn tại.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (profile.status === 'pending') {
      setError('Vui lòng chờ Admin phê duyệt tài khoản.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (profile.status === 'blocked') {
      setError('Tài khoản đã bị khóa.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    const sessionId = crypto.randomUUID();
    localStorage.setItem('storycraft_session_id', sessionId);
    await supabase.from('profiles').update({ current_session_id: sessionId }).eq('id', data.user.id);
    try {
      const deviceCode = getDeviceCode();
      await fetch('/api/session/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          userId: data.user.id,
          sessionId,
          deviceCode,
        }),
      });
    } catch {}

    router.push('/dashboard/cleaner');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    // Kiểm tra định dạng nickname (không dấu, không cách)
    const nickRegex = /^[a-zA-Z0-9_]+$/;
    if (!nickRegex.test(nickname)) {
      setError('Nickname chỉ gồm chữ cái không dấu, số và dấu gạch dưới.');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      setLoading(false);
      return;
    }

    const fakeEmail = getFakeEmail(nickname);

    const { data, error: authError } = await supabase.auth.signUp({
      email: fakeEmail,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSuccess('Đăng ký thành công! Gửi yêu cầu tới Admin để được phê duyệt.');
    setLoading(false);
    setTimeout(() => {
      setIsRegistering(false);
      setSuccess('');
    }, 4000);
  };

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full -z-10"></div>
      
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md glass-card rounded-[3rem] p-12 border-white/5 shadow-2xl z-10">
        <div className="text-center mb-10">
           <div className="w-16 h-16 btn-ombre rounded-2xl flex items-center justify-center text-white text-3xl font-serif font-bold mx-auto mb-6 shadow-xl shadow-indigo-500/20">S</div>
           <h1 className="text-2xl font-bold text-white font-serif mb-1 tracking-tight">NovaForge AI Portal</h1>
           <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">{isRegistering ? 'Đăng ký Nickname mới' : 'Đăng nhập hệ thống'}</p>
        </div>

        <form onSubmit={isRegistering ? handleRegister : handleLogin} className="space-y-5">
          <div className="space-y-3">
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-indigo-400" size={18} />
              <input
                type="text"
                placeholder="Tên đăng nhập (không dấu)"
                className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-12 py-4 text-white placeholder:text-slate-700 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.toLowerCase())}
                required
              />
            </div>
            
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-indigo-400" size={18} />
              <input
                type="password"
                placeholder="Mật khẩu"
                className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-12 py-4 text-white placeholder:text-slate-700 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {isRegistering && (
              <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-indigo-400" size={18} />
                <input
                  type="password"
                  placeholder="Xác nhận mật khẩu"
                  className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-12 py-4 text-white placeholder:text-slate-700 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </motion.div>
            )}
          </div>

          <AnimatePresence>
            {error && <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-rose-500/10 border border-rose-500/10 rounded-2xl text-rose-500 text-xs font-bold flex items-center gap-2"><AlertCircle size={14}/>{error}</motion.div>}
            {success && <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-emerald-500/10 border border-emerald-500/10 rounded-2xl text-emerald-500 text-xs font-bold flex items-center gap-2"><CheckCircle2 size={14}/>{success}</motion.div>}
          </AnimatePresence>

          <button type="submit" disabled={loading} className="w-full btn-ombre py-4 rounded-2xl font-bold text-white shadow-xl shadow-indigo-500/10 flex items-center justify-center gap-3 active:scale-[0.98] transition-all">
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : (isRegistering ? 'Đăng ký ngay' : 'Đăng nhập')}
          </button>
        </form>

        <div className="mt-8 text-center pt-6 border-t border-white/5">
           <button onClick={() => setIsRegistering(!isRegistering)} className="text-slate-500 text-sm hover:text-indigo-400 transition-colors">
             {isRegistering ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Tạo nickname'}
           </button>
        </div>
      </motion.div>
    </div>
  );
}
