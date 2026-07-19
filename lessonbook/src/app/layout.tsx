import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "레슨북",
  description: "레슨 예약, 회차, 일지를 한 곳에서",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
