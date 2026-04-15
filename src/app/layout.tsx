import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NovaForge AI Portal - Hệ Thống Quản Trị Tập Trung",
  description: "Giải pháp quản lý nhân sự và công cụ AI cho NovaForge AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-ink-50" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
