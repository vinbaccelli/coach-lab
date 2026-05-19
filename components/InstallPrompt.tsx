'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const LS_IOS_KEY     = 'coachlab-pwa-ios-dismissed';
const LS_ANDROID_KEY = 'coachlab-pwa-android-dismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS]         = useState(false);

  useEffect(() => {
    // iOS Safari: no beforeinstallprompt; guide the user manually.
    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as Navigator & { standalone?: boolean }).standalone;

    if (isIOS && !localStorage.getItem(LS_IOS_KEY)) {
      setShowIOS(true);
    }

    // Android/Chrome: capture the native install prompt.
    const handler = (e: Event) => {
      if (localStorage.getItem(LS_ANDROID_KEY)) return;
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
    const { outcome } = await deferredPrompt.userChoice;
    // Persist regardless of outcome so the banner never re-appears.
    localStorage.setItem(LS_ANDROID_KEY, outcome);
    setShowAndroid(false);
    setDeferredPrompt(null);
  };

  const dismissAndroid = () => {
    localStorage.setItem(LS_ANDROID_KEY, 'dismissed');
    setShowAndroid(false);
  };

  const dismissIOS = () => {
    localStorage.setItem(LS_IOS_KEY, '1');
    setShowIOS(false);
  };

  if (!showAndroid && !showIOS) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        width: 'calc(100% - 32px)',
        maxWidth: '384px',
        // --coachlab-banner-bottom is set by app/analysis/page.tsx via a
        // useEffect that mirrors toolbarBottomReservePx.  That value is
        // measured from the ResizeObserver on the playback dock and already
        // includes env(safe-area-inset-bottom) via the dock's padding.
        // Fallback of 100px keeps the banner visible on other pages where
        // the CSS variable is not set.
        bottom: 'var(--coachlab-banner-bottom, 100px)',
      }}
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
          onClick={showIOS ? dismissIOS : dismissAndroid}
          aria-label="Dismiss"
          className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
