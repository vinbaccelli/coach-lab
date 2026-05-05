import WorkspaceChrome from '@/components/WorkspaceChrome';

export default function CoachProfilePage() {
  return (
    <WorkspaceChrome pageLabel="Coach profile">
      <div style={{ padding: '20px 16px 40px', maxWidth: 720, margin: '0 auto' }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, opacity: 0.85 }}>
          Your public coaching profile: services, session packages, prices, and links to pay (e.g. Stripe). This is the place clients understand what you offer before they book.
        </p>
        <div
          style={{
            padding: 20,
            borderRadius: 14,
            background: 'rgba(15, 15, 18, 0.65)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.68 }}>
            Form fields and image upload will go here. No configuration required from you tonight — this is a layout shell for the next build pass.
          </p>
        </div>
      </div>
    </WorkspaceChrome>
  );
}
