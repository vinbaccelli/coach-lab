import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAYER_ASSETS_BUCKET } from '@/lib/sessions/storagePaths';

export async function uploadSessionAsset(
  supabase: SupabaseClient,
  storagePath: string,
  blob: Blob,
  contentType: string,
): Promise<{ publicUrl?: string }> {
  const { error } = await supabase.storage
    .from(PLAYER_ASSETS_BUCKET)
    .upload(storagePath, blob, {
      contentType,
      upsert: true,
    });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(PLAYER_ASSETS_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl };
}

export async function deleteSessionAssets(
  supabase: SupabaseClient,
  storagePaths: string[],
): Promise<void> {
  if (storagePaths.length === 0) return;
  const { error } = await supabase.storage.from(PLAYER_ASSETS_BUCKET).remove(storagePaths);
  if (error) throw new Error(error.message);
}
