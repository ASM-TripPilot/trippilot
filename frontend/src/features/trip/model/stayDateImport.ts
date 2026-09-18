import type { SavedStay } from '@/shared/api/generated/schemas';

/**
 * 등록 숙소 날짜 연계 — 목록·기간·조회 상태에서 **얼굴 하나를 고르는 순수 함수**(TRIP-208,
 * 01b §3 판정 트리 · D1·D2·D6·D7·D8). 화면도 서버도 모른다.
 *
 * 판정과 표시를 가른 이유: 화면이 이 판정을 하면 조회 훅을 물게 되고
 * `tripWizardStep1Boundary.test.ts`가 막는다(AC-13). 화면은 완성된 얼굴만 받는다.
 */

/** 사유 3종. 이 중 ③만 Figma 실측 확정값(`2226:2034`)이고 ①·②는 티켓 문구를 빌린
 * **발명 문자열**이다(01b §9) — 뒤집히면 이 세 줄만 바뀐다. */
const REASON_PERIOD_FILLED = '이미 입력한 기간이 있어요';
const REASON_MULTIPLE_STAYS = '여러 숙소가 등록돼 있어요';
const REASON_NO_DATES = '등록 숙소에 체크인·체크아웃이 없어요';

export type StayImportView =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ready'; note: string; checkIn: string; checkOut: string }
  | { kind: 'blocked'; note: string };

export interface StayImportInput {
  /** 마지막으로 성공한 목록. 한 번도 못 받았으면 `undefined`. */
  stays?: SavedStay[];
  /** 첫 조회가 아직 안 끝났나(TanStack `isPending`). */
  loading: boolean;
  /** 여행 기간이 이미 채워져 있나. */
  periodFilled: boolean;
}

/** '6.10~6.13' — 0을 채우지 않고 점·물결로 쓴다(Figma `2225:2370`). 날짜 카드의
 * `formatDateRange`가 만드는 `6월 10일 – 6월 13일`과 **문자가 다르다**(en dash U+2013 vs
 * ASCII `~`) — 같은 화면에 서식이 둘이라 재사용하면 조용히 어긋난다. */
export function formatStayDateRange(checkIn: string, checkOut: string): string {
  return `${monthDay(checkIn)}~${monthDay(checkOut)}`;
}

function monthDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}.${day}`;
}

/** 가져올 수 있는 숙소만 남긴다 — `checkIn`·`checkOut`은 계약상 **각각 독립 nullable**이라
 * 한쪽만 있는 숙소가 정상이고, 반쪽 기간은 여행 기간이 될 수 없다(D7). `coordConfirmed`로는
 * 거르지 않는다 — 날짜 가져오기는 좌표와 무관하다(INV-U1-08은 거점 배정 전용). */
function datedStays(
  stays: SavedStay[]
): { name: string; checkIn: string; checkOut: string }[] {
  return stays.flatMap((stay) =>
    stay.checkIn && stay.checkOut
      ? [{ name: stay.name, checkIn: stay.checkIn, checkOut: stay.checkOut }]
      : []
  );
}

export function resolveStayImport({
  stays,
  loading,
  periodFilled,
}: StayImportInput): StayImportView {
  // 목록을 아직 못 받았다. **조회가 끝났는데도 없으면 실패한 것**이므로 빈 목록으로 판정을
  // 이어 간다 — 여기서 로딩을 돌려주면 자리표시가 영원히 돌고 사용자가 할 수 있는 일이
  // 사라진다(BR-U1-55 침묵 실패 금지 · INV-4).
  if (stays === undefined) {
    return loading ? { kind: 'loading' } : { kind: 'empty' };
  }
  // 데이터 축 하나로만 가른다 — 얼굴 C에는 `가져오기`가 아예 없어(Figma `2226:1829`)
  // "기간 이미 입력"과 교차할 자리가 없다(D8 · AC-2).
  if (stays.length === 0) return { kind: 'empty' };

  // 사유 우선순위 ① > ② > ③(D6) — "지금 이 화면에서 직접 고칠 수 있는 것"이 먼저다.
  if (periodFilled) {
    return { kind: 'blocked', note: REASON_PERIOD_FILLED };
  }

  const dated = datedStays(stays);
  if (dated.length >= 2) {
    return { kind: 'blocked', note: REASON_MULTIPLE_STAYS };
  }
  const [only] = dated;
  if (only === undefined) {
    return { kind: 'blocked', note: REASON_NO_DATES };
  }

  // 판정과 값을 한 자리에서 낸다 — "얼굴은 A인데 채워지는 날짜는 다른 숙소 것"이 구조적으로
  // 불가능해진다(부제와 `setPeriod` 인자의 출처가 같다).
  return {
    kind: 'ready',
    note: `${only.name} · ${formatStayDateRange(only.checkIn, only.checkOut)}`,
    checkIn: only.checkIn,
    checkOut: only.checkOut,
  };
}
