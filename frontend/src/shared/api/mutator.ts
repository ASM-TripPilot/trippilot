import type { AxiosRequestConfig } from 'axios';

import { authedClient } from './index';

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
  });
  return response.data as T;
};
