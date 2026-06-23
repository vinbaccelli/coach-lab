'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, ExternalLink, Save, Eye, Upload, GripVertical,
  Instagram, Youtube, Globe, Mail, MessageCircle, Star,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

interface ServiceItem {
  id: string;
  title: string;
  description: string;
  price: string;
  cta_label: string;
  cta_url: string;
}

interface LinkItem {
  id: string;
  label: string;
  url: string;
  icon: string;
}

const ICON_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'globe', label: 'Website' },
  { value: 'mail', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'trustpilot', label: 'Trustpilot' },
  { value: 'google', label: 'Google Reviews' },
  { value: 'external', label: 'Other' },
];

const COLOR_PRESETS = ['#007AFF', '#FF3B30', '#34C759', '#FF9500', '#AF52DE', '#5856D6', '#FF2D55', '#00C7BE'];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid #D1D1D6', fontSize: 14, background: '#FFF',
  color: '#1D1D1F', outline: 'none', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#6E6E73', marginBottom: 4, display: 'block',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 24, padding: 16, borderRadius: 14,
  background: '#FFF', border: '1px solid #E5E5EA',
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function CoachProfileEditor() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [accentColor, setAccentColor] = useState('#007AFF');
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    fetch('/api/coach-profile')
      .then(r => r.json())
      .then(d => {
        if (d.profile) {
          setSlug(d.profile.slug ?? '');
          setName(d.profile.name ?? '');
          setTagline(d.profile.tagline ?? '');
          setBio(d.profile.bio ?? '');
          setAvatarUrl(d.profile.avatar_url ?? '');
          setAccentColor(d.profile.accent_color ?? '#007AFF');
          setServices((d.services ?? []).map((s: any) => ({
            id: s.id, title: s.title, description: s.description ?? '',
            price: s.price ?? '', cta_label: s.cta_label ?? '', cta_url: s.cta_url ?? '',
          })));
          setLinks((d.links ?? []).map((l: any) => ({
            id: l.id, label: l.label, url: l.url, icon: l.icon ?? 'external',
          })));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleAvatarUpload = useCallback(async (file: File) => {
    if (!supabase) return;
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const filename = `avatars/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('coach-avatars')
        .upload(filename, file, { contentType: file.type, upsert: true });
      if (upErr) {
        const { error: upErr2 } = await supabase.storage
          .from('analysis-screenshots')
          .upload(`coach-avatars/${filename}`, file, { contentType: file.type, upsert: true });
        if (upErr2) { console.error('Avatar upload failed:', upErr2); return; }
        const { data: signed } = await supabase.storage
          .from('analysis-screenshots')
          .createSignedUrl(`coach-avatars/${filename}`, 60 * 60 * 24 * 365);
        if (signed?.signedUrl) setAvatarUrl(signed.signedUrl);
        return;
      }
      const { data } = supabase.storage.from('coach-avatars').getPublicUrl(filename);
      if (data?.publicUrl) setAvatarUrl(data.publicUrl);
    } finally {
      setUploadingAvatar(false);
    }
  }, [supabase]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/coach-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { slug, name, tagline, bio, avatar_url: avatarUrl || null, accent_color: accentColor },
          services: services.map((s, i) => ({ ...s, sort_order: i })),
          links: links.map((l, i) => ({ ...l, sort_order: i })),
        }),
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [slug, name, tagline, bio, avatarUrl, accentColor, services, links]);

  const addService = () => setServices(prev => [...prev, { id: uid(), title: '', description: '', price: '', cta_label: '', cta_url: '' }]);
  const removeService = (id: string) => setServices(prev => prev.filter(s => s.id !== id));
  const updateService = (id: string, field: keyof ServiceItem, value: string) =>
    setServices(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));

  const addLink = () => setLinks(prev => [...prev, { id: uid(), label: '', url: '', icon: 'external' }]);
  const removeLink = (id: string) => setLinks(prev => prev.filter(l => l.id !== id));
  const updateLink = (id: string, field: keyof LinkItem, value: string) =>
    setLinks(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));

  if (loading) {
    return <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, fontSize: 14 }}>Loading profile…</div>;
  }

  return (
    <div style={{ padding: '20px 16px 60px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Edit Your Profile</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {slug && (
            <a
              href={`/coach/${slug}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
                borderRadius: 10, border: '1px solid #D1D1D6', background: '#FFF',
                color: '#007AFF', fontSize: 13, fontWeight: 600, textDecoration: 'none',
              }}
            >
              <Eye size={15} /> Preview
            </a>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim() || !slug.trim()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px',
              borderRadius: 10, border: 'none', background: saving ? '#8E8E93' : '#007AFF',
              color: '#FFF', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            <Save size={15} /> {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>

      {/* Basic info */}
      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>Basic Information</h3>

        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
            background: `linear-gradient(135deg, ${accentColor} 0%, #5856D6 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 900, color: '#fff',
          }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : name.charAt(0) || '?'}
          </div>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 10, border: '1px dashed #D1D1D6', background: '#FAFAFA',
            fontSize: 13, fontWeight: 500, color: '#6E6E73', cursor: 'pointer',
          }}>
            <Upload size={15} />
            {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
            <input
              type="file" accept="image/*" style={{ display: 'none' }}
              disabled={uploadingAvatar}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>Display Name *</label>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Your Name" />
          </div>
          <div>
            <label style={labelStyle}>URL Slug *</label>
            <input style={inputStyle} value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="your-slug" />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Tagline</label>
          <input style={inputStyle} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Tennis Coach · City · Specialty" />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Bio (HTML supported)</label>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
            value={bio} onChange={e => setBio(e.target.value)}
            placeholder="Write about yourself, your coaching philosophy…"
          />
        </div>

        <div>
          <label style={labelStyle}>Accent Color</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {COLOR_PRESETS.map(c => (
              <button
                key={c} type="button"
                onClick={() => setAccentColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', border: accentColor === c ? '3px solid #1D1D1F' : '2px solid #E5E5EA',
                  background: c, cursor: 'pointer', padding: 0,
                }}
              />
            ))}
            <input
              type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)}
              style={{ width: 28, height: 28, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4 }}
            />
          </div>
        </div>
      </div>

      {/* Services */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Services</h3>
          <button
            type="button" onClick={addService}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px',
              borderRadius: 8, border: '1px solid #007AFF', background: 'transparent',
              color: '#007AFF', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Add Service
          </button>
        </div>

        {services.map((svc, idx) => (
          <div key={svc.id} style={{
            padding: 14, borderRadius: 12, border: '1px solid #E5E5EA', background: '#FAFAFA',
            marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8E8E93' }}>
                <GripVertical size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Service {idx + 1}
              </span>
              <button type="button" onClick={() => removeService(svc.id)}
                style={{ background: 'none', border: 'none', color: '#FF3B30', cursor: 'pointer', padding: 4 }}>
                <Trash2 size={14} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
              <input style={inputStyle} value={svc.title} onChange={e => updateService(svc.id, 'title', e.target.value)} placeholder="Service title" />
              <input style={{ ...inputStyle, width: 100 }} value={svc.price} onChange={e => updateService(svc.id, 'price', e.target.value)} placeholder="$79" />
            </div>
            <textarea
              style={{ ...inputStyle, minHeight: 50, resize: 'vertical', fontFamily: 'inherit', marginBottom: 8 }}
              value={svc.description} onChange={e => updateService(svc.id, 'description', e.target.value)}
              placeholder="What's included…"
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input style={inputStyle} value={svc.cta_label} onChange={e => updateService(svc.id, 'cta_label', e.target.value)} placeholder="Button label" />
              <input style={inputStyle} value={svc.cta_url} onChange={e => updateService(svc.id, 'cta_url', e.target.value)} placeholder="https://buy.stripe.com/…" />
            </div>
          </div>
        ))}

        {services.length === 0 && (
          <p style={{ fontSize: 13, color: '#8E8E93', margin: 0 }}>No services yet. Add your coaching packages, session types, or analysis services.</p>
        )}
      </div>

      {/* Links */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Links</h3>
          <button
            type="button" onClick={addLink}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px',
              borderRadius: 8, border: '1px solid #007AFF', background: 'transparent',
              color: '#007AFF', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Add Link
          </button>
        </div>

        {links.map((link, idx) => (
          <div key={link.id} style={{
            padding: 12, borderRadius: 12, border: '1px solid #E5E5EA', background: '#FAFAFA',
            marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <GripVertical size={14} style={{ color: '#C7C7CC', flexShrink: 0 }} />
            <select
              value={link.icon} onChange={e => updateLink(link.id, 'icon', e.target.value)}
              style={{ ...inputStyle, width: 'auto', minWidth: 110, padding: '8px 10px', fontSize: 13 }}
            >
              {ICON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input style={{ ...inputStyle, flex: 1 }} value={link.label} onChange={e => updateLink(link.id, 'label', e.target.value)} placeholder="Label" />
            <input style={{ ...inputStyle, flex: 1 }} value={link.url} onChange={e => updateLink(link.id, 'url', e.target.value)} placeholder="https://…" />
            <button type="button" onClick={() => removeLink(link.id)}
              style={{ background: 'none', border: 'none', color: '#FF3B30', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}

        {links.length === 0 && (
          <p style={{ fontSize: 13, color: '#8E8E93', margin: 0 }}>Add your social media, website, or booking links.</p>
        )}
      </div>
    </div>
  );
}
