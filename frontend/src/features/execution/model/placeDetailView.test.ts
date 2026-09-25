import fc from 'fast-check';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import {
  buildPlaceDetailView,
  buildPlaceShareMessage,
  resolveSlackLabel,
} from './placeDetailView';

/**
 * TRIP-398 · i05 현재 장소 상세 — 순수함수 심판.
 *
 * 무엇을 보장하나:
 *  - `resolveSlackLabel` = '여유'(slack)는 **두 확정 시각의 차**로 정한다(BR-U4-24). 차>0 "여유 있음",
 *    차≤0 "여유 없음", 다음 고정 슬롯 없음 "미확인"(BR-U4-40). 도착 시각을 새로 추정하지 않고(BR-U4-34)
 *    소요시간 단위(분/시간)를 절대 산출하지 않는다(INV-3 · PBT-U4-F2).
 *  - `buildPlaceDetailView` = 슬롯 POI → 표시용 뷰. 결측 필드는 빈칸이 아니라 "미확인"(BR-U4-40,
 *    `mapPeek.ts` 선례), 매칭 슬롯이 없으면 null(D8).
 *  - TRIP-755(i10 재작성) — 계약 공백 필드(갤러리·사진 수·추천 카피·주소·입장료)는 운영에서 지어내지
 *    않는다(V-8), 공유 문구는 장소명 + (있으면) 주소(V-9). 도착·위치 필드는 삭제(V-1).
 *
 * 3동작 뼈대: 준비=슬롯/시각 → 실행=순수함수 → 단언=라벨·뷰 필드.
 */

// 소요시간 표기 탐지기(INV-3) — `HH:mm`(콜론 뒤 숫자)은 안 걸린다.
const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;

const slot = (
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId: 'p1',
  startAt: '14:20:00',
  endAt: '15:30:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo: '광안리 해수욕장',
  lat: 35.15,
  lng: 129.11,
  category: '해변',
  openingHours: '09:00~22:00 (상시 개방)',
  openingHoursKnown: true,
  imageUrl: null,
  tags: ['해변', '포토스팟'],
  ...over,
});

// 다음 고정 슬롯 요약(slack 입력).
const nextFixed = (
  startAt: string,
  nameKo: string | null = '부산시립미술관'
) => ({
  startAt,
  nameKo,
});

describe('resolveSlackLabel — 두 확정 시각의 차(BR-U4-24·34)', () => {
  it('V-slack-1 차>0 → "여유 있음 · 다음 {name}" (부호 감지)', () => {
    // 15:00 − 14:00 = +60 → 여유 있음. end↔next 를 뒤집으면 −60 → "여유 없음"이 되어 red.
    expect(resolveSlackLabel('14:00:00', nextFixed('15:00:00'))).toBe(
      '여유 있음 · 다음 부산시립미술관'
    );
  });

  it('V-slack-2 차=0(경계) → "여유 없음 · 다음 {name}" (≤0 분기)', () => {
    expect(resolveSlackLabel('15:00:00', nextFixed('15:00:00'))).toBe(
      '여유 없음 · 다음 부산시립미술관'
    );
  });

  it('V-slack-3 차<0 → "여유 없음 · 다음 {name}" (반대 부호)', () => {
    expect(resolveSlackLabel('15:00:00', nextFixed('14:30:00'))).toBe(
      '여유 없음 · 다음 부산시립미술관'
    );
  });

  it('V-slack-4 다음 고정 슬롯 없음(null) → "미확인" (BR-U4-40 균일)', () => {
    expect(resolveSlackLabel('15:00:00', null)).toBe('미확인');
  });

  it('V-slack-5 다음 고정 슬롯 이름 결측 → "다음 미확인"', () => {
    expect(resolveSlackLabel('14:00:00', nextFixed('15:00:00', null))).toBe(
      '여유 있음 · 다음 미확인'
    );
  });

  it('PBT-U4-F2 임의의 두 확정 시각에서 slack 라벨은 소요시간 단위를 산출하지 않는다 (INV-3)', () => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    // fast-check 로 임의 "HH:mm:ss" 를 만든다: 시 0-23 · 분/초 0-59.
    const timeArb = fc
      .tuple(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 59 })
      )
      .map(([h, m, s]) => `${pad(h)}:${pad(m)}:${pad(s)}`);

    // 긍정 앵커 — 탐지기가 진짜 소요시간은 잡는다(공허 통과 방지).
    expect(DURATION.test('30분')).toBe(true);

    fc.assert(
      fc.property(timeArb, timeArb, (endAt, nextStart) => {
        const label = resolveSlackLabel(endAt, {
          startAt: nextStart,
          nameKo: '미술관',
        });
        expect(DURATION.test(label)).toBe(false);
      })
    );
  });
});

describe('buildPlaceDetailView — 슬롯 POI → 표시용 뷰', () => {
  it('V-1 정상 — 영업시간 원문·slack·이름을 조립하고, 삭제된 도착·위치 필드는 없다 (AC-1 · TRIP-755 AC-13)', () => {
    const slots = [
      slot({ poiId: 'p1' }),
      slot({
        poiId: 'p2',
        isFixed: true,
        startAt: '17:00:00',
        nameKo: '부산시립미술관',
      }),
    ];
    const view = buildPlaceDetailView(slots, 'p1');

    expect(view).not.toBeNull();
    expect(view?.openingHours).toBe('09:00~22:00 (상시 개방)');
    expect(view?.openingHoursMissing).toBe(false);
    // endAt 15:30 < next start 17:00 → 여유 있음.
    expect(view?.slackLabel).toBe('여유 있음 · 다음 부산시립미술관');
    expect(view?.name).toBe('광안리 해수욕장');
    // TRIP-755 — "지금 여기"(arrival)는 화면에서 사라졌고 "위치"(location)는 주소(address)로 바뀌었다.
    expect(view).not.toHaveProperty('arrival');
    expect(view).not.toHaveProperty('location');
  });

  it('V-2 결측 — openingHours/이름 null → "미확인"+missing (AC-2·BR-U4-40)', () => {
    const slots = [
      slot({ poiId: 'p1', openingHours: null, nameKo: null }),
      slot({ poiId: 'p2', isFixed: true, startAt: '17:00:00' }),
    ];
    const view = buildPlaceDetailView(slots, 'p1');

    expect(view?.openingHours).toBe('미확인');
    expect(view?.openingHoursMissing).toBe(true);
    expect(view?.name).toBe('미확인');
  });

  it('V-3 다음 고정 판정 — 비고정을 건너뛰고 첫 isFixed 를 고른다 (AC-4)', () => {
    const slots = [
      slot({ poiId: 'p1', endAt: '15:00:00' }),
      slot({ poiId: 'p2', isFixed: false, nameKo: '비고정' }),
      slot({
        poiId: 'p3',
        isFixed: true,
        startAt: '16:00:00',
        nameKo: '고정목적지',
      }),
    ];
    const view = buildPlaceDetailView(slots, 'p1');

    expect(view?.slackLabel).toBe('여유 있음 · 다음 고정목적지');
  });

  it('V-4 다음 고정 슬롯 없음 → slack "미확인" (AC-4·BR-U4-40)', () => {
    const slots = [
      slot({ poiId: 'p1' }),
      slot({ poiId: 'p2', isFixed: false }),
    ];
    const view = buildPlaceDetailView(slots, 'p1');

    expect(view?.slackLabel).toBe('미확인');
  });

  it('V-5 데이터 출처 — openingHoursKnown=false → "확인 필요", 그 외 null (AC-5)', () => {
    const unknown = buildPlaceDetailView(
      [slot({ poiId: 'p1', openingHoursKnown: false })],
      'p1'
    );
    expect(unknown?.hoursCaption).toBe('확인 필요');

    const known = buildPlaceDetailView(
      [slot({ poiId: 'p1', openingHoursKnown: true })],
      'p1'
    );
    expect(known?.hoursCaption).toBeNull();

    // 확정 일정은 openingHoursKnown=null → 판정 불가 → 표기 없음.
    const confirmed = buildPlaceDetailView(
      [slot({ poiId: 'p1', openingHoursKnown: null })],
      'p1'
    );
    expect(confirmed?.hoursCaption).toBeNull();
  });

  it('V-6 매칭 실패 — poiId 가 슬롯에 없으면 null (AC-7·D8)', () => {
    expect(buildPlaceDetailView([slot({ poiId: 'p1' })], 'ghost')).toBeNull();
  });

  it('V-7 소요시간 단위가 어떤 뷰 문자열 필드에도 없다 (INV-3)', () => {
    const view = buildPlaceDetailView(
      [
        slot({ poiId: 'p1' }),
        slot({ poiId: 'p2', isFixed: true, startAt: '17:00:00' }),
      ],
      'p1'
    );
    const strings = [
      view?.name,
      view?.openingHours,
      view?.slackLabel,
      view?.hoursCaption ?? '',
      // TRIP-755 — 새 문자열 필드(운영은 null)까지 덮는다.
      view?.address ?? '',
      view?.admissionFee ?? '',
      view?.pitchTitle ?? '',
      view?.pitchBody ?? '',
    ].join(' | ');

    expect(DURATION.test('30분')).toBe(true); // 앵커
    expect(DURATION.test(strings)).toBe(false);
  });

  it('V-8 운영 계약 공백 — 갤러리는 대표 사진 1장뿐, 사진 수·추천 카피·주소·입장료는 null (TRIP-755 AC-8 · G6 · INV-1)', () => {
    // 준비·실행 ① — 대표 사진 없음.
    const noPhoto = buildPlaceDetailView(
      [slot({ poiId: 'p1', imageUrl: null })],
      'p1'
    );
    // 단언 — 없는 사진을 지어내지 않는다.
    expect(noPhoto?.galleryUrls).toEqual([]);

    // 준비·실행 ② — 대표 사진 있음.
    const withPhoto = buildPlaceDetailView(
      [slot({ poiId: 'p1', imageUrl: 'file:///hero.jpg' })],
      'p1'
    );
    expect(withPhoto?.galleryUrls).toEqual(['file:///hero.jpg']);

    // 단언 — 계약에 없는 값은 null(toBeNull 은 undefined 를 통과시키지 않는다 — 필드 누락도 red).
    expect(withPhoto?.photoTotal).toBeNull();
    expect(withPhoto?.pitchTitle).toBeNull();
    expect(withPhoto?.pitchBody).toBeNull();
    expect(withPhoto?.address).toBeNull();
    expect(withPhoto?.admissionFee).toBeNull();
  });
});

describe('buildPlaceShareMessage — OS 공유 문구 (TRIP-755 AC-5)', () => {
  it('V-9 주소가 없으면 장소명만, 있으면 장소명 다음 줄에 주소를 붙인다', () => {
    // 운영 경로(address 늘 null)로는 주소 분기에 닿을 수 없어 순수 함수로 잰다(02a D-c · ★11).
    expect(
      buildPlaceShareMessage({ name: '광안리 해수욕장', address: null })
    ).toBe('광안리 해수욕장');
    expect(
      buildPlaceShareMessage({
        name: '부산시립미술관',
        address: '부산 부산진구 ○○로 12',
      })
    ).toBe('부산시립미술관\n부산 부산진구 ○○로 12');
  });
});
