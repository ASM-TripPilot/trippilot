import {
  readStringValue,
  writeStringValue,
} from '@/shared/storage/stringValue';

import {
  applyFaultAction,
  isFaultRule,
  parseFaultLink,
  type FaultLinkAction,
  type FaultLinkParams,
  type FaultRule,
} from './rules';

/** 규칙 저장소 — 메모리 + 끄기 전까지 유지되는 저장(앱 재시작 후에도). 읽기는 처음 ready() 때 한 번. */
export interface FaultStorage {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
}

export function createFaultStore(storage: FaultStorage) {
  let rules: readonly FaultRule[] = [];
  let hydrated: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const ready = () =>
    (hydrated ??= storage
      .read()
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        // 다 읽기 전에 apply 가 끝났으면 그 값을 덮지 않는다(apply 는 ready 뒤에만 쓰지만 방어).
        if (Array.isArray(parsed) && rules.length === 0) {
          rules = parsed.filter(isFaultRule);
        }
      })
      // 깨진 저장값·읽기 실패 = 빈 규칙. 개발 도구가 앱을 막지 않는다.
      .catch(() => undefined)
      .then(() => listeners.forEach((listener) => listener())));

  return {
    ready,
    rules: () => rules,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async apply(params: FaultLinkParams): Promise<FaultLinkAction> {
      await ready();
      const action = parseFaultLink(params);
      if (action.type === 'invalid') return action;
      rules = applyFaultAction(rules, action);
      await storage.write(JSON.stringify(rules));
      listeners.forEach((listener) => listener());
      return action;
    },
  };
}

export type FaultStore = ReturnType<typeof createFaultStore>;

export const faultStore = createFaultStore({
  read: () => readStringValue('devFaultRules'),
  write: (value) => writeStringValue('devFaultRules', value),
});
