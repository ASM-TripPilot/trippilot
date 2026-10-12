import * as Crypto from 'expo-crypto';

import type { EngineDeps } from './engine';
import { nativeAdapters } from './native';
import { getAutomationSink } from './sink';
import { createAutomationStore, type AutomationStore } from './store';

/**
 * TRIP-1338 · 실 의존 조립 — 훅·태스크가 같은 저장소 인스턴스를 쓴다. 싱크는 부를 때마다 현재 값을 읽는다
 * (`setAutomationSink` 교체가 즉시 반영된다).
 */
let store: AutomationStore | null = null;
let override: EngineDeps | null = null;

export function getEngineDeps(): EngineDeps {
  if (override) return override;
  // 실 파일 시스템은 처음 쓸 때만 끈다 — 플래그 OFF 빌드에서는 이 함수가 불리지 않는다.
  if (!store) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createExpoFs } = require('./expoFs') as typeof import('./expoFs');
    store = createAutomationStore(createExpoFs());
  }
  return {
    store,
    sink: getAutomationSink(),
    native: nativeAdapters,
    now: () => Date.now(),
    newId: () => Crypto.randomUUID(),
  };
}

/** 테스트·프리뷰 전용. null 이면 실 의존으로 돌아간다. */
export function overrideEngineDeps(deps: EngineDeps | null): void {
  override = deps;
}
