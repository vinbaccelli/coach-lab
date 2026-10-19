import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withFirstFrameFragment } from '@/lib/firstFrame';

test('first-frame media fragment: blob URLs only, raw URL kept elsewhere', () => {
  assert.equal(withFirstFrameFragment('blob:http://localhost:3000/6f1c'), 'blob:http://localhost:3000/6f1c#t=0.001');
  // Streams, proxied URLs and anything with a fragment already are left alone.
  assert.equal(withFirstFrameFragment('/api/video-proxy?u=x'), '/api/video-proxy?u=x');
  assert.equal(withFirstFrameFragment('https://cdn.example.com/a.mp4'), 'https://cdn.example.com/a.mp4');
  assert.equal(withFirstFrameFragment('blob:http://localhost:3000/6f1c#t=2'), 'blob:http://localhost:3000/6f1c#t=2');
  assert.equal(withFirstFrameFragment(null), undefined);
  assert.equal(withFirstFrameFragment(''), undefined);
});
