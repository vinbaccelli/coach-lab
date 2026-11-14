-- Workouts (2026-11-14): exercise library, workout templates, the workouts planned for a player,
-- and what was actually done.
--
--   exercise_library     exercises: global ones (coach_id null, seeded below, read-only for coaches)
--                        and each coach's own. Name, description, category, muscle groups, equipment,
--                        instructions, demo video link, thumbnail, difficulty, sports, and which values
--                        a set records (reps, weight, duration, distance).
--   workout_templates    a coach's reusable workouts: title, notes, items (exercise + planned sets,
--                        reps, weight, duration, distance, rest, notes).
--   player_workouts      a workout PLANNED for a player on a date (copied from a template or made for
--                        the player; a series of dates shares a batch_id). Its items are the plan:
--                        editing the template later never changes it. status: planned | skipped
--                        (done = it has a log).
--   player_workout_logs  what was DONE: date, the exercises with the sets actually performed,
--                        duration, effort (RPE 1-10), notes; linked to the planned workout when there
--                        is one (one log per planned workout). Logged by the coach (approved) or by the
--                        player through the share link (author = 'link', submitted until reviewed).
--
-- RLS: global exercises are readable by every signed-in coach and writable by none; everything else
-- is the owning coach's only (share-link writes go through the server, scoped to the link's player).
-- Inside a policy's subquery an unqualified column resolves to the subquery's table first, so the
-- row's own columns are written with the table name (player_workout_logs.player_id).
-- Idempotent. NOT APPLIED automatically.

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references auth.users (id) on delete cascade,
  slug text check (slug is null or slug ~ '^[a-z0-9_]{1,60}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 2000),
  category text not null default 'other'
    check (category in ('strength', 'conditioning', 'speed_agility', 'plyometrics', 'core', 'mobility', 'warm_up', 'recovery', 'tennis', 'other')),
  muscle_groups text[] not null default '{}' check (cardinality(muscle_groups) <= 12),
  equipment text[] not null default '{}' check (cardinality(equipment) <= 12),
  instructions text not null default '' check (length(instructions) <= 4000),
  video_url text check (video_url is null or (length(video_url) <= 500 and video_url ~ '^https?://')),
  thumbnail_url text check (thumbnail_url is null or (length(thumbnail_url) <= 500 and thumbnail_url ~ '^https?://')),
  difficulty text not null default 'intermediate' check (difficulty in ('beginner', 'intermediate', 'advanced')),
  sports text[] not null default '{}' check (cardinality(sports) <= 12),
  log_fields text[] not null default '{reps,weight}'
    check (cardinality(log_fields) between 1 and 4 and log_fields <@ array['reps', 'weight', 'duration', 'distance']::text[]),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercise_global_has_slug check ((coach_id is null) = (slug is not null))
);
create unique index if not exists uq_exercise_global_slug on public.exercise_library (slug) where coach_id is null;
create index if not exists idx_exercise_coach on public.exercise_library (coach_id);

create table if not exists public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  notes text not null default '' check (length(notes) <= 4000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workout_templates_coach on public.workout_templates (coach_id);

create table if not exists public.player_workouts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  template_id uuid references public.workout_templates (id) on delete set null,
  batch_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  notes text not null default '' check (length(notes) <= 4000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40),
  scheduled_on date not null,
  status text not null default 'planned' check (status in ('planned', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_player_workouts_player on public.player_workouts (player_id, scheduled_on desc);
create index if not exists idx_player_workouts_coach on public.player_workouts (coach_id);

create table if not exists public.player_workout_logs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  workout_id uuid references public.player_workouts (id) on delete set null,
  performed_on date not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40),
  duration_min numeric check (duration_min is null or (duration_min >= 0 and duration_min <= 1440)),
  rpe numeric check (rpe is null or (rpe >= 1 and rpe <= 10)),
  notes text not null default '' check (length(notes) <= 2000),
  author text not null default 'coach' check (author in ('coach', 'link')),
  status text not null default 'approved' check (status in ('submitted', 'approved', 'needs_revision')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_at timestamptz,
  client_ref uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_workout_logs_player on public.player_workout_logs (player_id, performed_on desc);
create index if not exists idx_workout_logs_coach on public.player_workout_logs (coach_id);
create unique index if not exists uq_workout_logs_workout on public.player_workout_logs (workout_id) where workout_id is not null;
create unique index if not exists uq_workout_logs_client_ref on public.player_workout_logs (player_id, client_ref) where client_ref is not null;
create index if not exists idx_workout_logs_pending on public.player_workout_logs (player_id) where status <> 'approved';

alter table public.exercise_library enable row level security;
alter table public.workout_templates enable row level security;
alter table public.player_workouts enable row level security;
alter table public.player_workout_logs enable row level security;

drop policy if exists "exercise_select" on public.exercise_library;
create policy "exercise_select" on public.exercise_library for select to authenticated using (coach_id is null or coach_id = auth.uid());
drop policy if exists "exercise_insert_own" on public.exercise_library;
create policy "exercise_insert_own" on public.exercise_library for insert to authenticated with check (coach_id = auth.uid());
drop policy if exists "exercise_update_own" on public.exercise_library;
create policy "exercise_update_own" on public.exercise_library for update to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid());
drop policy if exists "exercise_delete_own" on public.exercise_library;
create policy "exercise_delete_own" on public.exercise_library for delete to authenticated using (coach_id = auth.uid());

drop policy if exists "workout_templates_select_own" on public.workout_templates;
create policy "workout_templates_select_own" on public.workout_templates for select using (auth.uid() = coach_id);
drop policy if exists "workout_templates_insert_own" on public.workout_templates;
create policy "workout_templates_insert_own" on public.workout_templates for insert with check (auth.uid() = coach_id);
drop policy if exists "workout_templates_update_own" on public.workout_templates;
create policy "workout_templates_update_own" on public.workout_templates for update using (auth.uid() = coach_id) with check (auth.uid() = coach_id);
drop policy if exists "workout_templates_delete_own" on public.workout_templates;
create policy "workout_templates_delete_own" on public.workout_templates for delete using (auth.uid() = coach_id);

drop policy if exists "player_workouts_select_own" on public.player_workouts;
create policy "player_workouts_select_own" on public.player_workouts for select using (auth.uid() = coach_id);
drop policy if exists "player_workouts_insert_own" on public.player_workouts;
create policy "player_workouts_insert_own" on public.player_workouts for insert with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  and (template_id is null or exists (select 1 from public.workout_templates t where t.id = template_id and t.coach_id = auth.uid()))
);
drop policy if exists "player_workouts_update_own" on public.player_workouts;
create policy "player_workouts_update_own" on public.player_workouts for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  and (template_id is null or exists (select 1 from public.workout_templates t where t.id = template_id and t.coach_id = auth.uid()))
);
drop policy if exists "player_workouts_delete_own" on public.player_workouts;
create policy "player_workouts_delete_own" on public.player_workouts for delete using (auth.uid() = coach_id);

drop policy if exists "workout_logs_select_own" on public.player_workout_logs;
create policy "workout_logs_select_own" on public.player_workout_logs for select using (auth.uid() = coach_id);
drop policy if exists "workout_logs_insert_own" on public.player_workout_logs;
create policy "workout_logs_insert_own" on public.player_workout_logs for insert with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  and (workout_id is null or exists (select 1 from public.player_workouts w where w.id = workout_id and w.player_id = player_workout_logs.player_id and w.coach_id = auth.uid()))
);
drop policy if exists "workout_logs_update_own" on public.player_workout_logs;
create policy "workout_logs_update_own" on public.player_workout_logs for update using (auth.uid() = coach_id) with check (
  auth.uid() = coach_id
  and exists (select 1 from public.players p where p.id = player_id and p.coach_id = auth.uid())
  and (workout_id is null or exists (select 1 from public.player_workouts w where w.id = workout_id and w.player_id = player_workout_logs.player_id and w.coach_id = auth.uid()))
);
drop policy if exists "workout_logs_delete_own" on public.player_workout_logs;
create policy "workout_logs_delete_own" on public.player_workout_logs for delete using (auth.uid() = coach_id);

-- ── Global exercises (original short texts; no external videos) ────────────────────────────────
insert into public.exercise_library (slug, name, description, category, muscle_groups, equipment, instructions, difficulty, sports, log_fields) values
  ('push_up', 'Push-up', 'Upper-body push with the body held straight.', 'strength', '{chest,shoulders,triceps,core}', '{bodyweight}', 'Hands under the shoulders, body in one line. Lower the chest to a fist above the floor, push back up without letting the hips sag.', 'beginner', '{general,tennis,padel}', '{reps}'),
  ('bodyweight_squat', 'Bodyweight squat', 'Basic squat pattern without load.', 'strength', '{quads,glutes}', '{bodyweight}', 'Feet shoulder-width, sit the hips back and down until the thighs are level, knees following the toes, then stand up tall.', 'beginner', '{general,tennis,padel}', '{reps}'),
  ('back_squat', 'Back squat', 'Loaded squat with the bar on the upper back.', 'strength', '{quads,glutes,core}', '{barbell,rack}', 'Brace before each rep, keep the chest up and the whole foot on the floor; go as deep as good form allows.', 'intermediate', '{general}', '{reps,weight}'),
  ('goblet_squat', 'Goblet squat', 'Squat holding one weight at the chest.', 'strength', '{quads,glutes,core}', '{dumbbell,kettlebell}', 'Hold the weight close to the chest, elbows inside the knees at the bottom, stand up through the whole foot.', 'beginner', '{general,tennis,padel}', '{reps,weight}'),
  ('split_squat', 'Split squat', 'Single-leg strength in a staggered stance.', 'strength', '{quads,glutes}', '{bodyweight,dumbbell}', 'Long stance, lower the back knee towards the floor with the torso upright, push through the front heel.', 'beginner', '{general,tennis,padel}', '{reps,weight}'),
  ('forward_lunge', 'Forward lunge', 'Step forward into a lunge and return.', 'strength', '{quads,glutes,adductors}', '{bodyweight,dumbbell}', 'Step forward, both knees bend to about 90 degrees, push back to the start; alternate legs.', 'beginner', '{general,tennis,padel}', '{reps,weight}'),
  ('lateral_lunge', 'Lateral lunge', 'Side-to-side lunge for court movement.', 'tennis', '{adductors,glutes,quads}', '{bodyweight,dumbbell}', 'Step wide to one side, sit into that hip with the other leg straight, push back to the middle.', 'beginner', '{tennis,padel}', '{reps,weight}'),
  ('romanian_deadlift', 'Romanian deadlift', 'Hip hinge for the back of the legs.', 'strength', '{hamstrings,glutes,lower back}', '{barbell,dumbbell}', 'Soft knees, push the hips back with a flat back until the hamstrings stretch, then drive the hips forward.', 'intermediate', '{general,tennis}', '{reps,weight}'),
  ('hip_thrust', 'Hip thrust', 'Glute strength with the upper back on a bench.', 'strength', '{glutes,hamstrings}', '{barbell,bench}', 'Chin tucked, drive the hips up until the body is flat from knees to shoulders, squeeze, lower with control.', 'intermediate', '{general,tennis}', '{reps,weight}'),
  ('pull_up', 'Pull-up', 'Vertical pull to the bar.', 'strength', '{back,biceps}', '{pull-up bar}', 'From a dead hang pull the chest towards the bar, lower all the way down; use a band to assist if needed.', 'intermediate', '{general}', '{reps,weight}'),
  ('inverted_row', 'Inverted row', 'Horizontal pull under a bar or rings.', 'strength', '{back,biceps}', '{bar,rings}', 'Body straight under the bar, pull the chest to it, lower slowly. Walk the feet forward to make it harder.', 'beginner', '{general,tennis,padel}', '{reps}'),
  ('dumbbell_row', 'One-arm dumbbell row', 'Unilateral row with support on a bench.', 'strength', '{back,biceps}', '{dumbbell,bench}', 'Flat back, pull the elbow towards the hip, pause, lower without twisting.', 'beginner', '{general,tennis}', '{reps,weight}'),
  ('bench_press', 'Bench press', 'Horizontal press with a barbell.', 'strength', '{chest,triceps,shoulders}', '{barbell,bench}', 'Shoulder blades back, lower the bar to the lower chest, press up; use a spotter for heavy sets.', 'intermediate', '{general}', '{reps,weight}'),
  ('overhead_press', 'Overhead press', 'Standing press above the head.', 'strength', '{shoulders,triceps,core}', '{barbell,dumbbell}', 'Squeeze glutes and core, press straight up, finish with the arms by the ears.', 'intermediate', '{general}', '{reps,weight}'),
  ('plank', 'Plank', 'Hold the body straight on the forearms.', 'core', '{core}', '{bodyweight}', 'Elbows under the shoulders, body in one line, breathe; stop when the hips drop.', 'beginner', '{general,tennis,padel}', '{duration}'),
  ('side_plank', 'Side plank', 'Lateral core hold.', 'core', '{obliques,core}', '{bodyweight}', 'Elbow under the shoulder, hips high, body in one line; both sides.', 'beginner', '{general,tennis,padel}', '{duration}'),
  ('dead_bug', 'Dead bug', 'Core control lying on the back.', 'core', '{core}', '{bodyweight}', 'Lower back pressed to the floor, extend the opposite arm and leg slowly, return, switch.', 'beginner', '{general,tennis,padel}', '{reps}'),
  ('pallof_press', 'Pallof press', 'Anti-rotation press with a band.', 'core', '{core,obliques}', '{band,cable}', 'Stand side-on to the anchor, press the hands straight out without letting the band turn you, return.', 'beginner', '{tennis,padel,general}', '{reps,weight}'),
  ('med_ball_rotational_throw', 'Medicine ball rotational throw', 'Explosive rotation like a groundstroke.', 'tennis', '{core,hips,shoulders}', '{medicine ball,wall}', 'Side-on to a wall, load the back hip, rotate hard through the hips and throw; catch and reset.', 'intermediate', '{tennis,padel}', '{reps,weight}'),
  ('med_ball_overhead_throw', 'Medicine ball overhead throw', 'Explosive overhead throw like a serve.', 'plyometrics', '{shoulders,core,back}', '{medicine ball}', 'Ball behind the head, step and throw forward as far as possible with the whole body.', 'intermediate', '{tennis,padel}', '{reps,weight}'),
  ('box_jump', 'Box jump', 'Jump onto a box and step down.', 'plyometrics', '{quads,glutes,calves}', '{box}', 'Swing the arms, jump and land softly on the box in a half squat, step down; quality over height.', 'intermediate', '{general,tennis}', '{reps}'),
  ('lateral_bound', 'Lateral bound', 'Side-to-side single-leg jumps.', 'plyometrics', '{glutes,quads,adductors}', '{bodyweight}', 'Push off one leg sideways, land on the other and hold one second, then bound back.', 'intermediate', '{tennis,padel}', '{reps}'),
  ('jump_rope', 'Jump rope', 'Footwork and conditioning with a rope.', 'conditioning', '{calves,shoulders}', '{jump rope}', 'Small quick jumps on the balls of the feet; vary with single leg and side to side.', 'beginner', '{general,tennis,padel}', '{duration}'),
  ('sprint_20m', '20 m sprint', 'Short maximal sprint.', 'speed_agility', '{legs}', '{cones}', 'From a split stance, sprint 20 m flat out; walk back and rest fully between reps.', 'beginner', '{general,tennis,padel}', '{duration,distance}'),
  ('shuttle_5_10_5', '5-10-5 shuttle', 'Change-of-direction test (pro agility).', 'speed_agility', '{legs}', '{cones}', 'Start in the middle, sprint 5 m to one side, 10 m to the other, 5 m back through the middle; time it.', 'intermediate', '{general,tennis,padel}', '{duration}'),
  ('split_step_reaction', 'Split-step reaction drill', 'Split step then react to a signal.', 'tennis', '{legs}', '{cones}', 'Partner points or calls a direction at the split step; first two steps fast towards it, recover to the middle.', 'beginner', '{tennis,padel}', '{reps,duration}'),
  ('spider_run', 'Spider run', 'Court agility to five cones and back.', 'speed_agility', '{legs}', '{cones}', 'From the centre of the baseline run to each cone and back to the centre; time the full circuit.', 'intermediate', '{tennis,padel}', '{duration}'),
  ('band_external_rotation', 'Band external rotation', 'Shoulder prehab for the rotator cuff.', 'tennis', '{rotator cuff,shoulders}', '{band}', 'Elbow at the side bent to 90 degrees, rotate the forearm out against the band, slowly back.', 'beginner', '{tennis,padel}', '{reps}'),
  ('wrist_curl', 'Wrist curl and reverse curl', 'Forearm strength for the racket arm.', 'strength', '{forearms}', '{dumbbell}', 'Forearm on the thigh, curl the wrist up, lower slowly; then palms down for the reverse curl.', 'beginner', '{tennis,padel}', '{reps,weight}'),
  ('thoracic_rotation', 'Thoracic rotation (open book)', 'Upper-back rotation mobility.', 'mobility', '{upper back}', '{bodyweight}', 'Lying on the side with knees bent, open the top arm across to the other side following it with the eyes, return.', 'beginner', '{general,tennis,padel}', '{reps}'),
  ('hip_90_90', '90/90 hip switch', 'Hip rotation mobility.', 'mobility', '{hips}', '{bodyweight}', 'Sit with both knees at 90 degrees to one side, rotate both knees to the other side keeping the chest tall.', 'beginner', '{general,tennis,padel}', '{reps}'),
  ('hamstring_stretch', 'Hamstring stretch', 'Static stretch for the back of the legs.', 'recovery', '{hamstrings}', '{bodyweight}', 'Leg straight on a low step, hinge forward with a flat back until a gentle stretch; breathe.', 'beginner', '{general,tennis,padel}', '{duration}'),
  ('foam_rolling', 'Foam rolling', 'Self-massage after training.', 'recovery', '{legs,back}', '{foam roller}', 'Roll slowly over each muscle group, pausing on tight spots; no rolling on joints or the lower back.', 'beginner', '{general,tennis,padel}', '{duration}'),
  ('dynamic_warm_up', 'Dynamic warm-up', 'Jogging, skips and leg swings before play.', 'warm_up', '{full body}', '{bodyweight}', 'Easy jog, skips, carioca, leg swings and arm circles, building up the pace for 8 to 10 minutes.', 'beginner', '{general,tennis,padel}', '{duration}'),
  ('easy_run', 'Easy run', 'Steady aerobic run.', 'conditioning', '{legs,heart}', '{none}', 'Conversational pace; note the distance and time.', 'beginner', '{general,tennis,padel}', '{duration,distance}'),
  ('interval_run', 'Interval run', 'Repeated fast efforts with recovery.', 'conditioning', '{legs,heart}', '{none}', 'For example 6 x 200 m fast with 200 m walk between; log each rep.', 'intermediate', '{general,tennis,padel}', '{duration,distance}')
on conflict (slug) where coach_id is null do nothing;

-- Rollback: drop table if exists public.player_workout_logs; drop table if exists public.player_workouts;
--           drop table if exists public.workout_templates; drop table if exists public.exercise_library;
