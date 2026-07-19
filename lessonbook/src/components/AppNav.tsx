import Link from "next/link";
import NotificationsButton from "./NotificationsButton";
import type { Role } from "@/lib/types";

const TABS: Record<Role, { href: string; label: string }[]> = {
  teacher: [
    { href: "/t/schedule", label: "스케줄" },
    { href: "/t/requests", label: "승인" },
    { href: "/t/students", label: "학생" },
    { href: "/t/settings", label: "설정" },
  ],
  student: [
    { href: "/s/schedule", label: "스케줄" },
    { href: "/s/swaps", label: "교환" },
    { href: "/s/me", label: "내 수강" },
  ],
};

export default function AppNav({ role, name }: { role: Role; name: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-bold tracking-tight">레슨북</span>
          <span className="text-sm text-ink-soft">
            {name} {role === "teacher" ? "선생님" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationsButton />
          <form action="/auth/signout" method="post">
            <button className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-line/50">
              로그아웃
            </button>
          </form>
        </div>
      </div>
      <nav className="mx-auto flex max-w-2xl gap-1 px-2 pb-2">
        {TABS[role].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-ink-soft hover:bg-pen-soft hover:text-pen"
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
