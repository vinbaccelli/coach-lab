/** Columns the workout routes return (no coach ids, no client refs). */
export const EXERCISE_COLS = 'id,coach_id,slug,name,description,category,muscle_groups,equipment,instructions,video_url,thumbnail_url,difficulty,sports,log_fields,archived_at,created_at,updated_at';
export const TEMPLATE_COLS = 'id,title,notes,items,archived_at,created_at,updated_at';
export const WORKOUT_COLS = 'id,player_id,template_id,batch_id,title,notes,items,scheduled_on,status,created_at,updated_at';
export const LOG_COLS = 'id,player_id,workout_id,performed_on,title,items,duration_min,rpe,notes,author,status,review_note,created_at,updated_at';
