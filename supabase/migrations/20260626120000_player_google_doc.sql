-- Per-player Google Doc + Drive folder references for the
-- AngleMotion/Players/<Name>/<Doc> integration. The app reuses these IDs so
-- every screenshot for a player is appended to the same document.

alter table public.players
  add column if not exists google_doc_id text,
  add column if not exists google_folder_id text;
