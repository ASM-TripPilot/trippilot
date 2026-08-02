import { defineConfig } from 'orval';

// backend openapi.yaml → axios 클라이언트(mutator=authedClient 경유) + TanStack Query 훅.
// Zod 스키마는 후속(D7) — frontend/README.md §API 계층에도 같은 메모가 달려 있다.
// 범위는 stays 태그만(D1) — 다른 태그가 필요해지면 그 티켓에서 tags 배열에 추가해 재생성한다.
// TRIP-183에서 saved-stays 추가: '내 주변' 권한 거부 시 등록 숙소 좌표로 대체 조회한다(BR-U1-11).
// TRIP-203에서 trips·preferences 추가: 여행 생성 mutation·취향 조회 훅의 계약 원본(D6).
// orval은 태그 단위 필터만 지원해 두 태그에 딸린 소비자 0 오퍼레이션(bases·coverage·
// must-visits·PUT /me/preferences)도 함께 생성된다 — 01b Seed D3 수용.
export default defineConfig({
  trippilot: {
    input: {
      target: '../backend/docs/design/openapi.yaml',
      filters: {
        mode: 'include',
        tags: ['stays', 'saved-stays', 'trips', 'preferences'],
      },
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
