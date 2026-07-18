import { defineConfig } from 'orval';

// backend openapi.yaml → axios 클라이언트 + TanStack Query 훅 + Zod 스키마.
// Q1(01b §1): 이번 스캐폴드는 스크립트·설정만 정의하고 생성물(shared/api/generated/)은
// 커밋하지 않는다. openapi G-1(grantType) 개정 확정 후 `pnpm codegen`으로 생성한다.
export default defineConfig({
  trippilot: {
    input: {
      target: '../backend/docs/design/openapi.yaml',
    },
    output: {
      mode: 'tags-split',
      target: './src/shared/api/generated/endpoints.ts',
      schemas: './src/shared/api/generated/schemas',
      client: 'react-query',
    },
  },
});
