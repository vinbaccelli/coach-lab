import WorkspaceChrome from '@/components/WorkspaceChrome';

export default function BillingPage() {
  return (
    <WorkspaceChrome pageLabel="Subscription">
      <div style={{ padding: '20px 16px 40px', maxWidth: 640, margin: '0 auto' }}>
        <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, opacity: 0.85 }}>
          AngleMotion is planned at <strong>€15/month</strong> or <strong>€120/year</strong> via Stripe. Checkout, customer portal, and webhook-driven access will connect here.
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
            When you add Stripe keys to the project, this page will show plan status and a button to manage billing. Until then, the app remains usable for development.
          </p>
        </div>
      </div>
    </WorkspaceChrome>
  );
}
