import { defineConfig } from 'orval';

// backend openapi.yaml → axios 클라이언트(mutator=authedClient 경유) + TanStack Query 훅.
// Zod 스키마는 후속(D7) — frontend/README.md §API 계층에도 같은 메모가 달려 있다.
// 범위는 stays 태그만(D1) — 다른 태그가 필요해지면 그 티켓에서 tags 배열에 추가해 재생성한다.
export default defineConfig({
  trippilot: {
    input: {
      target: '../backend/docs/design/openapi.yaml',
      filters: { mode: 'include', tags: ['stays'] },
    },
    output: {
      mode: 'tags-split',
      target: './src/shared/api/generated/endpoints.ts',
      schemas: './src/shared/api/generated/schemas',
      client: 'react-query',
      httpClient: 'axios',
      override: {
        mutator: {
          path: './src/shared/api/mutator.ts',
          name: 'customInstance',
        },
      },
    },
  },
});
