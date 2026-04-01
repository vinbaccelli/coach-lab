'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    // Detect iOS Safari (no beforeinstallprompt support)
    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as Navigator & { standalone?: boolean }).standalone;

    if (isIOS) {
      const dismissed = sessionStorage.getItem('pwa-ios-dismissed');
      if (!dismissed) setShowIOS(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowAndroid(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setShowAndroid(false);
    setDeferredPrompt(null);
  };

  const dismissIOS = () => {
    sessionStorage.setItem('pwa-ios-dismissed', '1');
    setShowIOS(false);
  };

  if (!showAndroid && !showIOS) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-32px)] max-w-sm"
    >
      <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3">
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 rounded-xl bg-[#007AFF] flex items-center justify-center text-white text-lg font-bold">
          CL
        </div>

        <div className="flex-1 min-w-0">
          {showAndroid ? (
            <>
              <p className="text-sm font-semibold text-gray-900 leading-snug">
                Install Coach Lab
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Add to your home screen for the best experience.
              </p>
              <button
                onClick={handleAndroidInstall}
                className="mt-2 bg-[#007AFF] text-white text-xs font-semibold px-4 py-1.5 rounded-lg"
              >
                Install
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-900 leading-snug">
                Add to Home Screen
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Tap <span className="font-medium">Share</span> ↑ then{' '}
                <span className="font-medium">"Add to Home Screen"</span> to install Coach Lab.
              </p>
            </>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={showIOS ? dismissIOS : () => setShowAndroid(false)}
          aria-label="Dismiss"
          className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
