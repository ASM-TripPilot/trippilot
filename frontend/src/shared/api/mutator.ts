import type { AxiosRequestConfig } from 'axios';

import { authedClient } from './index';

/**
 * 서버가 요청 **안에서** AI 를 동기로 부르는 요청 — 전역 timeout(15초)으로 자르면 서버는 일을 끝냈는데
 * 화면만 실패로 읽는다(생성이면 재시도가 409 GENERATION_IN_PROGRESS 에 막힌다). 그래서 클라 timeout 을
 * 걸지 않고(0) 서버의 AI read 상한이 끊게 둔다 — 생성 POST 62초(시한 on)~612초(off) · 편집 PUT·되돌리기·
 * 슬롯 후보 62초 · 회고 생성 POST·수정 PUT 21초(TRIP-935 조사, 백엔드 `ScheduleDeadlineProperties`·
 * `ReflectionAgentProperties`). 회고 PUT 은 그날 회고가 아직 없으면 초안을 AI 로 만든 뒤 얹는다
 * (`ReflectionService.edit`→`draftFor`). 재계획(replan-sessions)은 `@Async` 라 여기 없다.
 * ponytail: 서버가 AI 를 동기로 부르는 새 엔드포인트를 열면 여기 한 줄을 더해야 한다(기계 강제 없음).
 */
const AI_BOUND_REQUESTS: readonly RegExp[] = [
  /^(POST|PUT) \/trips\/[^/]+\/itinerary$/, // 생성 · 편집 재검증
  /^POST \/trips\/[^/]+\/itinerary\/slot-candidates$/,
  /^POST \/trips\/[^/]+\/itinerary\/revisions\/[^/]+\/restore$/,
  /^(POST|PUT) \/trips\/[^/]+\/reflections\/[^/]+$/, // 회고 생성 · 수정(초안 없을 때 AI)
];

function isAiBound(config: AxiosRequestConfig): boolean {
  const request = `${(config.method ?? 'GET').toUpperCase()} ${config.url ?? ''}`;
  return AI_BOUND_REQUESTS.some((pattern) => pattern.test(request));
}

/**
 * orval mutator — 생성 클라이언트(`shared/api/generated/**`)가 실제 HTTP 호출에 쓰는 단일
 * 범용 함수(TRIP-179 D3). `authedClient`(Authorization 헤더 부착 + 401 single-flight 리프레시)
 * 를 그대로 태우고, 배열 쿼리는 브래킷 없이 직렬화한다 — Spring `@RequestParam List<String>`은
 * `amenity=A&amenity=B` 형태만 바인딩하고, axios 기본 직렬화(`amenity[]=A`)는 에러 없이
 * 조용히 무시한다. 반환은 `AxiosResponse`가 아니라 body만(orval 생성 함수의 `Promise<T>` 계약).
 */
export const customInstance = async <T>(
  config: AxiosRequestConfig
): Promise<T> => {
  const response = await authedClient({
    ...config,
    paramsSerializer: { indexes: null },
    ...(isAiBound(config) ? { timeout: 0 } : {}),
  });
  return response.data as T;
};
