import fs from 'fs';
import path from 'path';

import * as Linking from 'expo-linking';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { ProjectedSlot, SlotState } from './slotProgress';
import {
  buildAppNavUrl,
  buildWebNavUrl,
  openNextNav,
  resolveNextDest,
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

describe('AC-5 · URL 빌더 (순수 함수)', () => {
  it('buildAppNavUrl 은 kakaomap route 딥링크에 목적지 좌표만 싣는다 (출발지 생략)', () => {
    expect(buildAppNavUrl({ lat: 35.1, lng: 129.1 })).toBe(
      'kakaomap://route?ep=35.1,129.1'
    );
  });

  it('buildWebNavUrl 은 카카오맵 웹 link/to URL 에 이름·좌표를 raw(무인코딩)로 싣는다', () => {
    expect(buildWebNavUrl({ lat: 35.1, lng: 129.1, nameKo: '광안리' })).toBe(
      'https://map.kakao.com/link/to/광안리,35.1,129.1'
    );
  });

  it('buildWebNavUrl 은 nameKo 가 null 이면 "장소"로 대체한다', () => {
    expect(buildWebNavUrl({ lat: 35.1, lng: 129.1, nameKo: null })).toBe(
      'https://map.kakao.com/link/to/장소,35.1,129.1'
    );
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

    expect(result).toEqual({
      lat: 35.1,
      lng: 129.1,
      nameKo: '광안리',
      distanceRange: '약 1.2km · 도보 추정',
    });
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

    expect(result).toEqual({
      lat: 35.1,
      lng: 129.1,
      nameKo: '첫 예정',
      distanceRange: '약 1.2km · 도보 추정',
    });
  });
});

describe('AC-4 · openNextNav 폴백 사다리 3단', () => {
  const dest: NavDest = {
    lat: 35.1,
    lng: 129.1,
    nameKo: '광안리',
    distanceRange: '약 1.2km · 도보 추정',
  };
  const appUrl = 'kakaomap://route?ep=35.1,129.1';
  const webUrl = 'https://map.kakao.com/link/to/광안리,35.1,129.1';

  it('① 외부앱 열림 → 앱 딥링크로 openURL, "app" 반환, fallback 미호출', async () => {
    mockCanOpenURL.mockResolvedValue(true);
    mockOpenURL.mockResolvedValue(true);
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('app');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(appUrl);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('② 외부앱 없음(canOpenURL false) → 웹 지도로 openURL, "web" 반환, fallback 미호출', async () => {
    mockCanOpenURL.mockResolvedValue(false);
    mockOpenURL.mockResolvedValue(true);
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('web');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(webUrl);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('③ 앱 열기 시도가 reject 되면 웹으로 강등한다 (openURL: 앱→웹 순서)', async () => {
    mockCanOpenURL.mockResolvedValue(true);
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

  it('④ 웹 지도까지 reject 되면 거리 요약을 최종 안내로 내린다 (fallback(distanceRange), "distance")', async () => {
    mockCanOpenURL.mockResolvedValue(false);
    mockOpenURL.mockRejectedValue(new Error('no web'));
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('distance');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith('약 1.2km · 도보 추정');
  });
});

describe('AC-7 · 매끄러운 복귀 = 유틸이 라우터를 모른다 (구조 소스 스캔)', () => {
  const NAV_CALL = /\brouter\.(push|replace|navigate|back)\b/;
  const ROUTER_IMPORT = /from ['"]expo-router['"]/;

  // 블록 주석 → 줄 주석(콜론 예외). nextNav.ts 는 `kakaomap://`·`https://` URL 을 담으므로
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
      'const appUrl = `kakaomap://route?ep=${lat},${lng}`;',
      'const webUrl = `https://map.kakao.com/link/to/${name}`;',
      'export async function openNextNav() {}',
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 router.push 는 걷혀서 부정 단언을 거짓 red 로 만들지 않는다.
    expect(NAV_CALL.test(stripped)).toBe(false);
    // ② URL 의 // 는 주석이 아니다(콜론 예외) — 전처리가 URL 을 지우지 않는다.
    expect(stripped).toContain('kakaomap://route?ep=');
    expect(stripped).toContain('https://map.kakao.com/link/to/');
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
