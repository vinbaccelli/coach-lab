-- Academy Q&A Forum tables

create table if not exists academy_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  user_name text not null default '',
  title text not null,
  body text not null default '',
  category text not null default 'general',
  upvotes int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists academy_replies (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references academy_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  user_name text not null default '',
  body text not null,
  is_coach_answer boolean not null default false,
  upvotes int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists academy_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid references academy_questions(id) on delete cascade,
  reply_id uuid references academy_replies(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, question_id),
  unique(user_id, reply_id)
);

-- RLS
alter table academy_questions enable row level security;
alter table academy_replies enable row level security;
alter table academy_votes enable row level security;

create policy "Anyone can read questions" on academy_questions for select using (true);
create policy "Auth users can insert questions" on academy_questions for insert with check (auth.uid() = user_id);
create policy "Users can delete own questions" on academy_questions for delete using (auth.uid() = user_id);

create policy "Anyone can read replies" on academy_replies for select using (true);
create policy "Auth users can insert replies" on academy_replies for insert with check (auth.uid() = user_id);
create policy "Users can delete own replies" on academy_replies for delete using (auth.uid() = user_id);

create policy "Anyone can read votes" on academy_votes for select using (true);
create policy "Auth users can manage own votes" on academy_votes for insert with check (auth.uid() = user_id);
create policy "Users can delete own votes" on academy_votes for delete using (auth.uid() = user_id);

create index if not exists idx_academy_replies_question on academy_replies(question_id);
create index if not exists idx_academy_votes_question on academy_votes(question_id);
create index if not exists idx_academy_votes_reply on academy_votes(reply_id);
