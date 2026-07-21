import { createClient } from "@/lib/supabase/server";
import SettingsForm from "@/components/SettingsForm";
import ShareJoinCode from "@/components/ShareJoinCode";
import type { TeacherSettings } from "@/lib/types";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("teacher_settings")
    .select("*")
    .eq("teacher_id", user!.id)
    .single();
  const settings = data as TeacherSettings;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">설정</h1>
      <ShareJoinCode code={settings.join_code} />
      <div className="rounded-2xl border border-line bg-card p-4">
        <SettingsForm initial={settings} />
      </div>
    </div>
  );
}
