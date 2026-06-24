'use client';

import { useEffect, useRef, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const LS_IOS_KEY     = 'anglemotion-pwa-ios-dismissed';
const LS_ANDROID_KEY = 'anglemotion-pwa-android-dismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS]         = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as Navigator & { standalone?: boolean }).standalone;

    if (isIOS && !localStorage.getItem(LS_IOS_KEY)) {
      setShowIOS(true);
    }

    const handler = (e: Event) => {
      if (localStorage.getItem(LS_ANDROID_KEY)) return;
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowAndroid(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const el = bannerRef.current;
    if (!el || (!showAndroid && !showIOS)) {
      document.documentElement.style.removeProperty('--anglemotion-install-banner-height');
      return;
    }

    const apply = () => {
      const h = el.getBoundingClientRect().height;
      const gap = 12;
      document.documentElement.style.setProperty(
        '--anglemotion-install-banner-height',
        `${Math.ceil(h + gap)}px`,
      );
    };

    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', apply);
      document.documentElement.style.removeProperty('--anglemotion-install-banner-height');
    };
  }, [showAndroid, showIOS]);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
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
      ref={bannerRef}
      role="dialog"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        width: 'calc(100% - 32px)',
        maxWidth: '384px',
        bottom: 'calc(var(--anglemotion-banner-bottom, 100px) + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-[#007AFF] flex items-center justify-center text-white text-lg font-bold">
          CL
        </div>

        <div className="flex-1 min-w-0">
          {showAndroid ? (
            <>
              <p className="text-sm font-semibold text-gray-900 leading-snug">
                Install AngleMotion
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Add to your home screen for the best experience.
              </p>
              <button
                type="button"
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
                <span className="font-medium">&quot;Add to Home Screen&quot;</span> to install AngleMotion.
              </p>
            </>
          )}
        </div>

        <button
          type="button"
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
