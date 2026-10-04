import fs from 'fs';
import path from 'path';

import * as fc from 'fast-check';
import * as Linking from 'expo-linking';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

import type {
  ProjectedSlot,
  SlotState,
} from '@/entities/itinerary-slot/lib/slotProgress';
import {
  buildAppNavUrl,
  buildWebNavUrl,
  openNextNav,
  resolveNextDest,
  resolveSlotDests,
  type NavDest,
} from './nextNav';

/**
 * TRIP-399 · nextNav — i01 "다음 예정지 길찾기" 순수 로직(딥링크 폴백 사다리).
 *
 * 화면은 순수 뷰라 Linking 을 모른다(LiveSlotCard). 딥링크 판정은 전부 이 유틸에 모여
 * 있고, 여기서 `expo-linking` 을 목으로 갈아끼워 4분기(앱/웹/reject 강등/최종 거리 안내)를
 * 검증한다. 리포에 Linking 목 선례가 0건이라(grep 실측) 인라인 `jest.mock` 팩토리로 직접
 * 치환한다 — `expo-linking` 은 NativeWind 무관 순수 모듈이라 인라인 팩토리가 안전하다(§실측).
 *
 * 개념(초심자용):
 *  - `jest.mock('expo-linking', factory)` = 그 모듈을 팩토리가 만든 가짜로 통째 치환한다.
 *    파일 맨 위로 끌어올려져(hoist) 실행되므로, 팩토리 안에서 바깥 변수를 참조하면 안 된다
 *    (아직 정의 전이라 터진다). 여기선 `jest.fn()` 만 써서 안전하다.
 *  - `mockResolvedValue(x)` = 그 async 함수가 x 로 **성공**(resolve)하게 한다.
 *  - `mockRejectedValue(e)` = **거부**(reject)하게 한다. reject 는 `await` 지점에서 throw 가 돼
 *    유틸의 try/catch 로 떨어진다(§실측으로 확인).
 *  - `canOpenURL(url)` = 그 URL 을 열 수 있는 앱이 깔렸는지 묻기 / `openURL(url)` = 열기.
 *
 * 3동작 뼈대: 준비=목 분기 세팅 → 실행=유틸 호출 → 단언=반환값·openURL 인자·fallback 호출.
 */

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));

// TRIP-1189 — canOpenURL 은 iOS 에서 LSApplicationQueriesSchemes(네이티브·재빌드)가 필요해 쓰지 않는다.
// 앱 → 웹 → 거리 안내 사다리는 openURL 의 reject 만으로 만든다.
const mockCanOpenURL = Linking.canOpenURL as jest.Mock;
const mockOpenURL = Linking.openURL as jest.Mock;

const slot = (
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId: 'poi-1',
  startAt: '15:00:00',
  endAt: '16:30:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  alternatives: [],
  nameKo: '광안리',
  distanceRange: '약 1.2km · 도보 추정',
  lat: 35.1,
  lng: 129.1,
  openingHours: null,
  tags: [],
  ...over,
});

// resolveNextDest 는 raw 슬롯이 아니라 ProjectedSlot({state, slot}) 배열을 받는다.
const projected = (
  state: SlotState,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ProjectedSlot => ({ state, slot: slot(over) });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AC-5 · URL 빌더 (순수 함수, 네이버 지도)', () => {
  it('buildAppNavUrl 은 nmap 대중교통 길찾기에 도착지만 싣는다 (출발지 생략=현재 위치, appname 필수)', () => {
    const url = buildAppNavUrl({ lat: 35.1, lng: 129.1, nameKo: '광안리' });

    expect(url).toBe(
      `nmap://route/public?dlat=35.1&dlng=129.1&dname=${encodeURIComponent('광안리')}&appname=com.trippilot.travel`
    );
    expect(url).not.toContain('slat');
    expect(url).not.toContain('slng');
  });

  it('buildAppNavUrl 은 nameKo 가 null 이면 dname 을 "장소"로 대체한다', () => {
    expect(buildAppNavUrl({ lat: 35.1, lng: 129.1, nameKo: null })).toContain(
      `dname=${encodeURIComponent('장소')}`
    );
  });

  it('buildWebNavUrl 은 네이버 지도 웹 길찾기(도착지 lng,lat,이름 · 대중교통)를 인코딩해 싣는다', () => {
    expect(buildWebNavUrl({ lat: 35.1, lng: 129.1, nameKo: '광안리' })).toBe(
      `https://map.naver.com/p/directions/-/129.1,35.1,${encodeURIComponent('광안리')}/-/transit`
    );
  });

  it('buildWebNavUrl 은 nameKo 가 null 이면 "장소"로 대체한다', () => {
    expect(buildWebNavUrl({ lat: 35.1, lng: 129.1, nameKo: null })).toContain(
      `129.1,35.1,${encodeURIComponent('장소')}/`
    );
  });

  it('두 URL 어디에도 카카오 흔적이 없다', () => {
    const d = { lat: 35.1, lng: 129.1, nameKo: '광안리' };
    expect(buildAppNavUrl(d)).not.toMatch(/kakao/);
    expect(buildWebNavUrl(d)).not.toMatch(/kakao/);
  });
});

describe('AC-6 · resolveNextDest 도출 (첫 upcoming + 유한 좌표)', () => {
  it('첫 upcoming 슬롯의 좌표·이름·거리를 NavDest 로 싣는다', () => {
    const result = resolveNextDest([
      projected('done'),
      projected('upcoming', {
        lat: 35.1,
        lng: 129.1,
        nameKo: '광안리',
        distanceRange: '약 1.2km · 도보 추정',
      }),
    ]);

    // webOrigin(TRIP-1222 a — 웹 폴백 전용 앞 슬롯)은 별도 describe 가 잠근다. 앱 출발(origin)은 없다.
    expect(result).toMatchObject({
      lat: 35.1,
      lng: 129.1,
      nameKo: '광안리',
      distanceRange: '약 1.2km · 도보 추정',
    });
    expect(result?.origin ?? null).toBeNull();
  });

  it('첫 upcoming 의 lat 이 null 이면 null 을 반환한다 (좌표 결측)', () => {
    const result = resolveNextDest([
      projected('upcoming', { lat: null, lng: 129.1 }),
    ]);

    expect(result).toBeNull();
  });

  it('upcoming 슬롯이 없으면(전부 done) null 을 반환한다', () => {
    const result = resolveNextDest([projected('done'), projected('done')]);

    expect(result).toBeNull();
  });

  it('done·active 를 건너뛰고 첫 upcoming 을 고른다 (여러 upcoming 중 첫 것)', () => {
    const result = resolveNextDest([
      projected('done', { poiId: 'p-done', lat: 1, lng: 1 }),
      projected('active', { poiId: 'p-active', lat: 2, lng: 2 }),
      projected('upcoming', {
        poiId: 'p-first',
        lat: 35.1,
        lng: 129.1,
        nameKo: '첫 예정',
      }),
      projected('upcoming', {
        poiId: 'p-second',
        lat: 36.0,
        lng: 127.0,
        nameKo: '둘째 예정',
      }),
    ]);

    // webOrigin(TRIP-1222 a — 웹 폴백 전용 앞 슬롯)은 별도 describe 가 잠근다. 앱 출발(origin)은 없다.
    expect(result).toMatchObject({
      lat: 35.1,
      lng: 129.1,
      nameKo: '첫 예정',
      distanceRange: '약 1.2km · 도보 추정',
    });
    expect(result?.origin ?? null).toBeNull();
  });
});

describe('슬롯 단위 · 출발지(origin) 지정 URL (TRIP-1189)', () => {
  const origin = { lat: 35.0, lng: 129.0, nameKo: '해운대' };
  const to = { lat: 35.1, lng: 129.1, nameKo: '광안리' };

  it('buildAppNavUrl 은 origin 이 있으면 slat·slng·sname 을 도착지 앞에 싣는다', () => {
    expect(buildAppNavUrl({ ...to, origin })).toBe(
      `nmap://route/public?slat=35&slng=129&sname=${encodeURIComponent('해운대')}&dlat=35.1&dlng=129.1&dname=${encodeURIComponent('광안리')}&appname=com.trippilot.travel`
    );
  });

  it('buildAppNavUrl 은 origin 이 null·undefined 면 slat 계열이 없다 (현재 위치)', () => {
    expect(buildAppNavUrl({ ...to, origin: null })).not.toContain('slat');
    expect(buildAppNavUrl(to)).not.toContain('sname');
  });

  it('buildAppNavUrl 은 origin.nameKo 가 null 이면 sname 을 "장소"로 대체한다', () => {
    expect(
      buildAppNavUrl({ ...to, origin: { ...origin, nameKo: null } })
    ).toContain(`sname=${encodeURIComponent('장소')}`);
  });

  it('buildWebNavUrl 은 origin 이 있으면 출발 자리에 lng,lat,이름을 싣는다', () => {
    expect(buildWebNavUrl({ ...to, origin })).toBe(
      `https://map.naver.com/p/directions/129,35,${encodeURIComponent('해운대')}/129.1,35.1,${encodeURIComponent('광안리')}/-/transit`
    );
  });

  it('buildWebNavUrl 은 origin 이 없으면 출발이 "-" 다 (기존 형식)', () => {
    expect(buildWebNavUrl({ ...to, origin: null })).toBe(
      `https://map.naver.com/p/directions/-/129.1,35.1,${encodeURIComponent('광안리')}/-/transit`
    );
  });

  it('INV-3 · URL 어디에도 duration·소요시간 파라미터가 없다', () => {
    const urls = [
      buildAppNavUrl({ ...to, origin }),
      buildWebNavUrl({ ...to, origin }),
    ];
    urls.forEach((u) => expect(u).not.toMatch(/duration|time|분/i));
  });
});

describe('웹 폴백 출발지 webOrigin (TRIP-1222 a)', () => {
  const to = { lat: 35.1, lng: 129.1, nameKo: '광안리' };
  const webOrigin = { lat: 35.0, lng: 129.0, nameKo: '해운대' };

  it('buildWebNavUrl 은 origin 이 없고 webOrigin 이 있으면 webOrigin 을 출발지로 싣는다 (웹엔 현재 위치가 없다 — 시뮬레이터 실측)', () => {
    expect(buildWebNavUrl({ ...to, origin: null, webOrigin })).toBe(
      `https://map.naver.com/p/directions/129,35,${encodeURIComponent('해운대')}/129.1,35.1,${encodeURIComponent('광안리')}/-/transit`
    );
  });

  it('origin 이 있으면 origin 이 이긴다 · 앱 스킴은 webOrigin 을 읽지 않는다 (앱은 현재 위치)', () => {
    const origin = { lat: 36, lng: 130, nameKo: '앞' };

    expect(buildWebNavUrl({ ...to, origin, webOrigin })).toContain(
      `130,36,${encodeURIComponent('앞')}/`
    );
    expect(buildAppNavUrl({ ...to, origin: null, webOrigin })).not.toContain(
      'slat'
    );
  });

  it('resolveSlotDests: 첫 upcoming 은 origin 이 없어도 바로 앞(방문 완료) 슬롯이 webOrigin 이다', () => {
    const dests = resolveSlotDests([
      projected('done', { poiId: 'a', nameKo: '앞', lat: 35.0, lng: 129.0 }),
      projected('upcoming', { poiId: 'b', nameKo: '서울도서관' }),
    ]);

    expect(dests.get('b')?.origin ?? null).toBeNull();
    expect(dests.get('b')?.webOrigin).toEqual({
      lat: 35.0,
      lng: 129.0,
      nameKo: '앞',
    });
  });

  it('resolveSlotDests: 맨 앞 슬롯·앞 슬롯 좌표 결측이면 webOrigin 도 없다', () => {
    const dests = resolveSlotDests([
      projected('upcoming', { poiId: 'a', nameKo: 'a' }),
      projected('upcoming', { poiId: 'b', nameKo: 'b', lat: null, lng: null }),
      projected('upcoming', { poiId: 'c', nameKo: 'c' }),
    ]);

    expect(dests.get('a')?.webOrigin ?? null).toBeNull();
    expect(dests.get('c')?.webOrigin ?? null).toBeNull();
  });
});

describe('resolveSlotDests · 슬롯마다 도착지 + 직전 슬롯 출발지 (TRIP-1189)', () => {
  const at = (
    state: SlotState,
    poiId: string,
    over: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ProjectedSlot =>
    projected(state, { poiId, nameKo: `n-${poiId}`, ...over });

  it('방문 완료 슬롯에는 도착지가 없다 · 예정·진행 중에는 있다', () => {
    const dests = resolveSlotDests([
      at('done', 'a'),
      at('active', 'b'),
      at('upcoming', 'c'),
    ]);

    expect(dests.has('a')).toBe(false);
    expect(dests.has('b')).toBe(true);
    expect(dests.has('c')).toBe(true);
  });

  it('첫 upcoming 은 출발지가 없다 (현재 위치) — 앞 슬롯 좌표가 있어도', () => {
    const dests = resolveSlotDests([
      at('done', 'a', { lat: 35.0, lng: 129.0 }),
      at('upcoming', 'b'),
    ]);

    expect(dests.get('b')?.origin ?? null).toBeNull();
  });

  it('둘째 upcoming 부터는 바로 앞 슬롯이 출발지다', () => {
    const dests = resolveSlotDests([
      at('upcoming', 'a', { lat: 35.0, lng: 129.0, nameKo: '앞' }),
      at('upcoming', 'b'),
      at('upcoming', 'c', { lat: 36.0, lng: 128.0 }),
    ]);

    expect(dests.get('b')?.origin).toEqual({
      lat: 35.0,
      lng: 129.0,
      nameKo: '앞',
    });
    expect(dests.get('c')?.origin).toEqual({
      lat: 35.1,
      lng: 129.1,
      nameKo: 'n-b',
    });
  });

  it('진행 중 슬롯의 출발지는 바로 앞(방문 완료) 슬롯이다', () => {
    const dests = resolveSlotDests([
      at('done', 'a', { lat: 35.0, lng: 129.0, nameKo: '앞' }),
      at('active', 'b'),
    ]);

    expect(dests.get('b')?.origin?.nameKo).toBe('앞');
  });

  it('폴백 · 앞 슬롯 좌표가 없으면 출발지를 생략한다 (현재 위치)', () => {
    const dests = resolveSlotDests([
      at('upcoming', 'a'),
      at('upcoming', 'b', { lat: 35.5, lng: 129.5 }),
      at('upcoming', 'x', { lat: null, lng: null }),
      at('upcoming', 'c'),
    ]);

    expect(dests.get('b')?.origin).toBeTruthy();
    expect(dests.has('x')).toBe(false); // 자기 좌표가 없으면 도착지도 없다
    expect(dests.get('c')).toBeTruthy();
    expect(dests.get('c')?.origin ?? null).toBeNull();
  });

  it('맨 앞 진행 중 슬롯은 앞이 없어 출발지를 생략한다', () => {
    expect(
      resolveSlotDests([at('active', 'a')]).get('a')?.origin ?? null
    ).toBeNull();
  });

  it('도착지는 자기 좌표·이름·거리다', () => {
    const dests = resolveSlotDests([
      at('upcoming', 'a', { lat: 35.2, lng: 129.2, nameKo: '광안리' }),
    ]);

    expect(dests.get('a')).toMatchObject({
      lat: 35.2,
      lng: 129.2,
      nameKo: '광안리',
      distanceRange: '약 1.2km · 도보 추정',
    });
  });

  it('PBT · 어떤 배열에도 done 에는 도착지가 없고, origin 은 항상 바로 앞 슬롯의 좌표이며, 첫 upcoming 은 origin 이 없다', () => {
    const slotArb = fc.record({
      state: fc.constantFrom<SlotState>('done', 'active', 'upcoming'),
      lat: fc.option(fc.double({ min: 33, max: 38, noNaN: true }), {
        nil: null,
      }),
      lng: fc.option(fc.double({ min: 124, max: 130, noNaN: true }), {
        nil: null,
      }),
    });
    fc.assert(
      fc.property(fc.array(slotArb, { maxLength: 12 }), (rows) => {
        const list = rows.map((r, i) =>
          at(r.state, `p${i}`, { lat: r.lat, lng: r.lng })
        );
        const dests = resolveSlotDests(list);
        const firstUp = list.findIndex((p) => p.state === 'upcoming');
        list.forEach((p, i) => {
          const dest = dests.get(`p${i}`);
          if (p.state === 'done') expect(dest).toBeUndefined();
          if (!dest) return;
          if (i === firstUp) expect(dest.origin ?? null).toBeNull();
          if (dest.origin) {
            const prev = list[i - 1];
            expect(i).toBeGreaterThan(0);
            expect(dest.origin.lat).toBe(prev.slot.lat);
            expect(dest.origin.lng).toBe(prev.slot.lng);
          }
        });
      })
    );
  });

  it('resolveNextDest 의 의미(첫 upcoming)는 보존된다 — origin 없음', () => {
    const list = [at('done', 'a'), at('upcoming', 'b'), at('upcoming', 'c')];
    const next = resolveNextDest(list);

    expect(next).toEqual(resolveSlotDests(list).get('b'));
  });
});

describe('AC-4 · openNextNav 폴백 사다리 3단 (openURL reject 기반)', () => {
  const dest: NavDest = {
    lat: 35.1,
    lng: 129.1,
    nameKo: '광안리',
    distanceRange: '약 1.2km · 도보 추정',
  };
  const appUrl = buildAppNavUrl(dest);
  const webUrl = buildWebNavUrl(dest);

  it('① 앱 openURL 성공 → "app", openURL 1회, fallback 미호출, canOpenURL 은 부르지 않는다', async () => {
    mockOpenURL.mockResolvedValue(true);
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('app');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(appUrl);
    expect(mockCanOpenURL).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('② 앱 openURL 이 reject(미설치) → 웹 지도로 openURL, "web", fallback 미호출', async () => {
    mockOpenURL
      .mockRejectedValueOnce(new Error('no app'))
      .mockResolvedValueOnce(true);
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('web');
    expect(mockOpenURL).toHaveBeenNthCalledWith(1, appUrl);
    expect(mockOpenURL).toHaveBeenNthCalledWith(2, webUrl);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('③ 웹까지 reject → 거리 요약을 최종 안내로 내린다 (fallback(distanceRange), "distance") — 삼키지 않는다', async () => {
    mockOpenURL.mockRejectedValue(new Error('none'));
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('distance');
    expect(mockOpenURL).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith('약 1.2km · 도보 추정');
  });

  it('④ distanceRange 가 null 이어도 fallback 은 호출된다 (null 전달)', async () => {
    mockOpenURL.mockRejectedValue(new Error('none'));
    const fallback = jest.fn();

    await openNextNav({ ...dest, distanceRange: null }, fallback);

    expect(fallback).toHaveBeenCalledWith(null);
  });
});

describe('AC-7 · 매끄러운 복귀 = 유틸이 라우터를 모른다 (구조 소스 스캔)', () => {
  const NAV_CALL = /\brouter\.(push|replace|navigate|back)\b/;
  const ROUTER_IMPORT = /from ['"]expo-router['"]/;

  // 블록 주석 → 줄 주석(콜론 예외). nextNav.ts 는 `nmap://`·`https://` URL 을 담으므로
  // 콜론 예외가 없으면 `://` 의 슬래시를 주석으로 오인해 URL 뒷부분(그리고 같은 줄 코드)을
  // 지운다 — 전처리×탐지기 상호소거 함정(리포 관례, [[stripComments가 URL 슬래시 오인]]).
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const readNextNavSource = (): string => {
    const full = path.join(__dirname, 'nextNav.ts');
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
  };

  it('G · 자가검사 — 주석은 걷히고 URL(://)은 살아남고 실제 router 호출은 잡힌다', () => {
    const sample = [
      '// router.push 를 얹으면 복귀가 깨진다(금지).',
      'const appUrl = `nmap://route/public?dlat=${lat}`;',
      'const webUrl = `https://map.naver.com/p/directions/${name}`;',
      'export async function openNextNav() {}',
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 router.push 는 걷혀서 부정 단언을 거짓 red 로 만들지 않는다.
    expect(NAV_CALL.test(stripped)).toBe(false);
    // ② URL 의 // 는 주석이 아니다(콜론 예외) — 전처리가 URL 을 지우지 않는다.
    expect(stripped).toContain('nmap://route/public?');
    expect(stripped).toContain('https://map.naver.com/p/directions/');
    // ③ 짝 — 실제 코드의 router.push 는 잡는다(우회 불가 증명).
    expect(NAV_CALL.test('router.push("/(tabs)")')).toBe(true);
  });

  it('nextNav.ts 는 expo-router import·router 네비게이션 호출이 0건이다', () => {
    const source = stripComments(readNextNavSource());

    // 긍정 앵커 — 실제로 유틸을 읽고 있다(빈/미완 파일 공허 통과 방지).
    expect(source).toContain('openNextNav');
    // 부정 — 라우터 미개입: 외부 앱만 띄우고 우리 라우트는 그대로라 복귀가 저절로 성립.
    expect(ROUTER_IMPORT.test(source)).toBe(false);
    expect(NAV_CALL.test(source)).toBe(false);
  });
});
