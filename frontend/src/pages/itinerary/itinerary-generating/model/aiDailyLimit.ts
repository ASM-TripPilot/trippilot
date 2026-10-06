import { seoulDate } from '@/shared/lib/seoulDate';

/**
 * TRIP-1268 · AI 일정 생성(FULLY_AI·CO_PLAN) 계정당 하루(KST) 성공 횟수 카운터 — 클라이언트 임시 장치.
 * 시계·저장소를 인자로 받는다(호출부가 `new Date()`·SecureStore 를 넘긴다). 판정·기록은 reject 하지 않는다 —
 * 저장소 오류가 생성 흐름을 막으면 안 된다(fail-open).
 */
// ponytail: 기기 로컬 카운터라 재설치·다른 기기로 우회된다. BE 일일 한도 + 429 처리 FE 칸 배포 시 이 모듈째 제거.

export const AI_DAILY_LIMIT = 5;

export interface AiUsageStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export interface AiUsageDeps {
  store: AiUsageStore;
  now: Date;
}

// 구분자는 `.` — SecureStore 는 키가 /^[\w.-]+$/ 가 아니면 throw 한다(`:` 면 읽기가 늘 실패 → fail-open 으로 한도가 영영 안 걸림).
const keyOf = (accountId: string): string => `aiGenUsage.${accountId}`;

/** 저장 원문 → 오늘 횟수. 없음·날짜 다름·깨진 값은 0. */
function todayCount(raw: string | null, today: string): number {
  if (raw === null) return 0;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return 0;
    const { d, n } = value as { d?: unknown; n?: unknown };
    return d === today && typeof n === 'number' ? n : 0;
  } catch {
    return 0;
  }
}

export async function readTodayAiCount(
  accountId: string,
  { store, now }: AiUsageDeps
): Promise<number> {
  return todayCount(await store.read(keyOf(accountId)), seoulDate(now));
}

export async function isAiDailyLimitReached(
  accountId: string | undefined,
  deps: AiUsageDeps
): Promise<boolean> {
  if (accountId === undefined) return false;
  try {
    return (await readTodayAiCount(accountId, deps)) >= AI_DAILY_LIMIT;
  } catch {
    return false;
  }
}

export async function recordAiGeneration(
  accountId: string,
  deps: AiUsageDeps
): Promise<void> {
  try {
    // 읽기가 실패하면 여기서 빠진다 — 지금 횟수를 모르니 쓰지 않는다.
    const count = await readTodayAiCount(accountId, deps);
    await deps.store.write(
      keyOf(accountId),
      JSON.stringify({ d: seoulDate(deps.now), n: count + 1 })
    );
  } catch {
    // 쓰기 실패는 삼킨다 — 생성 성공 흐름(이동·캐시)을 막지 않는다.
  }
}
