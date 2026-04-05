'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SidebarSection({ title, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: 'var(--border)' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {title}
        <ChevronDown
          size={14}
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'var(--transition)',
          }}
        />
      </button>
      {open && <div style={{ padding: '8px 12px 12px' }}>{children}</div>}
    </div>
  );
}
