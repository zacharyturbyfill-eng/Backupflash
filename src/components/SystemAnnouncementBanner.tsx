"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, X } from 'lucide-react';

type Props = {
  userId?: string;
};

type Announcement = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
};

const STORAGE_PREFIX = 'portal_announcement_hidden_';

export default function SystemAnnouncementBanner({ userId }: Props) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!userId) return;
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || '';
      if (!accessToken) return;

      const res = await fetch('/api/system/announcement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'get_latest', userId }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const next = json?.announcement || null;
      setAnnouncement(next);
      if (next?.id) {
        const seen = localStorage.getItem(`${STORAGE_PREFIX}${next.id}`) === '1';
        setHidden(seen);
      } else {
        setHidden(false);
      }
    };
    load();
  }, [userId]);

  const dismiss = () => {
    if (announcement?.id) {
      localStorage.setItem(`${STORAGE_PREFIX}${announcement.id}`, '1');
    }
    setHidden(true);
  };

  if (!announcement || hidden) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300 flex-shrink-0" />
          <div>
            <p className="text-[11px] uppercase tracking-widest font-black text-amber-300">
              {announcement.title || 'Thông báo hệ thống'}
            </p>
            <p className="text-sm mt-1 whitespace-pre-wrap">{announcement.content}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="p-1 rounded-lg hover:bg-white/10 text-amber-300"
          aria-label="Đóng thông báo"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

