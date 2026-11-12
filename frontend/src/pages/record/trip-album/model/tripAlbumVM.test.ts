import type {
  ActualVisit,
  PlannedSlot,
  TripRecordDay,
  VisitPhoto,
} from '@/shared/api/index.schemas';

import { buildTripAlbumVM } from './tripAlbumVM';

/**
 * TRIP-1798 · 여행 앨범 VM — "서버 기록 + 사진 메타 + 기기 앨범 주소"를 화면이 그릴 묶음(일차 → 장소 → 사진)으로 조립하는 순수 규칙.
 * 초심자용: 입력을 넣고 결과를 확인하는 함수 테스트라 네트워크·화면이 없다(준비 = 입력 객체, 실행 = 함수 호출, 단언 = 결과).
 *
 * 무엇을 보장하나(AC 1·2·7·8, Q5~Q9):
 *  - 일차·장소는 응답 순서, 장소 안 사진은 `sortOrder` 순. 일차 번호는 **여행 시작일 기준**(비어 있는 날이 있어도 번호 유지).
 *  - 이 기기 사진만 그린다. 다른 기기 사진은 세기만 하고(`otherDeviceCount`) 기기 id 를 모르면 아무것도 안 그린다.
 *  - 앨범에서 못 푼 사진(uri null)은 조용히 빼지 않고 `unresolvedCount` 로 센다. 아직 모름(undefined)은 세지도 그리지도 않는다.
 *  - 그릴 사진이 0장인 장소·일차는 숨긴다. 이름은 일정 슬롯 → 즉석 이름 → `{N}번째 장소`, 지어내지 않는다.
 *
 * 규칙: 시계·네트워크를 읽지 않는다. 오라클은 구현을 복사하지 않고 손으로 센 값(날짜·요일은 2026-06-10 = 수요일)이다.
 */

const ME = 'me';

const visit = (
  id: string,
  poiId: string,
  over: Partial<ActualVisit> = {}
): ActualVisit => ({
  visitCheckId: id,
  poiId,
  spontaneous: false,
  photoCount: 1,
  hasMemo: false,
  updatedAt: '2026-06-10T10:00:00Z',
  ...over,
});

const slot = (
  date: string,
  poiId: string,
  nameKo: string | null
): PlannedSlot => ({
  slotKey: `${date}#${poiId}`,
  date,
  poiId,
  orderIndex: 0,
  startAt: '10:00',
  endAt: '11:00',
  endsNextDay: false,
  isFixed: false,
  hasViolation: false,
  nameKo,
});

const dayOf = (
  date: string,
  actual: ActualVisit[],
  planned: PlannedSlot[] = []
): TripRecordDay => ({ date, planned, actual, unvisitedSlotKeys: [] });

const photo = (
  id: string,
  sortOrder: number,
  deviceId: string = ME
): VisitPhoto => ({
  visitPhotoMetaId: `meta-${id}`,
  localAssetId: id,
  deviceId,
  sortOrder,
});

/** 사진 메타의 앨범 주소를 전부 `file://{id}` 로 푼 표. */
const resolved = (...photos: VisitPhoto[][]): Record<string, string> =>
  Object.fromEntries(
    photos.flat().map((p) => [p.localAssetId, `file://${p.localAssetId}`])
  );

// 화면이 그릴 것만 손으로 투영한다 — 구현이 내는 여분 필드에 테스트가 묶이지 않게.
const shape = (vm: ReturnType<typeof buildTripAlbumVM>) =>
  vm.days.map((d) => ({
    dayNumber: d.dayNumber,
    title: d.title,
    places: d.places.map((p) => ({
      name: p.name,
      count: p.countLabel,
      photos: p.photos.map((x) => x.visitPhotoMetaId),
    })),
  }));

function twoDays() {
  const p1 = [photo('a2', 2), photo('a0', 0), photo('a1', 1)];
  const p2 = [photo('b0', 0)];
  const p3 = [photo('c1', 1), photo('c0', 0)];
  const days = [
    dayOf(
      '2026-06-10',
      [visit('v1', 'poiA'), visit('v2', 'poiB')],
      [
        slot('2026-06-10', 'poiA', '코엑스'),
        slot('2026-06-10', 'poiB', '봉은사'),
      ]
    ),
    dayOf(
      '2026-06-11',
      [visit('v3', 'poiC')],
      [slot('2026-06-11', 'poiC', '광안리')]
    ),
  ];
  return {
    days,
    photosByVisit: { v1: p1, v2: p2, v3: p3 },
    uriByAssetId: resolved(p1, p2, p3),
  };
}

const base = {
  installId: ME as string | null,
  startDate: '2026-06-10' as string | undefined,
  spontaneousNames: {} as Record<string, string>,
};

describe('🔴 TRIP-1798 · 앨범 VM — 일차 → 장소 → 사진', () => {
  it('V1 일차 2개·장소 순서·사진은 sortOrder 순·제목은 기간 기준이고 소요시간은 없다 (AC1·INV-3)', () => {
    const vm = buildTripAlbumVM({ ...base, ...twoDays() });

    expect(shape(vm)).toEqual([
      {
        dayNumber: 1,
        title: '1일차 · 6월 10일(수)',
        places: [
          {
            name: '코엑스',
            count: '3장',
            photos: ['meta-a0', 'meta-a1', 'meta-a2'],
          },
          { name: '봉은사', count: '1장', photos: ['meta-b0'] },
        ],
      },
      {
        dayNumber: 2,
        title: '2일차 · 6월 11일(목)',
        places: [
          { name: '광안리', count: '2장', photos: ['meta-c0', 'meta-c1'] },
        ],
      },
    ]);
    expect(vm.visiblePhotoCount).toBe(6);
    expect(JSON.stringify(vm)).not.toMatch(/duration/i);
  });

  it('V2 다른 기기 사진 3장은 그려지지 않고 장수만 센다 (AC2·AC7)', () => {
    const t = twoDays();
    const others = [
      photo('x0', 0, 'tablet'),
      photo('x1', 1, 'tablet'),
      photo('x2', 2, 'tablet'),
    ];
    const vm = buildTripAlbumVM({
      ...base,
      ...t,
      photosByVisit: {
        ...t.photosByVisit,
        v2: [...t.photosByVisit.v2, ...others],
      },
      uriByAssetId: { ...t.uriByAssetId, ...resolved(others) },
    });

    expect(vm.otherDeviceCount).toBe(3);
    expect(vm.visiblePhotoCount).toBe(6);
    const ids = vm.days.flatMap((d) =>
      d.places.flatMap((p) => p.photos.map((x) => x.visitPhotoMetaId))
    );
    expect(ids).not.toContain('meta-x0');
    expect(ids).toHaveLength(6);
  });

  it('V3 이 기기 id 를 모르면(null) 아무 사진도 그리지 않고 다른 기기 수도 지어내지 않는다 (AC2)', () => {
    const vm = buildTripAlbumVM({ ...base, ...twoDays(), installId: null });

    expect(vm.days).toEqual([]);
    expect([
      vm.visiblePhotoCount,
      vm.otherDeviceCount,
      vm.unresolvedCount,
    ]).toEqual([0, 0, 0]);
  });

  it('V4 그릴 사진이 0장인 일차·장소는 숨기고, 남은 일차의 번호는 여행 시작일 기준을 지킨다 (AC1·Q9)', () => {
    // 06-10: 사진 없음(숨김). 06-11 은 응답에 없음. 06-12: 장소 하나는 전부 다른 기기(숨김), 하나는 이 기기 사진.
    const mine = [photo('m0', 0)];
    const theirs = [photo('t0', 0, 'tablet')];
    const vm = buildTripAlbumVM({
      ...base,
      days: [
        dayOf('2026-06-10', [visit('v1', 'poiA', { photoCount: 0 })]),
        dayOf(
          '2026-06-12',
          [visit('v2', 'poiB'), visit('v3', 'poiC')],
          [
            slot('2026-06-12', 'poiB', '봉은사'),
            slot('2026-06-12', 'poiC', '광안리'),
          ]
        ),
      ],
      photosByVisit: { v2: theirs, v3: mine },
      uriByAssetId: resolved(mine, theirs),
    });

    expect(shape(vm)).toEqual([
      {
        dayNumber: 3,
        title: '3일차 · 6월 12일(금)',
        places: [{ name: '광안리', count: '1장', photos: ['meta-m0'] }],
      },
    ]);
    expect(vm.otherDeviceCount).toBe(1);
  });

  it('V5 앨범에서 못 푼 사진(null)은 장수로 세고 숨기며, 아직 모르는 것(undefined)은 세지도 그리지도 않는다 (Q5·BR-U5-14)', () => {
    const t = twoDays();
    const vm = buildTripAlbumVM({
      ...base,
      ...t,
      // v2 의 b0 = 원본 삭제(null), v3 의 c1 = 아직 해석 중(undefined)
      uriByAssetId: { ...t.uriByAssetId, b0: null, c1: undefined },
    });

    expect(vm.unresolvedCount).toBe(1);
    expect(vm.visiblePhotoCount).toBe(4);
    expect(shape(vm)[0].places.map((p) => p.name)).toEqual(['코엑스']); // 봉은사는 보일 사진이 없어 숨김
    expect(shape(vm)[1].places[0].photos).toEqual(['meta-c0']);
  });

  it('V6 이름: 일정 슬롯 > 즉석 이름 > 그날 N번째 장소 — 공백은 무시하고 지어내지 않는다 (AC8)', () => {
    const p = [photo('p', 0)];
    const vm = buildTripAlbumVM({
      ...base,
      days: [
        dayOf(
          '2026-06-10',
          [
            visit('v1', 'poiA'), // 슬롯 이름 (두 날에 다르게 있어도 먼저 나온 것)
            visit('v2', 'poiB'), // 슬롯 nameKo 가 공백뿐 → 즉석 이름으로
            visit('v3', 'poiC'), // 이름 없음 → 3번째 장소
            visit('v4', 'toString'), // 프로토타입 함수가 이름으로 새지 않는다
          ],
          [
            slot('2026-06-10', 'poiA', '코엑스'),
            slot('2026-06-10', 'poiB', '   '),
          ]
        ),
        dayOf('2026-06-11', [], [slot('2026-06-11', 'poiA', '다른 이름')]),
      ],
      photosByVisit: { v1: p, v2: p, v3: p, v4: p },
      uriByAssetId: resolved(p),
      spontaneousNames: { poiB: '즉석 카페' },
    });

    expect(vm.days[0].places.map((x) => x.name)).toEqual([
      '코엑스',
      '즉석 카페',
      '3번째 장소',
      '4번째 장소',
    ]);
  });

  it('V7 여행 시작일을 모르면 days[] 순번으로 매기고 제목의 날짜 부분은 뺀다 (Q9)', () => {
    const vm = buildTripAlbumVM({
      ...base,
      ...twoDays(),
      startDate: undefined,
    });

    expect(vm.days.map((d) => [d.dayNumber, d.title])).toEqual([
      [1, '1일차'],
      [2, '2일차'],
    ]);
  });

  it('V8 같은 장소를 두 번 가면 방문(visitCheckId)마다 따로 묶는다 (Q7)', () => {
    const a = [photo('a0', 0)];
    const b = [photo('b0', 0)];
    const vm = buildTripAlbumVM({
      ...base,
      days: [
        dayOf(
          '2026-06-10',
          [visit('v1', 'poiA'), visit('v2', 'poiA')],
          [slot('2026-06-10', 'poiA', '코엑스')]
        ),
      ],
      photosByVisit: { v1: a, v2: b },
      uriByAssetId: resolved(a, b),
    });

    expect(shape(vm)[0].places).toEqual([
      { name: '코엑스', count: '1장', photos: ['meta-a0'] },
      { name: '코엑스', count: '1장', photos: ['meta-b0'] },
    ]);
  });

  it('V9 건너뜀 방문이라도 사진이 있으면 조용히 숨기지 않는다 (Q7)', () => {
    const a = [photo('a0', 0)];
    const vm = buildTripAlbumVM({
      ...base,
      days: [
        dayOf(
          '2026-06-10',
          [visit('v1', 'poiA', { skippedAt: '2026-06-10T09:00:00Z' })],
          [slot('2026-06-10', 'poiA', '코엑스')]
        ),
      ],
      photosByVisit: { v1: a },
      uriByAssetId: resolved(a),
    });

    expect(shape(vm)[0].places).toEqual([
      { name: '코엑스', count: '1장', photos: ['meta-a0'] },
    ]);
  });
});
