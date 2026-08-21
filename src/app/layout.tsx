import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { AppHeader } from "@/components/app-header";
import { NotificationWatcher } from "@/components/notification-watcher";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "정기 업무 관리 대시보드",
  description:
    "매년·매분기·매월 반복되는 정형 업무를 1년 단위로 조망하고 관리하는 사내 대시보드",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background">
        <TooltipProvider delayDuration={200}>
          {/*
            AppHeader 는 연도 컨텍스트를 유지하기 위해 useSearchParams() 를 쓴다.
            정적 생성 대상 페이지(예: 404)에서도 프리렌더가 가능하도록 Suspense 로 감싼다.
            fallback 은 같은 높이의 껍데기를 그려 레이아웃 이동을 막는다.
          */}
          <Suspense
            fallback={<div className="h-14 border-b bg-background" aria-hidden />}
          >
            <AppHeader />
          </Suspense>
          <main className="flex-1">{children}</main>
          {/* 브라우저 알림 폴링 (WEB_PUSH 어댑터의 클라이언트 측) */}
          <NotificationWatcher />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
