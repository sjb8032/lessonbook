import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppNav from "@/components/AppNav";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");
  if (profile.role !== "student") redirect("/t/schedule");

  return (
    <div>
      <AppNav role="student" name={profile.name} />
      <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>
    </div>
  );
}
