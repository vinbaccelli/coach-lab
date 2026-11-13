// Local stand-in for the parts of Supabase this app talks to, for browser and API tests on a
// developer machine. DEV / TEST ONLY: it trusts its own signing secret and has no rate limits.
//
//   /auth/v1/user, /auth/v1/token, /auth/v1/logout, /auth/v1/admin/users/:id   (GoTrue subset)
//   /rest/v1/<table>, /rest/v1/rpc/<fn>                                           (PostgREST subset)
//   /storage/v1/object/...                                                        (Storage subset)
//
// Every REST request runs in its own transaction as the role in the caller's JWT (anon,
// authenticated or service_role) with request.jwt.claims set, so Row Level Security is the real
// Postgres RLS from supabase/migrations. Start with scripts/local-stack/start.sh.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.LOCAL_SUPABASE_PORT || 54321);
const SECRET = process.env.LOCAL_JWT_SECRET || 'local-dev-only-secret-0123456789-abcdefghij';
const DB_URL = process.env.LOCAL_DB_URL || 'postgres://postgres@127.0.0.1:54322/coachlab';
const STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), '.local-stack-storage');
const pool = new pg.Pool({ connectionString: DB_URL, max: 8 });

// ── JWT (HS256) ────────────────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64url');
export function signJwt(payload, secret = SECRET) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (sig.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch { return null; }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (id) => { if (!IDENT.test(id)) throw httpError(400, 'PGRST100', `bad identifier ${id}`); return `"${id}"`; };
function httpError(status, code, message, details = null) { const e = new Error(message); e.status = status; e.body = { code, message, details, hint: null }; return e; }
function send(res, status, body, headers = {}) {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Location', ...headers };
  if (body === undefined || body === null) { res.writeHead(status, h); res.end(); return; }
  if (Buffer.isBuffer(body)) { res.writeHead(status, h); res.end(body); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...h });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function claimsFor(req) {
  const auth = req.headers.authorization || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const apikey = req.headers.apikey || null;
  const claims = verifyJwt(bearer) || verifyJwt(apikey);
  if (!claims) return { role: 'anon' };
  return claims;
}
function pgRole(claims) {
  return claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon';
}
async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${pgRole(claims)}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
function pgToHttp(e, claims) {
  if (e.status) return e;
  const code = e.code || '';
  const msg = e.message || 'error';
  if (code === '42P01') return httpError(404, 'PGRST205', `Could not find the table in the schema cache (${msg})`);
  if (code === '42883') return httpError(404, 'PGRST202', `Could not find the function in the schema cache (${msg})`);
  if (code === '42703') return httpError(400, '42703', msg);
  if (code === '42501') return httpError(pgRole(claims) === 'anon' ? 401 : 403, '42501', msg);
  if (code === '23505' || code === '23503') return httpError(409, code, msg, e.detail || null);
  if (code === '23514' || code === '23502' || code.startsWith('22')) return httpError(400, code, msg, e.detail || null);
  if (code === 'P0001') return httpError(400, code, msg);
  return httpError(500, code || 'XX000', msg);
}

// ── PostgREST query translation (the subset this app uses) ───────────────────
function parseSelect(sel) {
  if (!sel || sel === '*') return '*';
  return sel.split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
    if (c.includes('(')) throw httpError(400, 'PGRST100', 'embedded resources are not supported by the local stack');
    if (c === '*') return '*';
    const [alias, col] = c.includes(':') ? c.split(':') : [null, c];
    const colName = col.split('::')[0];
    return alias ? `${q(colName)} as ${q(alias)}` : q(colName);
  }).join(', ');
}
function splitTopLevel(s) {
  const out = []; let depth = 0; let cur = ''; let inQ = false;
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && ch === '(') depth++;
    if (!inQ && ch === ')') depth--;
    if (!inQ && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseInList(v) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  return splitTopLevel(inner).map((x) => x.trim().replace(/^"(.*)"$/, '$1'));
}
function condition(col, expr, params) {
  let negate = false;
  if (expr.startsWith('not.')) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = dot === -1 ? expr : expr.slice(0, dot);
  const val = dot === -1 ? '' : expr.slice(dot + 1);
  const c = q(col);
  const p = (v) => { params.push(v); return `$${params.length}`; };
  let sql;
  switch (op) {
    case 'eq': sql = `${c} = ${p(val)}`; break;
    case 'neq': sql = `${c} <> ${p(val)}`; break;
    case 'gt': sql = `${c} > ${p(val)}`; break;
    case 'gte': sql = `${c} >= ${p(val)}`; break;
    case 'lt': sql = `${c} < ${p(val)}`; break;
    case 'lte': sql = `${c} <= ${p(val)}`; break;
    case 'like': sql = `${c}::text like ${p(val.replace(/\*/g, '%'))}`; break;
    case 'ilike': sql = `${c}::text ilike ${p(val.replace(/\*/g, '%'))}`; break;
    case 'is': {
      const v = val.toLowerCase();
      if (v === 'null') sql = `${c} is null`;
      else if (v === 'true') sql = `${c} is true`;
      else if (v === 'false') sql = `${c} is false`;
      else throw httpError(400, 'PGRST100', `bad is value ${val}`);
      break;
    }
    case 'in': sql = `${c} = any(${p(parseInList(val))})`; break;
    case 'cs': sql = `${c} @> ${p(val.startsWith('{') ? val : val)}`; break;
    case 'cd': sql = `${c} <@ ${p(val)}`; break;
    default: throw httpError(400, 'PGRST100', `operator ${op} is not supported by the local stack`);
  }
  return negate ? `not (${sql})` : sql;
}
function orGroup(v, params) {
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const parts = splitTopLevel(inner).map((item) => {
    const i = item.indexOf('.');
    return condition(item.slice(0, i), item.slice(i + 1), params);
  });
  return `(${parts.join(' or ')})`;
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function whereClause(sp, params) {
  const conds = [];
  for (const [k, v] of sp.entries()) {
    if (RESERVED.has(k)) continue;
    if (k === 'or') { conds.push(orGroup(v, params)); continue; }
    if (k === 'and') { conds.push(`(${splitTopLevel(v.replace(/^\(/, '').replace(/\)$/, '')).map((it) => { const i = it.indexOf('.'); return condition(it.slice(0, i), it.slice(i + 1), params); }).join(' and ')})`); continue; }
    conds.push(condition(k, v, params));
  }
  return conds.length ? `where ${conds.join(' and ')}` : '';
}
function orderClause(v) {
  if (!v) return '';
  return 'order by ' + v.split(',').map((part) => {
    const [col, ...mods] = part.split('.');
    let s = q(col);
    if (mods.includes('desc')) s += ' desc'; else if (mods.includes('asc')) s += ' asc';
    if (mods.includes('nullsfirst')) s += ' nulls first';
    if (mods.includes('nullslast')) s += ' nulls last';
    return s;
  }).join(', ');
}
function prefer(req) {
  const out = {};
  String(req.headers.prefer || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((kv) => {
    const [k, v] = kv.split('=');
    out[k] = v;
  });
  return out;
}

async function handleRest(req, res, url, claims) {
  const rel = url.pathname.replace(/^\/rest\/v1\/?/, '');
  const sp = url.searchParams;
  const pref = prefer(req);
  const wantsObject = String(req.headers.accept || '').includes('application/vnd.pgrst.object+json');
  const method = req.method;

  if (rel.startsWith('rpc/')) {
    const fn = rel.slice(4);
    const raw = method === 'GET' ? Object.fromEntries(sp.entries()) : JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const result = await asRole(claims, async (client) => {
      const info = await client.query(
        `select p.proretset, t.typname, t.typtype from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
      if (!info.rowCount) throw httpError(404, 'PGRST202', `Could not find the function public.${fn}`);
      const params = []; const args = Object.entries(raw).map(([k, v]) => { params.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v); return `${q(k)} => $${params.length}`; });
      const call = `public.${q(fn)}(${args.join(', ')})`;
      const { proretset, typtype } = info.rows[0];
      if (proretset || typtype === 'c') {
        const r = await client.query(`select coalesce(json_agg(x), '[]'::json) as j from ${call} x`, params);
        return r.rows[0].j;
      }
      const r = await client.query(`select to_json(${call}) as j`, params);
      return r.rows[0].j;
    });
    return send(res, 200, JSON.stringify(result ?? null));
  }

  const table = rel.split('/')[0];
  const t = `public.${q(table)}`;

  if (method === 'GET' || method === 'HEAD') {
    const params = [];
    const where = whereClause(sp, params);
    let limit = sp.get('limit'); let offset = sp.get('offset');
    const range = req.headers.range && /^(\d+)-(\d+)$/.exec(String(req.headers.range));
    if (range) { offset = range[1]; limit = String(Number(range[2]) - Number(range[1]) + 1); }
    const lim = limit ? `limit ${Number(limit) | 0}` : '';
    const off = offset ? `offset ${Number(offset) | 0}` : '';
    const out = await asRole(claims, async (client) => {
      const rows = method === 'HEAD' ? null : (await client.query(
        `select coalesce(json_agg(x), '[]'::json) as j from (select ${parseSelect(sp.get('select'))} from ${t} ${where} ${orderClause(sp.get('order'))} ${lim} ${off}) x`, params)).rows[0].j;
      let total = null;
      if (pref.count === 'exact') total = Number((await client.query(`select count(*)::int as n from ${t} ${where}`, params)).rows[0].n);
      return { rows, total };
    });
    const n = out.rows ? out.rows.length : 0;
    const headers = { 'Content-Range': `${n ? `0-${n - 1}` : '*'}/${out.total ?? '*'}` };
    if (method === 'HEAD') return send(res, 200, null, headers);
    if (wantsObject) {
      if (out.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${out.rows.length} rows`, hint: null });
      return send(res, 200, out.rows[0], headers);
    }
    return send(res, 200, out.rows, headers);
  }

  const bodyText = method === 'DELETE' ? '' : (await readBody(req)).toString('utf8');
  const body = bodyText ? JSON.parse(bodyText) : null;
  const returning = pref.return === 'representation';
  const sel = parseSelect(sp.get('select'));

  const rows = await asRole(claims, async (client) => {
    const params = [];
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const cols = sp.get('columns') ? sp.get('columns').split(',') : [...new Set(list.flatMap((r) => Object.keys(r || {})))];
      cols.forEach(q);
      params.push(JSON.stringify(list));
      const colList = cols.map(q).join(', ');
      let conflict = '';
      if (pref.resolution === 'merge-duplicates' || pref.resolution === 'ignore-duplicates') {
        const target = (sp.get('on_conflict') || 'id').split(',').map(q).join(', ');
        conflict = pref.resolution === 'ignore-duplicates'
          ? `on conflict (${target}) do nothing`
          : `on conflict (${target}) do update set ${cols.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
      }
      const ins = cols.length
        ? `insert into ${t} (${colList}) select ${colList} from json_populate_recordset(null::${t}, $1::json) ${conflict} returning *`
        : `insert into ${t} default values returning *`;
      return (await client.query(`with w as (${ins}) select coalesce(json_agg(x), '[]'::json) as j from (select ${sel} from w) x`, params)).rows[0].j;
    }
    if (method === 'PATCH') {
      const cols = Object.keys(body || {});
      if (!cols.length) throw httpError(400, 'PGRST100', 'empty update');
      cols.forEach(q);
      params.push(JSON.stringify(body));
      const where = whereClause(sp, params);
      const upd = `update ${t} set (${cols.map(q).join(', ')}) = (select ${cols.map(q).join(', ')} from json_populate_record(null::${t}, $1::json)) ${where} returning *`;
      const fixed = cols.length === 1 ? upd.replace(`set (${q(cols[0])}) = (select ${q(cols[0])} from`, `set ${q(cols[0])} = (select ${q(cols[0])} from`) : upd;
      return (await client.query(`with w as (${fixed}) select coalesce(json_agg(x), '[]'::json) as j from (select ${sel} from w) x`, params)).rows[0].j;
    }
    if (method === 'DELETE') {
      const where = whereClause(sp, params);
      return (await client.query(`with w as (delete from ${t} ${where} returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${sel} from w) x`, params)).rows[0].j;
    }
    throw httpError(405, 'PGRST100', 'method not allowed');
  });

  if (method === 'POST') {
    if (!returning) return send(res, 201, null);
    if (wantsObject) return rows.length === 1 ? send(res, 201, rows[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null });
    return send(res, 201, rows);
  }
  if (!returning) return send(res, 204, null);
  if (wantsObject) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null });
  return send(res, 200, rows);
}

// ── Auth (GoTrue subset) ──────────────────────────────────────────────────────
async function loadUser(id) {
  const r = await pool.query('select id, email, raw_user_meta_data, created_at from auth.users where id = $1', [id]);
  if (!r.rowCount) return null;
  const u = r.rows[0];
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: u.raw_user_meta_data || {}, created_at: u.created_at, updated_at: u.created_at };
}
export function sessionFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 7 * 24 * 3600 });
  return { access_token: access, token_type: 'bearer', expires_in: 7 * 24 * 3600, expires_at: now + 7 * 24 * 3600, refresh_token: `rt-${user.id}`, user };
}
async function handleAuth(req, res, url, claims) {
  const p = url.pathname.replace(/^\/auth\/v1/, '');
  if (p === '/user' && req.method === 'GET') {
    if (claims.role !== 'authenticated' || !claims.sub) return send(res, 401, { code: 401, msg: 'invalid JWT', error_code: 'bad_jwt' });
    const user = await loadUser(claims.sub);
    return user ? send(res, 200, user) : send(res, 404, { code: 404, msg: 'User not found' });
  }
  if (p === '/token' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const id = typeof body.refresh_token === 'string' && body.refresh_token.startsWith('rt-') ? body.refresh_token.slice(3) : null;
    const user = id ? await loadUser(id) : null;
    return user ? send(res, 200, sessionFor(user)) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
  }
  if (p === '/logout') return send(res, 204, null);
  const m = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(p);
  if (m && req.method === 'GET') {
    if (claims.role !== 'service_role') return send(res, 403, { code: 403, msg: 'not admin' });
    const user = await loadUser(m[1]);
    return user ? send(res, 200, user) : send(res, 404, { code: 404, msg: 'User not found' });
  }
  return send(res, 404, { code: 404, msg: `local stack: ${p} not implemented` });
}

// ── Storage subset ────────────────────────────────────────────────────────────
async function handleStorage(req, res, url, claims) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/?/, ''));
  if (p.startsWith('public/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const file = path.join(STORAGE_DIR, p.slice(7));
    if (!file.startsWith(STORAGE_DIR) || !fs.existsSync(file)) return send(res, 404, { error: 'not_found' });
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': 'image/jpeg' });
  }
  if (req.method === 'POST' || req.method === 'PUT') {
    const [bucket, ...rest] = p.split('/');
    const name = rest.join('/');
    const data = await readBody(req);
    await asRole(claims, (client) => client.query(
      'insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)',
      [bucket, name, claims.sub || null, JSON.stringify({ size: data.length, mimetype: req.headers['content-type'] || null })]));
    const file = path.join(STORAGE_DIR, bucket, name);
    if (!file.startsWith(STORAGE_DIR)) return send(res, 400, { error: 'bad path' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
  }
  if (req.method === 'DELETE') {
    const bucket = p.split('/')[0];
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const names = Array.isArray(body.prefixes) ? body.prefixes : [];
    const removed = await asRole(claims, (client) => client.query(
      'delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, names]));
    removed.rows.forEach((r) => { const f = path.join(STORAGE_DIR, bucket, r.name); if (f.startsWith(STORAGE_DIR) && fs.existsSync(f)) fs.unlinkSync(f); });
    return send(res, 200, removed.rows.map((r) => ({ name: r.name })));
  }
  return send(res, 404, { error: 'not_found' });
}

// ── server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {
    return send(res, 204, null, {
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    });
  }
  const claims = claimsFor(req);
  try {
    if (url.pathname.startsWith('/rest/v1')) return await handleRest(req, res, url, claims);
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url, claims);
    if (url.pathname.startsWith('/storage/v1/object')) return await handleStorage(req, res, url, claims);
    return send(res, 404, { message: 'local stack: unknown path' });
  } catch (e) {
    const he = pgToHttp(e, claims);
    if (process.env.LOCAL_STACK_LOG) console.error(req.method, url.pathname + url.search, '->', he.status, he.body.message);
    return send(res, he.status || 500, he.body);
  }
});

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => console.log(`local supabase stand-in on http://localhost:${PORT}`));
}
