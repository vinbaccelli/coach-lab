'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronUp, MessageSquare, Plus, Award, ChevronLeft } from 'lucide-react';

interface Question {
  id: string;
  user_name: string;
  user_email: string;
  title: string;
  body: string;
  category: string;
  upvotes: number;
  created_at: string;
}

interface Reply {
  id: string;
  user_name: string;
  user_email: string;
  body: string;
  is_coach_answer: boolean;
  upvotes: number;
  created_at: string;
}

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'general', label: 'General' },
  { value: 'technique', label: 'Technique' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'anglemotion', label: 'AngleMotion' },
];

const pill: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
  cursor: 'pointer', border: 'none', transition: 'all 0.15s',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  border: '1px solid #D1D1D6', fontSize: 13, background: '#FFF',
  color: '#1D1D1F', outline: 'none', boxSizing: 'border-box',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AcademyForum() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');
  const [showAsk, setShowAsk] = useState(false);
  const [askTitle, setAskTitle] = useState('');
  const [askBody, setAskBody] = useState('');
  const [askCategory, setAskCategory] = useState('general');
  const [posting, setPosting] = useState(false);
  const [selectedQ, setSelectedQ] = useState<Question | null>(null);

  useEffect(() => {
    fetch('/api/academy/questions').then(r => r.json()).then(d => {
      setQuestions(d.questions ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handlePost = useCallback(async () => {
    if (!askTitle.trim()) return;
    setPosting(true);
    try {
      const res = await fetch('/api/academy/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: askTitle, body: askBody, category: askCategory }),
      });
      if (res.ok) {
        const d = await res.json();
        setQuestions(prev => [d.question, ...prev]);
        setAskTitle(''); setAskBody(''); setShowAsk(false);
      }
    } finally { setPosting(false); }
  }, [askTitle, askBody, askCategory]);

  const handleVote = useCallback(async (questionId: string) => {
    const res = await fetch('/api/academy/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: questionId }),
    });
    if (res.ok) {
      const { voted } = await res.json();
      setQuestions(prev => prev.map(q =>
        q.id === questionId ? { ...q, upvotes: q.upvotes + (voted ? 1 : -1) } : q
      ));
    }
  }, []);

  const filtered = category === 'all' ? questions : questions.filter(q => q.category === category);

  if (selectedQ) {
    return <QuestionThread question={selectedQ} onBack={() => setSelectedQ(null)} />;
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#1A1A1A' }}>Q&A Forum</h3>
        <button
          type="button" onClick={() => setShowAsk(true)}
          style={{
            ...pill, background: '#007AFF', color: '#FFF',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Plus size={14} /> Ask
        </button>
      </div>

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button
            key={c.value} type="button"
            onClick={() => setCategory(c.value)}
            style={{
              ...pill,
              background: category === c.value ? '#007AFF' : '#F2F2F7',
              color: category === c.value ? '#FFF' : '#6E6E73',
            }}
          >{c.label}</button>
        ))}
      </div>

      {/* Ask form */}
      {showAsk && (
        <div style={{
          padding: 16, borderRadius: 14, border: '1px solid #007AFF', background: '#FAFAFA',
          marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <input style={inputStyle} value={askTitle} onChange={e => setAskTitle(e.target.value)} placeholder="Question title" />
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
            value={askBody} onChange={e => setAskBody(e.target.value)} placeholder="Details (optional)"
          />
          <select
            value={askCategory} onChange={e => setAskCategory(e.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
          >
            {CATEGORIES.filter(c => c.value !== 'all').map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={handlePost} disabled={posting || !askTitle.trim()}
              style={{ ...pill, background: '#007AFF', color: '#FFF', opacity: posting ? 0.5 : 1 }}
            >{posting ? 'Posting…' : 'Post Question'}</button>
            <button type="button" onClick={() => setShowAsk(false)}
              style={{ ...pill, background: '#F2F2F7', color: '#6E6E73' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Question list */}
      {loading ? (
        <p style={{ fontSize: 13, color: '#8E8E93' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: '#8E8E93' }}>No questions yet. Be the first to ask!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(q => (
            <div
              key={q.id}
              style={{
                display: 'flex', gap: 12, padding: '14px 14px',
                borderRadius: 12, border: '1px solid #E5E5EA', background: '#FFF',
                cursor: 'pointer', transition: 'border-color 0.15s',
              }}
              onClick={() => setSelectedQ(q)}
            >
              {/* Vote button */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleVote(q.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#007AFF' }}
                >
                  <ChevronUp size={18} />
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1D1D1F' }}>{q.upvotes}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1D1D1F', marginBottom: 4 }}>{q.title}</div>
                {q.body && <div style={{ fontSize: 12, color: '#6E6E73', lineHeight: 1.4, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.body}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: '#8E8E93' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 6, background: '#F2F2F7', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{q.category}</span>
                  <span>{q.user_name || q.user_email?.split('@')[0]}</span>
                  <span>·</span>
                  <span>{timeAgo(q.created_at)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8E8E93', fontSize: 12, flexShrink: 0 }}>
                <MessageSquare size={14} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionThread({ question, onBack }: { question: Question; onBack: () => void }) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetch(`/api/academy/questions/${question.id}/replies`)
      .then(r => r.json())
      .then(d => { setReplies(d.replies ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [question.id]);

  const handleReply = useCallback(async () => {
    if (!replyBody.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/academy/questions/${question.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody }),
      });
      if (res.ok) {
        const d = await res.json();
        setReplies(prev => [...prev, d.reply]);
        setReplyBody('');
      }
    } finally { setPosting(false); }
  }, [question.id, replyBody]);

  const handleVoteReply = useCallback(async (replyId: string) => {
    const res = await fetch('/api/academy/votes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply_id: replyId }),
    });
    if (res.ok) {
      const { voted } = await res.json();
      setReplies(prev => prev.map(r =>
        r.id === replyId ? { ...r, upvotes: r.upvotes + (voted ? 1 : -1) } : r
      ));
    }
  }, []);

  return (
    <div style={{ marginTop: 20 }}>
      <button
        type="button" onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          color: '#007AFF', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 14,
        }}
      >
        <ChevronLeft size={16} /> Back to questions
      </button>

      <div style={{ padding: 16, borderRadius: 14, border: '1px solid #E5E5EA', background: '#FFF', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 11, color: '#8E8E93' }}>
          <span style={{ padding: '2px 8px', borderRadius: 6, background: '#F2F2F7', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{question.category}</span>
          <span>{question.user_name || question.user_email?.split('@')[0]}</span>
          <span>·</span>
          <span>{timeAgo(question.created_at)}</span>
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#1D1D1F' }}>{question.title}</h3>
        {question.body && <p style={{ margin: 0, fontSize: 13, color: '#4B5563', lineHeight: 1.6 }}>{question.body}</p>}
      </div>

      {/* Replies */}
      <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#6E6E73' }}>
        {loading ? 'Loading replies…' : `${replies.length} ${replies.length === 1 ? 'Reply' : 'Replies'}`}
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {replies.map(r => (
          <div
            key={r.id}
            style={{
              display: 'flex', gap: 10, padding: '12px 14px',
              borderRadius: 12, background: '#FFF',
              border: r.is_coach_answer ? '1px solid #34C759' : '1px solid #E5E5EA',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => handleVoteReply(r.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#007AFF' }}
              >
                <ChevronUp size={16} />
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1D1D1F' }}>{r.upvotes}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, fontSize: 11, color: '#8E8E93' }}>
                <span style={{ fontWeight: 600 }}>{r.user_name || r.user_email?.split('@')[0]}</span>
                {r.is_coach_answer && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 8px',
                    borderRadius: 6, background: '#34C75920', color: '#34C759', fontWeight: 700, fontSize: 10,
                  }}>
                    <Award size={10} /> Coach
                  </span>
                )}
                <span>·</span>
                <span>{timeAgo(r.created_at)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#1D1D1F', lineHeight: 1.55 }}>{r.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Reply form */}
      <div style={{
        display: 'flex', gap: 8, padding: 12, borderRadius: 12,
        border: '1px solid #E5E5EA', background: '#FAFAFA',
      }}>
        <textarea
          style={{ ...inputStyle, flex: 1, minHeight: 40, resize: 'vertical', fontFamily: 'inherit' }}
          value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Write a reply…"
        />
        <button
          type="button" onClick={handleReply} disabled={posting || !replyBody.trim()}
          style={{
            ...pill, background: '#007AFF', color: '#FFF', alignSelf: 'flex-end',
            opacity: posting ? 0.5 : 1,
          }}
        >{posting ? '…' : 'Reply'}</button>
      </div>
    </div>
  );
}
