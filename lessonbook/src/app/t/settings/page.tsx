import { createClient } from "@/lib/supabase/server";
import SettingsForm from "@/components/SettingsForm";
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
      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="text-sm text-ink-soft">수강생 가입 코드</p>
        <p className="num mt-1 text-2xl font-bold tracking-[0.3em]">
          {settings.join_code}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          이 코드를 학생에게 알려주면 앱에서 바로 연결돼요
        </p>
      </div>
      <div className="rounded-2xl border border-line bg-card p-4">
        <SettingsForm initial={settings} />
      </div>
    </div>
  );
}
