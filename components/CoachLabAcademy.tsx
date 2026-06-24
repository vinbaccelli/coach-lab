'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Trash2, Upload, ExternalLink } from 'lucide-react';
import AcademyForum from '@/components/academy/AcademyForum';
import { isAdmin } from '@/lib/admin';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { uploadDataUrl } from '@/lib/supabase/storage';

interface AcademyResource {
  id: string;
  title: string;
  description: string;
  category: string;
  pdf_url: string;
  sort_order: number;
}

const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 800, color: '#1A1A1A', margin: '0 0 8px',
};

const body: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.55, color: '#4B5563', margin: '0 0 14px',
};

const list: React.CSSProperties = {
  margin: '0 0 14px', paddingLeft: 18, fontSize: 12, lineHeight: 1.55, color: '#4B5563',
};

export default function AngleMotionAcademy() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [resources, setResources] = useState<AcademyResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadCategory, setUploadCategory] = useState('guide');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    sb?.auth.getUser().then(r => setUserEmail(r.data?.user?.email ?? null));
    fetch('/api/academy').then(r => r.json()).then(d => {
      setResources(d.resources ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const admin = isAdmin(userEmail);

  const handleUploadPdf = useCallback(async (file: File) => {
    if (!file || !uploadTitle.trim()) return;
    setUploading(true);
    try {
      const sb = createSupabaseBrowserClient();
      const userRes = await sb?.auth.getUser();
      const userId = userRes?.data?.user?.id;
      if (!sb || !userId) return;

      const filename = `academy/${Date.now()}-${file.name}`;
      const arrayBuf = await file.arrayBuffer();
      const blob = new Blob([arrayBuf], { type: file.type || 'application/pdf' });

      const { error: upErr } = await sb.storage.from('analysis-screenshots').upload(filename, blob, {
        contentType: file.type || 'application/pdf', upsert: true,
      });
      if (upErr) { console.error('Upload error:', upErr); return; }

      const { data: signed } = await sb.storage.from('analysis-screenshots').createSignedUrl(filename, 60 * 60 * 24 * 365);
      const pdfUrl = signed?.signedUrl ?? '';
      if (!pdfUrl) return;

      const res = await fetch('/api/academy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: uploadTitle.trim(), description: uploadDesc.trim(), category: uploadCategory, pdf_url: pdfUrl }),
      });
      if (res.ok) {
        const d = await res.json();
        setResources(prev => [...prev, d.resource]);
        setUploadTitle('');
        setUploadDesc('');
        setShowUpload(false);
      }
    } finally {
      setUploading(false);
    }
  }, [uploadTitle, uploadDesc, uploadCategory]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch('/api/academy', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setResources(prev => prev.filter(r => r.id !== id));
  }, []);

  const guides = resources.filter(r => r.category === 'guide');
  const ebooks = resources.filter(r => r.category === 'ebook');
  const drills = resources.filter(r => r.category === 'drill');

  return (
    <div style={{ padding: '4px 2px 12px' }}>
      {/* Admin upload button */}
      {admin && (
        <div style={{ marginBottom: 16 }}>
          {!showUpload ? (
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                borderRadius: 10, border: '1px solid #007AFF', background: 'rgba(0,122,255,0.06)',
                color: '#007AFF', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%',
              }}
            >
              <Plus size={16} /> Add PDF resource
            </button>
          ) : (
            <div style={{
              padding: 16, borderRadius: 12, border: '1px solid #E5E5EA', background: '#FAFAFA',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <input
                type="text" placeholder="Title" value={uploadTitle}
                onChange={e => setUploadTitle(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D1D6', fontSize: 13 }}
              />
              <input
                type="text" placeholder="Description (optional)" value={uploadDesc}
                onChange={e => setUploadDesc(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D1D6', fontSize: 13 }}
              />
              <select
                value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D1D6', fontSize: 13 }}
              >
                <option value="guide">Guide</option>
                <option value="ebook">eBook</option>
                <option value="drill">Drill / Exercise</option>
              </select>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
                borderRadius: 10, border: '1px dashed #D1D1D6', background: '#FFF',
                color: '#6E6E73', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}>
                <Upload size={16} />
                {uploading ? 'Uploading…' : 'Choose PDF file'}
                <input
                  type="file" accept=".pdf" style={{ display: 'none' }}
                  disabled={uploading || !uploadTitle.trim()}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadPdf(f); }}
                />
              </label>
              <button type="button" onClick={() => setShowUpload(false)}
                style={{ fontSize: 12, color: '#6E6E73', background: 'none', border: 'none', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* PDF Resources from DB */}
      {!loading && resources.length > 0 && (
        <>
          {ebooks.length > 0 && (
            <>
              <h3 style={sectionTitle}>eBooks</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {ebooks.map(r => (
                  <ResourceCard key={r.id} resource={r} admin={admin} onDelete={handleDelete} />
                ))}
              </div>
            </>
          )}
          {guides.length > 0 && (
            <>
              <h3 style={sectionTitle}>Guides</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {guides.map(r => (
                  <ResourceCard key={r.id} resource={r} admin={admin} onDelete={handleDelete} />
                ))}
              </div>
            </>
          )}
          {drills.length > 0 && (
            <>
              <h3 style={sectionTitle}>Drills &amp; Exercises</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {drills.map(r => (
                  <ResourceCard key={r.id} resource={r} admin={admin} onDelete={handleDelete} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {loading && <p style={body}>Loading resources…</p>}

      {/* Q&A Forum */}
      <AcademyForum />
    </div>
  );
}

function ResourceCard({ resource, admin, onDelete }: { resource: AcademyResource; admin: boolean; onDelete: (id: string) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      borderRadius: 10, border: '1px solid #E5E5EA', background: '#FFF',
    }}>
      <FileText size={20} style={{ color: '#FF3B30', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1D1D1F' }}>{resource.title}</div>
        {resource.description && (
          <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 2 }}>{resource.description}</div>
        )}
      </div>
      <a
        href={resource.pdf_url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
          borderRadius: 6, background: '#007AFF', color: '#fff',
          fontSize: 11, fontWeight: 600, textDecoration: 'none', flexShrink: 0,
        }}
      >
        <ExternalLink size={12} /> Open
      </a>
      {admin && (
        <button
          type="button"
          onClick={() => onDelete(resource.id)}
          style={{ background: 'none', border: 'none', color: '#FF3B30', cursor: 'pointer', padding: 4, flexShrink: 0 }}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
