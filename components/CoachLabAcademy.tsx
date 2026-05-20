'use client';

import React from 'react';

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#1A1A1A',
  margin: '0 0 8px',
};

const body: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: '#4B5563',
  margin: '0 0 14px',
};

const list: React.CSSProperties = {
  margin: '0 0 14px',
  paddingLeft: 18,
  fontSize: 12,
  lineHeight: 1.55,
  color: '#4B5563',
};

export default function CoachLabAcademy() {
  return (
    <div style={{ padding: '4px 2px 12px' }}>
      <p style={{ ...body, fontWeight: 600, color: '#1A1A1A' }}>
        Coach Lab Academy teaches the recommended V1 workflow: upload videos into CoachLab after
        preparing them on YouTube, Drive, or your camera roll.
      </p>

      <h3 style={sectionTitle}>1. YouTube workflow guide</h3>
      <ul style={list}>
        <li>Upload athlete footage to YouTube as <strong>Unlisted</strong> (not Public) for privacy.</li>
        <li>Download the MP4 from YouTube Studio or a trusted downloader, then import the file into CoachLab.</li>
        <li>Use one clip per session; trim in YouTube or your editor before upload for faster analysis.</li>
      </ul>

      <h3 style={sectionTitle}>2. Instagram workflow guide</h3>
      <ul style={list}>
        <li>Save Reels or posts to your device (screen recording or creator export).</li>
        <li>Transfer via AirDrop, Google Drive, or email — avoid fragile link pasting inside CoachLab.</li>
        <li>Import the saved MP4 with <strong>Upload Video</strong> in Session &amp; record or the empty canvas.</li>
      </ul>

      <h3 style={sectionTitle}>3. Video organization system</h3>
      <ul style={list}>
        <li>Folder per athlete in Google Drive: <em>Raw</em>, <em>CoachLab exports</em>, <em>Published</em>.</li>
        <li>Name files: <code>Athlete_LastName_YYYYMMDD_skill.mp4</code>.</li>
        <li>Keep a Google Doc lesson log: date, focus, clips used, notes for the athlete.</li>
        <li>YouTube Unlisted = shareable archive; CoachLab = active coaching canvas.</li>
      </ul>

      <h3 style={sectionTitle}>4. Copyright &amp; usage guidelines</h3>
      <ul style={list}>
        <li>Only analyze footage you have rights to use (your athletes, club license, or written consent).</li>
        <li>Do not redistribute third-party broadcast or pro-league content without permission.</li>
        <li>Screen recordings for coaching feedback to the athlete are generally fine; public reposting is not.</li>
        <li>When in doubt, get consent and keep originals private.</li>
      </ul>

      <h3 style={sectionTitle}>5. Recommended CoachLab setup</h3>
      <ol style={list}>
        <li>Upload primary video (left slot).</li>
        <li>Optional: add comparison video (right slot) for side-by-side technique work.</li>
        <li>Use Draw tools + Skeleton overlay; enable Precision on phone for fine marks.</li>
        <li>Record screen with Session &amp; record when ready to send feedback.</li>
      </ol>
    </div>
  );
}
