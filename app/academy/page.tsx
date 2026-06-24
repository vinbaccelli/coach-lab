import WorkspaceChrome from '@/components/WorkspaceChrome';
import AngleMotionAcademy from '@/components/CoachLabAcademy';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export default function AcademyPage() {
  return (
    <WorkspaceChrome>
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          padding: '24px 16px calc(80px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 700,
            color: '#007AFF',
            textDecoration: 'none',
            marginBottom: 16,
          }}
        >
          <ChevronLeft size={18} />
          Control Panel
        </Link>
        <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 900, color: '#111827' }}>
          AngleMotion Academy
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: '#6B7280', lineHeight: 1.5 }}>
          How to prepare, store, and import videos for V1 — upload files into AngleMotion after using
          YouTube, Drive, or your camera roll.
        </p>
        <AngleMotionAcademy />
      </div>
    </WorkspaceChrome>
  );
}
