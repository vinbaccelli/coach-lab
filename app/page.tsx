'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Home() {
  const router = useRouter();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone;
    if (isIOS && !isStandalone) setShowIOSHint(true);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #35679A 0%, #1a3a5c 100%)' }}>
      <div className="text-center max-w-lg">
        <div className="mb-8 flex justify-center">
          <div className="w-24 h-24 rounded-3xl bg-white/20 flex items-center justify-center">
            <span className="text-5xl font-bold text-white">C</span>
          </div>
        </div>

        <h1 className="text-5xl font-bold text-white mb-3">Coach Lab</h1>
        <p className="text-xl text-white/80 mb-2">Sports Video Analysis</p>
        <p className="text-sm text-white/60 mb-10">Frame-by-frame analysis · Drawing tools · Pose estimation</p>

        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { icon: '🎬', label: 'Video Analysis' },
            { icon: '✏️', label: 'Draw & Annotate' },
            { icon: '🏃', label: 'Pose Detection' },
          ].map((f) => (
            <div key={f.label} className="bg-white/10 rounded-2xl p-4">
              <div className="text-3xl mb-2">{f.icon}</div>
              <div className="text-xs text-white/70 font-medium">{f.label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/analyze')}
          className="w-full py-4 rounded-2xl bg-white text-[#35679A] font-semibold text-lg shadow-lg hover:bg-white/90 active:scale-95 transition-all mb-4"
        >
          Start Analysis
        </button>

        {deferredPrompt && (
          <button
            onClick={handleInstall}
            className="w-full py-3 rounded-2xl border border-white/40 text-white font-medium text-sm hover:bg-white/10 transition-all mb-4"
          >
            📲 Install App
          </button>
        )}

        {showIOSHint && (
          <p className="text-white/60 text-sm">
            Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install
          </p>
        )}
      </div>
    </main>
  );
}
