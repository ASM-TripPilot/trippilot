import { buildEditItineraryRequest } from './buildEditItineraryRequest';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-797 · AC-6 (INV-4 · INV-U3-02) — 로컬 "미지정(시간대 설정)" 슬롯의 **저장 조립 필터**.
 *
 * 서버 계약(openapi 2065/2559)은 `startAt` 이 **non-nullable** 이라(§요청3), 미지정은 FE 로컬
 * 상태(`EditorSlot.startAt: string | null`)로만 표현하고 **저장 시 제외**한다(서버가 못 받으므로).
 *
 * 무엇을 보장하나:
 *  - 🔴 **A2-1** `startAt === null`(미지정) 슬롯은 PUT 봉투에서 **빠진다**.
 *  - 🔴 **A2-2** 미지정을 걸러낸 **남은 순서가 그대로**다(INV-U3-02 — 중간에서 빼도 앞뒤 순서 보존).
 *  - **A2-3 (회귀앵커·선제green)** 미지정 0개(정상 days)면 기존 5필드·순서 그대로(후방호환) — 필터
 *    추가가 정상 경로를 안 깬다.
 *
 * ⚠️ **"제외됨을 사용자에게 안내"(INV-4 침묵 금지)는 순수 함수 밖**(페이지 렌더 책임) — 이 파일은
 * 필터까지만 잠근다(02a ★6, 안내 UI 심판은 페이지 재조립 몫으로 이연).
 *
 * 컴파일용 로컬 타입: 스토어의 `EditorSlot`(startAt null 허용)이 이 사이클 신규라 아직 export 전이라,
 * 테스트가 컴파일되도록 최소 타입을 로컬 선언하고 현 시그니처(`ItineraryDaysItem[]`)로 캐스트한다.
 * implementer 가 `buildEditItineraryRequest` 입력을 `EditorDaysItem[]`(상위집합)으로 넓히면 이 캐스트는
 * 무해하게 유지된다(구조적 부분타이핑, 02a ★5·§5).
 */

type EditorSlot = Omit<ItineraryDaysItemSlotsItem, 'startAt'> & {
  startAt: string | null;
};
type EditorDaysItem = { date: string; slots: EditorSlot[] };

const DATE = '2026-06-10';

/** startAt 을 지정/미지정으로 만든 편집 슬롯(읽기전용 필드까지 채워 제거를 확인). */
function editorSlot(poiId: string, startAt: string | null): EditorSlot {
  return {
    poiId,
    startAt,
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    violationReason: null,
    nameKo: '어떤 장소',
    distanceRange: '약 1.2km · 도보 추정',
    tags: ['#바다'],
  };
}

/** EditorDaysItem[] 를 현 시그니처로 넘기는 캐스트(시그니처 확장 전/후 모두 컴파일). */
function build(days: EditorDaysItem[]) {
  return buildEditItineraryRequest(days as unknown as ItineraryDaysItem[]);
}

describe('🔴 buildEditItineraryRequest · A2-1 — 미지정(startAt null) 슬롯 제외', () => {
  it('startAt 이 null 인 슬롯은 PUT 봉투에서 빠진다', () => {
    const days: EditorDaysItem[] = [
      {
        date: DATE,
        slots: [
          editorSlot('a', '09:00:00'),
          editorSlot('b', null), // 미지정 — 서버가 못 받으므로 제외
          editorSlot('c', '11:00:00'),
        ],
      },
    ];

    const request = build(days);

    // b(미지정)는 빠지고 a·c 만 남는다.
    expect(request.days[0].slots.map((s) => s.poiId)).toEqual(['a', 'c']);
  });
});

describe('🔴 buildEditItineraryRequest · A2-2 — 남은 순서 유지(INV-U3-02)', () => {
  it('미지정이 중간중간 섞여도 남은 슬롯 순서가 그대로다', () => {
    const days: EditorDaysItem[] = [
      {
        date: DATE,
        slots: [
          editorSlot('a', '09:00:00'),
          editorSlot('x', null),
          editorSlot('b', '11:00:00'),
          editorSlot('y', null),
          editorSlot('c', '13:00:00'),
        ],
      },
    ];

    expect(build(days).days[0].slots.map((s) => s.poiId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('buildEditItineraryRequest · A2-3 (회귀앵커) — 미지정 0개면 무변경', () => {
  it('전부 startAt 이 있으면 기존 5필드·순서 그대로다(후방호환)', () => {
    const days: EditorDaysItem[] = [
      {
        date: DATE,
        slots: [editorSlot('a', '09:00:00'), editorSlot('b', '11:00:00')],
      },
    ];

    const request = build(days);
    expect(request.days[0].slots.map((s) => s.poiId)).toEqual(['a', 'b']);
    request.days[0].slots.forEach((s) => {
      expect(Object.keys(s).sort()).toEqual(
        ['endAt', 'endsNextDay', 'isFixed', 'poiId', 'startAt'].sort()
      );
    });
  });
});
