// TEMP-DEBUG-POINTER — remove after the phone touch-target investigation.
//
// Phone Chrome (no remote debugging set up) can't read console.log, so this
// surfaces raw pointer events on an ALWAYS-VISIBLE on-screen panel instead.
// A single shared logger is called from the three elements under investigation
// (toolbar expand/collapse button, PreciseTimeline trim handles, FrameMaskEditor
// canvas) so there is ONE panel, not three copies.
//
// Gated behind the SAME ?debug=1 sticky flag as the analysis-page overlay
// (sessionStorage key 'am-temp-debug', mirrored by LoginClient so it survives
// the OAuth round-trip). No flag → every call is a no-op and no panel is created.

const SS_KEY = 'am-temp-debug';
const MAX_LINES = 15;

let panelEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let lines: string[] = [];
let seq = 0;

function debugOn(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(SS_KEY) === '1';
  } catch {
    return false;
  }
}

function ensurePanel(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (panelEl && panelEl.isConnected) return bodyEl;

  const el = document.createElement('div');
  el.id = 'temp-debug-pointer-panel';
  el.style.cssText = [
    'position:fixed',
    'top:4px',
    'right:4px',
    'z-index:2147483647',
    'width:320px',
    'max-width:calc(100vw - 8px)',
    'max-height:46vh',
    'overflow:hidden',
    'box-sizing:border-box',
    'background:rgba(0,0,0,0.74)',
    'color:#4ade80',
    'font:10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
    'padding:5px 7px',
    'border-radius:8px',
    'border:1px solid rgba(74,222,128,0.4)',
    'white-space:pre-wrap',
    'word-break:break-all',
    // Never intercept the very touches we are trying to measure.
    'pointer-events:none',
    'user-select:none',
    '-webkit-user-select:none',
  ].join(';');

  const header = document.createElement('div');
  header.textContent = 'TEMP-DEBUG-POINTER  el evt type pri id dp';
  header.style.cssText = 'color:#fbbf24;margin-bottom:3px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:2px';

  const body = document.createElement('div');

  el.appendChild(header);
  el.appendChild(body);
  document.body.appendChild(el);

  panelEl = el;
  bodyEl = body;
  return body;
}

interface PointerLike {
  type: string;
  pointerType?: string;
  isPrimary?: boolean;
  pointerId?: number;
  defaultPrevented?: boolean;
}

/**
 * Append one pointer-event line to the on-screen panel. No-op unless ?debug=1.
 * `source` is the short element tag (e.g. 'tl-start', 'tb-expand', 'mask-canvas').
 * Call this at the TOP of a handler (before any preventDefault/stopPropagation)
 * so `dp` reflects the event's INCOMING defaultPrevented state.
 */
export function tempDebugPointer(source: string, e: PointerLike): void {
  if (!debugOn()) return;
  const body = ensurePanel();
  if (!body) return;

  seq += 1;
  const evt = e.type.replace('pointer', ''); // down / move / up / cancel
  const line =
    `#${seq} ${source} ${evt} ${e.pointerType ?? '?'} ` +
    `pri=${e.isPrimary ? 1 : 0} id=${e.pointerId ?? '?'} dp=${e.defaultPrevented ? 1 : 0}`;

  lines.push(line);
  if (lines.length > MAX_LINES) lines = lines.slice(lines.length - MAX_LINES);
  body.textContent = lines.join('\n');
}
