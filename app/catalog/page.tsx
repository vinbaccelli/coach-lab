import WorkspaceChrome from '@/components/WorkspaceChrome';

export default function PublicCatalogPage() {
  return (
    <WorkspaceChrome pageLabel="Public catalog">
      <div style={{ padding: '20px 16px 40px', maxWidth: 800, margin: '0 auto' }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, opacity: 0.85 }}>
          Optional discoverability: showcase your programs, surface reviews from Trustpilot and Google, and link Instagram, YouTube, and your website. Coaches keep direct relationships and pricing — AngleMotion does not take a cut.
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
            Catalog layout, review embeds, and one-click review CTAs will ship in a follow-up. Nothing for you to configure here yet.
          </p>
        </div>
      </div>
    </WorkspaceChrome>
  );
}
