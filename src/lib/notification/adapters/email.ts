/**
 * 이메일 어댑터
 * ============================================================================
 *
 * `EMAIL_TRANSPORT` 환경변수로 전송 방식을 고른다:
 *   console (기본) — 콘솔에 출력만 한다. SMTP 설정 없이 즉시 동작 확인 가능.
 *   file           — .mail-outbox/ 에 .eml 파일로 저장한다. 실제 메일 형식 확인용.
 *   smtp           — nodemailer 로 실제 발송한다. SMTP_* 설정이 필요하다.
 *
 * 로컬 개발 기본값을 console 로 둔 이유: 요구사항이
 * `npm install && npm run dev` 만으로 실행 가능해야 한다고 명시하므로,
 * 외부 서비스 설정 없이 알림 흐름 전체를 검증할 수 있어야 한다.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatKoreanFull } from "@/lib/date/plain-date";
import type {
  NotificationChannelAdapter,
  NotificationPayload,
  SendResult,
} from "../types";

type Transport = "console" | "file" | "smtp";

function getTransport(): Transport {
  const raw = (process.env.EMAIL_TRANSPORT ?? "console").toLowerCase();
  if (raw === "file" || raw === "smtp") return raw;
  return "console";
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM ?? "정기업무 대시보드 <no-reply@example.com>";
}

const OUTBOX_DIR = path.join(process.cwd(), ".mail-outbox");

/** 파일명에 쓸 수 없는 문자를 제거한다. */
function safeFileName(value: string): string {
  return value.replace(/[^\w가-힣.-]+/g, "_").slice(0, 80);
}

function buildSubject(payload: NotificationPayload): string {
  const { daysUntilDue } = payload.occurrence;
  const prefix =
    payload.kind === "OVERDUE_REMINDER"
      ? `[지연 ${Math.abs(daysUntilDue)}일]`
      : payload.kind === "DEPENDENCY_UNBLOCKED"
        ? "[착수 가능]"
        : daysUntilDue === 0
          ? "[당일]"
          : daysUntilDue > 0
            ? `[D-${daysUntilDue}]`
            : `[지연 ${Math.abs(daysUntilDue)}일]`;

  return `${prefix} ${payload.task.title}`;
}

function buildTextBody(payload: NotificationPayload): string {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  return [
    payload.body,
    "",
    "─".repeat(40),
    `업무      : ${payload.task.title}`,
    `마감일    : ${formatKoreanFull(payload.occurrence.scheduledDate)}`,
    `담당자    : ${payload.recipient.name}`,
    `상세 보기 : ${baseUrl}${payload.linkPath}`,
    "",
    "이 메일은 사내 정기 업무 관리 대시보드에서 자동 발송되었습니다.",
  ].join("\n");
}

export const emailAdapter: NotificationChannelAdapter = {
  id: "EMAIL",
  label: "이메일",
  description: "담당자 이메일로 발송합니다.",

  isAvailable(payload) {
    if (!payload.recipient.email) {
      return { ok: false, reason: "담당자에게 이메일 주소가 없습니다." };
    }
    if (getTransport() === "smtp" && !process.env.SMTP_HOST) {
      return { ok: false, reason: "SMTP_HOST 환경변수가 설정되지 않았습니다." };
    }
    return { ok: true };
  },

  async send(payload): Promise<SendResult> {
    const transport = getTransport();
    const subject = buildSubject(payload);
    const text = buildTextBody(payload);
    const to = payload.recipient.email!;

    // --- console -------------------------------------------------------
    if (transport === "console") {
      console.log(
        [
          "",
          "┌─── 📧 이메일 발송 (console 모드) ───────────────────────────",
          `│ 받는 사람 : ${payload.recipient.name} <${to}>`,
          `│ 제목      : ${subject}`,
          "├────────────────────────────────────────────────────────────",
          ...text.split("\n").map((line) => `│ ${line}`),
          "└────────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return { ok: true, detail: "console 출력" };
    }

    // --- file ----------------------------------------------------------
    if (transport === "file") {
      try {
        await mkdir(OUTBOX_DIR, { recursive: true });
        // 파일명에 타임스탬프를 쓰지 않고 dedupe 가능한 식별자를 쓴다.
        const fileName = `${safeFileName(payload.occurrence.id)}_${safeFileName(
          payload.kind,
        )}.eml`;
        const eml = [
          `From: ${getFromAddress()}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          text,
        ].join("\r\n");

        await writeFile(path.join(OUTBOX_DIR, fileName), eml, "utf8");
        return { ok: true, detail: `.mail-outbox/${fileName}` };
      } catch (error) {
        return {
          ok: false,
          error: `메일 파일 저장 실패: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }

    // --- smtp ----------------------------------------------------------
    try {
      // nodemailer 는 SMTP 모드에서만 필요하므로 지연 로드한다.
      // (console/file 모드에서 불필요한 모듈 로딩을 피한다)
      const nodemailer = await import("nodemailer");

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      });

      const info = await transporter.sendMail({
        from: getFromAddress(),
        to,
        subject,
        text,
      });

      return { ok: true, detail: `messageId=${info.messageId}` };
    } catch (error) {
      return {
        ok: false,
        error: `SMTP 발송 실패: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },
};
