import {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';

import { faultErrorBody, findRule, type FaultRule } from './rules';

interface RuleSource {
  ready: () => Promise<void>;
  rules: () => readonly FaultRule[];
}

/**
 * 요청 인터셉터 하나 — GET 이 규칙에 맞으면 (지연 뒤) 그 요청의 adapter 만 "가짜 상태로 거절" 로 바꾼다.
 * 실패는 서버 4xx/5xx 와 같은 `AxiosError{response}` 라 기존 응답 인터셉터(401 리프레시)·화면 정규화를 그대로 탄다.
 */
export function installFaultInjection(
  client: AxiosInstance,
  source: RuleSource
): void {
  client.interceptors.request.use(async (config) => {
    await source.ready();
    const rule = findRule(source.rules(), config);
    if (!rule) return config;
    if (rule.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
    }
    if (rule.status !== undefined) {
      const status = rule.status;
      config.adapter = (request: InternalAxiosRequestConfig) =>
        Promise.reject(
          new AxiosError(
            `Request failed with status code ${status}`,
            status >= 500
              ? AxiosError.ERR_BAD_RESPONSE
              : AxiosError.ERR_BAD_REQUEST,
            request,
            null,
            {
              data: faultErrorBody(rule),
              status,
              statusText: 'DEV FAULT',
              headers: {},
              config: request,
            }
          )
        );
    }
    return config;
  });
}
