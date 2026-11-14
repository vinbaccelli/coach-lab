-- Mental questionnaires, coach assessments, and assignments / reminders (2026-11-14).
--
--   questionnaire_templates          questionnaires and assessments: built-in ones (coach_id null,
--                                    seeded below, read-only for coaches) and each coach's own.
--                                    kind 'questionnaire' = the player answers; kind 'assessment' =
--                                    the coach fills it about the player and it is NEVER shown to
--                                    the player. Questions: scale (min..max), choice, yes/no, text.
--   player_questionnaires            a questionnaire sent to a player, or an assessment of the player
--                                    (a copy of the questions, so editing a template never changes
--                                    what was sent or answered). Open or closed, optional due date.
--   player_questionnaire_responses   answers. The coach's are approved; the player's (author = link)
--                                    are submitted until the coach has read them.
--   player_assignments               the player's to-do: title, description, due date, recurrence
--                                    (none, daily, weekly, monthly; the next one is created when one is
--                                    done), optional questionnaire to answer; open, done or cancelled.
--
-- RLS: built-in templates readable by every signed-in coach and writable by none; everything else is
-- the owning coach's only (share-link reads and writes go through the server, scoped to the link's
-- player, and never include assessments). Inside policy subqueries the row's own columns are written
-- with the table name (see KNOWN_ISSUES 079). Idempotent. NOT APPLIED automatically.

create table if not exists public.questionnaire_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references auth.users (id) on delete cascade,
  slug text check (slug is null or slug ~ '^[a-z0-9_]{1,60}$'),
  kind text not null default 'questionnaire' check (kind in ('questionnaire', 'assessment')),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 40),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questionnaire_global_has_slug check ((coach_id is null) = (slug is not null))
);
create unique index if not exists uq_questionnaire_global_slug on public.questionnaire_templates (slug) where coach_id is null;
create index if not exists idx_questionnaire_templates_coach on public.questionnaire_templates (coach_id);

create table if not exists public.player_questionnaires (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  template_id uuid references public.questionnaire_templates (id) on delete set null,
  kind text not null check (kind in ('questionnaire', 'assessment')),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 40),
  due_on date,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_player_questionnaires_player on public.player_questionnaires (player_id, created_at desc);
create index if not exists idx_player_questionnaires_coach on public.player_questionnaires (coach_id);

create table if not exists public.player_questionnaire_responses (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  questionnaire_id uuid not null references public.player_questionnaires (id) on delete cascade,
  answered_on date not null default current_date,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  author text not null default 'coach' check (author in ('coach', 'link')),
  status text not null default 'approved' check (status in ('submitted', 'approved', 'needs_revision')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_at timestamptz,
  client_ref uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_q_responses_player on public.player_questionnaire_responses (player_id, answered_on desc);
create index if not exists idx_q_responses_questionnaire on public.player_questionnaire_responses (questionnaire_id);
create index if not exists idx_q_responses_coach on public.player_questionnaire_responses (coach_id);
create unique index if not exists uq_q_responses_client_ref on public.player_questionnaire_responses (player_id, client_ref) where client_ref is not null;
create index if not exists idx_q_responses_pending on public.player_questionnaire_responses (player_id) where status <> 'approved';

create table if not exists public.player_assignments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  due_on date,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  questionnaire_id uuid references public.player_questionnaires (id) on delete set null,
  series_id uuid,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  done_at timestamptz,
  done_by text check (done_by is null or done_by in ('coach', 'link')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_recurring_needs_due check (recurrence = 'none' or due_on is not null)
);
create index if not exists idx_assignments_player on public.player_assignments (player_id, status, due_on);
create index if not exists idx_assignments_coach on public.player_assignments (coach_id);

alter table public.questionnaire_templates enable row level security;
alter table public.player_questionnaires enable row level security;
alter table public.player_questionnaire_responses enable row level security;
alter table public.player_assignments enable row level security;

drop policy if exists "q_templates_select" on public.questionnaire_templates;
create policy "q_templates_select" on public.questionnaire_templates for select to authenticated using (coach_id is null or coach_id = auth.uid());
drop policy if exists "q_templates_insert_own" on public.questionnaire_templates;
create policy "q_templates_insert_own" on public.questionnaire_templates for insert to authenticated with check (coach_id = auth.uid());
drop policy if exists "q_templates_update_own" on public.questionnaire_templates;
create policy "q_templates_update_own" on public.questionnaire_templates for update to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
drop policy if exists "q_templates_delete_own" on public.questionnaire_templates;
create policy "q_templates_delete_own" on public.questionnaire_templates for delete to authenticated using (coach_id = auth.uid());

drop policy if exists "player_q_select_own" on public.player_questionnaires;
create policy "player_q_select_own" on public.player_questionnaires for select using (auth.uid() = coach_id);
drop policy if exists "player_q_insert_own" on public.player_questionnaires;
create policy "player_q_insert_own" on public.player_questionnaires for insert with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_questionnaires.player_id and p.coach_id = auth.uid())
  and (template_id is null or exists (select 1 from public.questionnaire_templates t where t.id = player_questionnaires.template_id and (t.coach_id is null or t.coach_id = auth.uid())))
);
drop policy if exists "player_q_update_own" on public.player_questionnaires;
create policy "player_q_update_own" on public.player_questionnaires for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_questionnaires.player_id and p.coach_id = auth.uid())
  and (template_id is null or exists (select 1 from public.questionnaire_templates t where t.id = player_questionnaires.template_id and (t.coach_id is null or t.coach_id = auth.uid())))
);
drop policy if exists "player_q_delete_own" on public.player_questionnaires;
create policy "player_q_delete_own" on public.player_questionnaires for delete using (auth.uid() = coach_id);

drop policy if exists "q_responses_select_own" on public.player_questionnaire_responses;
create policy "q_responses_select_own" on public.player_questionnaire_responses for select using (auth.uid() = coach_id);
drop policy if exists "q_responses_insert_own" on public.player_questionnaire_responses;
create policy "q_responses_insert_own" on public.player_questionnaire_responses for insert with check (
  auth.uid() = coach_id
  and exists (select 1 from public.player_questionnaires q
              where q.id = player_questionnaire_responses.questionnaire_id
                and q.player_id = player_questionnaire_responses.player_id and q.coach_id = auth.uid())
);
drop policy if exists "q_responses_update_own" on public.player_questionnaire_responses;
create policy "q_responses_update_own" on public.player_questionnaire_responses for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id
  and exists (select 1 from public.player_questionnaires q
              where q.id = player_questionnaire_responses.questionnaire_id
                and q.player_id = player_questionnaire_responses.player_id and q.coach_id = auth.uid())
);
drop policy if exists "q_responses_delete_own" on public.player_questionnaire_responses;
create policy "q_responses_delete_own" on public.player_questionnaire_responses for delete using (auth.uid() = coach_id);

drop policy if exists "assignments_select_own" on public.player_assignments;
create policy "assignments_select_own" on public.player_assignments for select using (auth.uid() = coach_id);
drop policy if exists "assignments_insert_own" on public.player_assignments;
create policy "assignments_insert_own" on public.player_assignments for insert with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_assignments.player_id and p.coach_id = auth.uid())
  and (questionnaire_id is null or exists (select 1 from public.player_questionnaires q
       where q.id = player_assignments.questionnaire_id and q.player_id = player_assignments.player_id and q.kind = 'questionnaire'))
);
drop policy if exists "assignments_update_own" on public.player_assignments;
create policy "assignments_update_own" on public.player_assignments for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_assignments.player_id and p.coach_id = auth.uid())
  and (questionnaire_id is null or exists (select 1 from public.player_questionnaires q
       where q.id = player_assignments.questionnaire_id and q.player_id = player_assignments.player_id and q.kind = 'questionnaire'))
);
drop policy if exists "assignments_delete_own" on public.player_assignments;
create policy "assignments_delete_own" on public.player_assignments for delete using (auth.uid() = coach_id);

-- ── Built-in questionnaires (original wording) ─────────────────────────────────────────────────
insert into public.questionnaire_templates (slug, kind, title, description, questions) values
  ('weekly_wellness', 'questionnaire', 'Weekly wellness check', 'A one-minute check of how the week went off the court.',
   '[{"id":"sleep","kind":"scale","label":"How well did you sleep?","min":1,"max":10,"low":"Very badly","high":"Very well"},
     {"id":"energy","kind":"scale","label":"Energy","min":1,"max":10,"low":"Empty","high":"Full"},
     {"id":"stress","kind":"scale","label":"Stress","min":1,"max":10,"low":"Calm","high":"Very stressed","better":"lower"},
     {"id":"mood","kind":"scale","label":"Mood","min":1,"max":10,"low":"Low","high":"Great"},
     {"id":"soreness","kind":"scale","label":"Muscle soreness","min":1,"max":10,"low":"None","high":"A lot","better":"lower"},
     {"id":"note","kind":"text","label":"Anything your coach should know?"}]'),
  ('pre_match_readiness', 'questionnaire', 'Before the match', 'Answer it when you arrive at the club.',
   '[{"id":"confidence","kind":"scale","label":"Confidence","min":1,"max":10,"low":"Low","high":"High"},
     {"id":"nerves","kind":"scale","label":"Nerves","min":1,"max":10,"low":"Relaxed","high":"Very nervous","better":"lower"},
     {"id":"focus","kind":"scale","label":"Focus","min":1,"max":10,"low":"Scattered","high":"Sharp"},
     {"id":"plan","kind":"text","label":"My plan for this match"},
     {"id":"strength","kind":"text","label":"One thing I will do well"}]'),
  ('post_match_reflection', 'questionnaire', 'After the match', 'A short reflection while the match is fresh.',
   '[{"id":"result","kind":"choice","label":"Result","options":["Won","Lost","Not finished"]},
     {"id":"effort","kind":"scale","label":"Effort","min":1,"max":10,"low":"Low","high":"Everything"},
     {"id":"pressure","kind":"scale","label":"How I handled pressure","min":1,"max":10,"low":"Badly","high":"Very well"},
     {"id":"worked","kind":"text","label":"What worked"},
     {"id":"next","kind":"text","label":"What I will work on"}]'),
  ('coach_mental_assessment', 'assessment', 'Coach''s mental assessment', 'Filled by the coach. Never shown to the player.',
   '[{"id":"focus","kind":"scale","label":"Focus","min":1,"max":5},
     {"id":"resilience","kind":"scale","label":"Resilience after mistakes","min":1,"max":5},
     {"id":"emotions","kind":"scale","label":"Emotional control","min":1,"max":5},
     {"id":"competitiveness","kind":"scale","label":"Competitiveness","min":1,"max":5},
     {"id":"communication","kind":"scale","label":"Communication","min":1,"max":5},
     {"id":"notes","kind":"text","label":"Notes"}]')
on conflict (slug) where coach_id is null do nothing;

-- Rollback: drop table if exists public.player_assignments; drop table if exists public.player_questionnaire_responses;
--           drop table if exists public.player_questionnaires; drop table if exists public.questionnaire_templates;
