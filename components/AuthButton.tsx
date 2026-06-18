'use client';

import React, { useState } from 'react';
import { LogIn, LogOut, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface AuthButtonProps {
  /** When true, show only the icon (compact toolbar rail) */
  iconOnly?: boolean;
}

export default function AuthButton({ iconOnly = false }: AuthButtonProps) {
  const { user, loading, signIn, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  if (loading) {
    return (
      <div style={{ ...btnBase(false), opacity: 0.4, cursor: 'default', justifyContent: 'center' }}>
        <User size={16} strokeWidth={2} />
      </div>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        style={btnBase(false)}
        onClick={() => void signIn()}
        title="Sign in with Google"
      >
        <span style={iconWrap}><LogIn size={16} strokeWidth={2} /></span>
        {iconOnly ? null : <span style={{ fontSize: 12, fontWeight: 600 }}>Sign in with Google</span>}
      </button>
    );
  }

  const initials = (user.user_metadata?.full_name as string | undefined)
    ?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?';
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        style={btnBase(showMenu)}
        onClick={() => setShowMenu((v) => !v)}
        title={user.email ?? 'Account'}
      >
        <span style={{ ...iconWrap, overflow: 'hidden', borderRadius: '50%', background: '#007AFF' }}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{initials}</span>
          )}
        </span>
        {iconOnly ? null : (
          <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
            {(user.user_metadata?.full_name as string | undefined) ?? user.email}
          </span>
        )}
      </button>

      {showMenu ? (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            zIndex: 1000,
            background: '#FFFFFF',
            border: '1px solid #D1D1D6',
            borderRadius: 12,
            padding: 8,
            minWidth: 180,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          }}
        >
          <div style={{ padding: '6px 10px 10px', borderBottom: '1px solid #F2F2F7', marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1D1D1F' }}>
              {(user.user_metadata?.full_name as string | undefined) ?? 'Signed in'}
            </div>
            <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 2 }}>{user.email}</div>
          </div>
          <button
            type="button"
            style={{ ...menuItem, color: '#FF3B30' }}
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              setShowMenu(false);
              await signOut();
              setSigningOut(false);
            }}
          >
            <LogOut size={14} strokeWidth={2} />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function btnBase(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
    border: active ? '1px solid #007AFF' : '1px solid #D1D1D6',
    background: active ? 'rgba(0,122,255,0.06)' : '#FFFFFF',
    color: '#1D1D1F', textAlign: 'left',
  };
}

const iconWrap: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, flexShrink: 0,
};

const menuItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: 13, fontWeight: 500, color: '#1D1D1F',
};
