import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SettlementList from "@/components/SettlementList";
import type { SettlementRow } from "@/lib/types";

export default async function SettlementPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: rows, error }, { data: settings }] = await Promise.all([
    supabase.rpc("get_settlement"),
    supabase
      .from("teacher_settings")
      .select("billing_day")
      .eq("teacher_id", user!.id)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">정산</h1>
        <p className="mt-1 text-sm text-ink-soft">
          매달 {settings?.billing_day ?? 1}일 기준으로 그 사이 온 만큼 정산해요.
          정산일은{" "}
          <Link href="/t/settings" className="text-pen underline">
            설정
          </Link>
          에서 바꿀 수 있어요.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-redpen">{error.message}</p>
      ) : (
        <SettlementList rows={(rows as SettlementRow[]) ?? []} />
      )}
    </div>
  );
}
