import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 날짜 계산 로직은 모두 순수 함수이므로 DOM 이 필요 없다.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 로컬 타임존에 영향받는 코드가 남아 있으면 즉시 드러나도록
    // 일부러 KST 와 다른 타임존을 강제한다. (UTC-8)
    // 이 상태에서 통과해야 타임존 안전성이 검증된 것이다.
    env: {
      TZ: "America/Los_Angeles",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
