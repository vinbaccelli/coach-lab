'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import {
  compareToTargets, dayTotals, isHistory, MEAL_LABELS, planForDate, playerCanChangeMeal, shiftDay,
  type MealLog, type NutritionPlan, type NutritionPlanInput, type PlanTargets,
} from '@/lib/players/nutrition';
import { badge, card, chip, dashedBtn, ghostBtn, h2, iconBtn, input, muted, panel, primaryBtn, shortDate, todayLocal } from '@/components/players/ui';
import SetupNotice from '@/components/players/SetupNotice';
import PlanEditor from '@/components/players/nutrition/PlanEditor';
import MealForm from '@/components/players/nutrition/MealForm';
import { MeterList, WeekStrip } from '@/components/players/nutrition/NutritionCharts';
import type { NutritionClient } from '@/components/players/nutrition/nutritionClient';

type PlanEdit = { heading: string; initial: NutritionPlanInput; plan?: NutritionPlan; replaces?: NutritionPlan; hint?: string };

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const period = (p: Pick<NutritionPlan, 'starts_on' | 'ends_on'>) => (p.ends_on ? `${shortDate(p.starts_on)} – ${shortDate(p.ends_on)}` : `From ${shortDate(p.starts_on)}`);
const pill: CSSProperties = { fontSize: 12, padding: '3px 9px', borderRadius: 999, background: 'rgba(118,118,128,0.12)', fontVariantNumeric: 'tabular-nums' };
const small: CSSProperties = { ...chip, display: 'inline-flex', alignItems: 'center', gap: 4 };

function normPlan(p: NutritionPlan): NutritionPlan {
  const t = (p.targets ?? {}) as Partial<PlanTargets>;
  return {
    ...p,
    targets: { calories: t.calories ?? null, protein_g: t.protein_g ?? null, carbs_g: t.carbs_g ?? null, fat_g: t.fat_g ?? null, custom: Array.isArray(t.custom) ? t.custom : [] },
    meals: Array.isArray(p.meals) ? p.meals : [],
    notes: p.notes ?? '',
  };
}

function targetsText(t: PlanTargets): string[] {
  const out: string[] = [];
  if (t.calories !== null) out.push(`${fmt(t.calories)} kcal`);
  if (t.protein_g !== null) out.push(`${fmt(t.protein_g)} g protein`);
  if (t.carbs_g !== null) out.push(`${fmt(t.carbs_g)} g carbs`);
  if (t.fat_g !== null) out.push(`${fmt(t.fat_g)} g fat`);
  for (const c of t.custom) if (c.target !== null) out.push(`${c.label} ${fmt(c.target)}${c.unit ? ` ${c.unit}` : ''}`);
  return out;
}

function planState(p: NutritionPlan, current: NutritionPlan | null, today: string): { label: string; tone: 'pending' | 'warn' | 'info' | 'ok' } {
  if (p.status === 'draft') return { label: 'Draft', tone: 'pending' };
  if (p.status === 'archived') return { label: 'Archived', tone: 'info' };
  if (current && p.id === current.id) return { label: 'Current', tone: 'ok' };
  if (p.starts_on > today) return { label: 'Upcoming', tone: 'info' };
  if (isHistory(p, today)) return { label: 'Ended', tone: 'info' };
  return { label: 'Not in force', tone: 'info' };
}

const blankPlan = (today: string): NutritionPlanInput => ({
  title: '', starts_on: today, ends_on: null, status: 'active',
  targets: { calories: null, protein_g: null, carbs_g: null, fat_g: null, custom: [] }, meals: [], notes: '',
});
const copyOf = (p: NutritionPlan, over: Partial<NutritionPlanInput>): NutritionPlanInput => ({
  title: p.title, starts_on: p.starts_on, ends_on: p.ends_on, status: p.status === 'archived' ? 'active' : p.status,
  targets: p.targets, meals: p.meals, notes: p.notes, ...over,
});

function PlanDetails({ plan }: { plan: NutritionPlan }) {
  const t = targetsText(plan.targets);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {t.length ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Daily targets">{t.map((x) => <span key={x} style={pill}>{x}</span>)}</div>
      ) : <div style={muted}>No daily targets.</div>}
      {plan.meals.length ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {plan.meals.map((m) => (
            <div key={m.id} style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{m.time ? `${m.time} · ` : ''}{m.name}</span>
              {m.description ? <div style={{ whiteSpace: 'pre-wrap', color: 'var(--cl-text-secondary)' }}>{m.description}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {plan.notes ? <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', borderLeft: '3px solid var(--cl-border)', paddingLeft: 8 }}>{plan.notes}</div> : null}
    </div>
  );
}

/**
 * Nutrition of one player: the plan in force (with its versions and other plans) and the meal
 * diary of a day (totals against the plan's targets, the last 7 days). Used by the coach on the
 * profile and by the player on the share page; `client` decides what each may do.
 */
export default function NutritionSection({ client }: { client: NutritionClient }) {
  const today = todayLocal();
  const coach = client.viewer === 'coach';
  const [day, setDay] = useState(today);
  const [plans, setPlans] = useState<NutritionPlan[] | null>(null);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [toFix, setToFix] = useState<MealLog[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [canLog, setCanLog] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [planEdit, setPlanEdit] = useState<PlanEdit | null>(null);
  const [mealEdit, setMealEdit] = useState<{ meal: MealLog | null } | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [fixFor, setFixFor] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState('');
  const [busy, setBusy] = useState(false);

  const from = shiftDay(day, -6);
  const load = useCallback(async () => {
    try {
      const d = await client.load(from, day);
      setPlans(d.plans.map(normPlan));
      setMeals(d.meals);
      setToFix(d.toFix ?? []);
      setSetupNeeded(d.setupNeeded);
      setCanLog(d.canLog);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
      setPlans((p) => p ?? []);
    }
  }, [client, from, day]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const list = useMemo(() => plans ?? [], [plans]);
  const current = planForDate(list, today);
  const dayPlan = planForDate(list, day);
  const dayMeals = meals.filter((m) => m.eaten_on === day);
  const rows = compareToTargets(dayTotals(dayMeals), dayPlan?.targets ?? null);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, i - 6)).map((d) => {
    const ms = meals.filter((m) => m.eaten_on === d);
    return { day: d, label: weekday(d), value: dayTotals(ms).calories, target: planForDate(list, d)?.targets.calories ?? null, meals: ms.length };
  });
  const others = list.filter((p) => p.id !== current?.id);
  const waiting = dayMeals.filter((m) => m.author === 'link' && m.status === 'submitted');
  const customLabels = useMemo(() => {
    const m = new Map<string, { label: string; unit: string }>();
    for (const p of list) for (const c of p.targets.custom) if (!m.has(c.id)) m.set(c.id, { label: c.label, unit: c.unit });
    return m;
  }, [list]);
  const canChange = (m: MealLog) => Boolean(client.saveMeal) && (coach || playerCanChangeMeal(m));

  const mealLine = (m: MealLog) => [
    m.calories !== null ? `${fmt(m.calories)} kcal` : null,
    m.protein_g !== null ? `P ${fmt(m.protein_g)} g` : null,
    m.carbs_g !== null ? `C ${fmt(m.carbs_g)} g` : null,
    m.fat_g !== null ? `F ${fmt(m.fat_g)} g` : null,
    ...Object.entries(m.extras ?? {}).map(([k, v]) => {
      const c = customLabels.get(k);
      return c ? `${c.label} ${fmt(v)}${c.unit ? ` ${c.unit}` : ''}` : null;
    }),
  ].filter(Boolean).join(' · ');

  const saveMeal = async (meal: MealLog | null, draft: Record<string, unknown>, photo: Blob | null, removePhoto: boolean) => {
    await client.saveMeal!(draft, { meal: meal ?? undefined, photo, removePhoto });
    setMealEdit(null);
    if (typeof draft.eaten_on === 'string' && draft.eaten_on !== day) setDay(draft.eaten_on);
    else await load();
  };

  const mealForm = (meal: MealLog | null) => (
    <MealForm
      meal={meal}
      date={meal?.eaten_on ?? day}
      customTargets={planForDate(list, meal?.eaten_on ?? day)?.targets.custom ?? []}
      onSave={(d, p, r) => saveMeal(meal, d, p, r)}
      onCancel={() => setMealEdit(null)}
    />
  );

  const planActions = (p: NutritionPlan) => {
    if (!coach || !client.savePlan) return null;
    const history = isHistory(p, today);
    const isCurrent = current?.id === p.id;
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!history ? <button type="button" onClick={() => setPlanEdit({ heading: 'Edit plan', plan: p, initial: copyOf(p, {}) })} style={small}><Pencil size={12} /> Edit</button> : null}
        {isCurrent ? (
          <button type="button" onClick={() => setPlanEdit({
            heading: 'New version', replaces: p,
            initial: copyOf(p, { starts_on: today > p.starts_on ? today : shiftDay(p.starts_on, 1), ends_on: null, status: 'active' }),
            hint: `“${p.title}” ends the day before the new version starts and stays in the history exactly as it is.`,
          })} style={small}>New version</button>
        ) : null}
        <button type="button" onClick={() => setPlanEdit({ heading: 'Duplicate plan', initial: copyOf(p, { title: `${p.title} (copy)`.slice(0, 120), starts_on: today, ends_on: null, status: 'draft' }) })} style={small}>Duplicate</button>
        {p.status === 'archived'
          ? <button type="button" disabled={busy} onClick={() => void act(() => client.setPlanStatus!(p, 'active'))} style={small}>Restore</button>
          : <button type="button" disabled={busy} onClick={() => void act(() => client.setPlanStatus!(p, 'archived'))} style={small}>Archive</button>}
        <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete the plan “${p.title}”? This cannot be undone. Meals stay.`)) void act(() => client.deletePlan!(p)); }} style={{ ...small, color: '#b3261e' }}><Trash2 size={12} /> Delete</button>
      </div>
    );
  };

  return (
    <section style={{ ...panel, marginBottom: 18, display: 'grid', gap: 14 }} aria-label="Nutrition" data-testid="nutrition-section">
      <div>
        <h2 style={h2}>Nutrition</h2>
        <p style={{ ...muted, margin: '4px 0 0' }}>
          {coach
            ? 'A plan with daily targets, and what the player eats each day. To change a plan from a date, make a new version: the old one stays as it was.'
            : 'Your nutrition plan from your coach, and what you eat each day.'}
        </p>
      </div>
      {setupNeeded ? <SetupNotice what="Nutrition" /> : null}
      {err ? <div role="alert" style={{ fontSize: 12, color: '#b3261e' }}>{err}</div> : null}
      {plans === null ? <div style={muted}>Loading…</div> : null}

      {!setupNeeded && plans !== null ? (
        <>
          {!coach && toFix.length ? (
            <div role="status" style={{ ...card, borderColor: 'rgba(255,59,48,0.35)', background: 'rgba(255,59,48,0.05)' }}>
              <strong style={{ fontSize: 13 }}>Your coach asked you to fix {toFix.length === 1 ? 'one meal' : `${toFix.length} meals`}.</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {[...new Set(toFix.map((m) => m.eaten_on))].map((d) => (
                  <button key={d} type="button" onClick={() => setDay(d)} style={chip}>{shortDate(d)}</button>
                ))}
              </div>
            </div>
          ) : null}

          {planEdit ? (
            <PlanEditor
              heading={planEdit.heading}
              initial={planEdit.initial}
              hint={planEdit.hint}
              onCancel={() => setPlanEdit(null)}
              onSave={async (input) => {
                await client.savePlan!(input, { plan: planEdit.plan, replaces: planEdit.replaces });
                setPlanEdit(null);
                await load();
              }}
            />
          ) : (
            <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="current-plan">
              {current ? (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{current.title}</strong>
                    <span style={muted}>{period(current)}</span>
                  </div>
                  <PlanDetails plan={current} />
                  {planActions(current)}
                </>
              ) : (
                <div style={muted}>{coach ? 'No plan in force today.' : 'Your coach has not shared a nutrition plan yet.'}</div>
              )}
              {coach && client.savePlan && !current ? (
                <div><button type="button" onClick={() => setPlanEdit({ heading: 'New plan', initial: blankPlan(today) })} style={primaryBtn}><Plus size={14} /> Create a plan</button></div>
              ) : null}
            </div>
          )}

          {others.length || (coach && client.savePlan && current) ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {others.length ? (
                <button type="button" aria-expanded={showOther} onClick={() => setShowOther((v) => !v)} style={chip}>
                  {showOther ? 'Hide' : 'Show'} other plans ({others.length})
                </button>
              ) : null}
              {coach && client.savePlan && current && !planEdit ? (
                <button type="button" onClick={() => setPlanEdit({ heading: 'New plan', initial: blankPlan(today) })} style={{ ...dashedBtn, padding: '5px 10px', fontSize: 12 }}><Plus size={13} /> New plan</button>
              ) : null}
            </div>
          ) : null}
          {showOther && others.length ? (
            <div style={{ display: 'grid', gap: 8 }} data-testid="other-plans">
              {others.map((p) => {
                const st = planState(p, current, today);
                const open = openPlan === p.id;
                return (
                  <div key={p.id} style={{ ...card, display: 'grid', gap: 8, padding: 12 }}>
                    <button type="button" aria-expanded={open} onClick={() => setOpenPlan(open ? null : p.id)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--cl-text-primary)' }}>
                      <strong style={{ fontSize: 14 }}>{p.title}</strong>
                      <span style={badge(st.tone)}>{st.label}</span>
                      <span style={muted}>{period(p)}</span>
                    </button>
                    {open ? <PlanDetails plan={p} /> : null}
                    {open ? planActions(p) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div style={{ ...card, display: 'grid', gap: 12 }} data-testid="meal-day">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))} style={iconBtn}><ChevronLeft size={20} /></button>
              <input type="date" value={day} max={today} onChange={(e) => { if (e.target.value) setDay(e.target.value > today ? today : e.target.value); }} aria-label="Day" style={{ ...input, flex: '1 1 auto', textAlign: 'center' }} />
              <button type="button" aria-label="Next day" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))} style={{ ...iconBtn, opacity: day >= today ? 0.3 : 1 }}><ChevronRight size={20} /></button>
              {day !== today ? <button type="button" onClick={() => setDay(today)} style={chip}>Today</button> : null}
            </div>
            <div style={muted}>{dayPlan ? `Targets from “${dayPlan.title}”` : 'No plan on this day: totals only.'}</div>
            <MeterList rows={rows} />

            {dayMeals.length === 0 ? <div style={muted}>Nothing logged on this day.</div> : null}
            <div style={{ display: 'grid', gap: 10 }}>
              {dayMeals.map((m) => (
                <div key={m.id} data-testid="meal-row" style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 10, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
                      {m.eaten_at ? <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--cl-text-secondary)' }}>{m.eaten_at.slice(0, 5)}</span> : null}
                      <strong style={{ fontSize: 13 }}>{MEAL_LABELS[m.category] ?? m.category}</strong>
                      {m.author === 'link' ? <span style={badge('info')}>{coach ? 'Player' : 'You'}</span> : null}
                      {m.author === 'link' && m.status === 'submitted' ? <span style={badge('pending')}>{coach ? 'To review' : 'Waiting for review'}</span> : null}
                      {m.status === 'needs_revision' ? <span style={badge('warn')}>Needs a fix</span> : null}
                    </div>
                    {canChange(m) && mealEdit?.meal?.id !== m.id ? (
                      <div style={{ display: 'flex', flex: '0 0 auto' }}>
                        <button type="button" aria-label="Edit meal" onClick={() => setMealEdit({ meal: m })} style={iconBtn}><Pencil size={15} /></button>
                        <button type="button" aria-label="Delete meal" disabled={busy} onClick={() => { if (window.confirm('Delete this meal?')) void act(() => client.deleteMeal!(m)); }} style={iconBtn}><Trash2 size={15} /></button>
                      </div>
                    ) : null}
                  </div>
                  {mealEdit?.meal?.id === m.id ? mealForm(m) : (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {m.photo_url ? (
                        <a href={m.photo_url} target="_blank" rel="noreferrer" style={{ flex: '0 0 auto' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.photo_url} alt={`Photo of the ${MEAL_LABELS[m.category]?.toLowerCase() ?? 'meal'}`} loading="lazy" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                        </a>
                      ) : null}
                      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        {m.description ? <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.description}</div> : null}
                        {mealLine(m) ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)' }}>{mealLine(m)}</div> : null}
                        {m.note ? <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', overflowWrap: 'anywhere' }}>“{m.note}”</div> : null}
                        {m.status === 'needs_revision' && m.review_note ? <div style={{ fontSize: 12, color: '#b3261e' }}>{coach ? 'You asked: ' : 'Coach: '}{m.review_note}</div> : null}
                      </div>
                    </div>
                  )}
                  {coach && client.reviewMeal && m.author === 'link' && m.status === 'submitted' && mealEdit?.meal?.id !== m.id ? (
                    fixFor === m.id ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input autoFocus value={fixNote} onChange={(e) => setFixNote(e.target.value)} placeholder="What should the player change?" style={{ ...input, flex: '1 1 200px' }} aria-label="What should the player change?" />
                        <button type="button" disabled={!fixNote.trim() || busy} onClick={() => void act(async () => { await client.reviewMeal!(m, 'needs_revision', fixNote.trim()); setFixFor(null); setFixNote(''); })} style={primaryBtn}>Send</button>
                        <button type="button" onClick={() => setFixFor(null)} style={ghostBtn}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" disabled={busy} onClick={() => void act(() => client.reviewMeal!(m, 'approved'))} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Approve</button>
                        <button type="button" disabled={busy} onClick={() => { setFixFor(m.id); setFixNote(''); }} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}><Undo2 size={13} /> Ask for a fix</button>
                      </div>
                    )
                  ) : null}
                </div>
              ))}
            </div>
            {coach && client.approveMeals && waiting.length > 1 ? (
              <div><button type="button" disabled={busy} onClick={() => void act(() => client.approveMeals!(waiting.map((m) => m.id)))} style={{ ...ghostBtn, padding: '6px 12px', fontSize: 12 }}><Check size={13} /> Approve the {waiting.length} meals of this day</button></div>
            ) : null}
            {mealEdit && mealEdit.meal === null ? mealForm(null) : canLog && client.saveMeal ? (
              <div><button type="button" onClick={() => setMealEdit({ meal: null })} style={dashedBtn}><Plus size={14} /> Add a meal</button></div>
            ) : null}
            <WeekStrip days={week} selected={day} onSelect={setDay} />
          </div>
        </>
      ) : null}
    </section>
  );
}
