import fc from 'fast-check';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';

import {
  buildStayRegisterRequest,
  canSubmitStayRegister,
  type StayRegisterFlow,
} from './stayRegisterForm';

/**
 * FP-1~FP-4 (AC-6 · AC-7 · D2 · D3 · S-2 · S-4 · 02a §4-D) — 핀 경로의 판정과 요청 조립.
 *
 * 무엇을 보장하나: **좌표가 어디서 왔는지가 `registerRoute`를 정한다**(탭이 아니라 출처가
 * 정한다 — D4). 그리고 숙소명은 사용자가 친 값이 이기고, 안 쳤을 때만 후보/건물명으로
 * 떨어진다(D2 — 입력 소실 금지).
 *
 * 동결 `stayRegisterForm.test.ts`(F-7·F-8)는 지도 검색 경로를 담당한다. 이 파일은 핀 경로만
 * 더한다 — 동결 파일의 케이스를 옮겨오지 않는다.
 *
 * 좌표 슬롯은 하나다(02a ★10): 핀 좌표도 기존 `selectedCandidate`에 담고 출처만
 * `coordSource`가 태그한다. 그래서 'A의 좌표 + B의 이름'이 담길 공간 자체가 없다.
 */

/** 지도 검색으로 고른 후보. */
const SEARCH_CANDIDATE: GeocodeCandidate = {
  name: '해운대 그랜드 호텔',
  address: '부산 해운대구 우동 1407',
  lat: 35.1587,
  lng: 129.1604,
};

/** 핀을 찍고 역지오코딩이 성공한 결과 — 모양이 GeocodeCandidate와 그대로 맞는다. */
const PIN_RESULT: GeocodeCandidate = {
  name: '해운대 아르떼 빌딩',
  address: '부산 해운대구 중동 1394',
  lat: 35.1621,
  lng: 129.1688,
};

/** 핀으로 좌표까지 확정한 "등록 직전" 상태 — 케이스마다 한 축만 무너뜨린다. */
const PIN_READY: StayRegisterFlow = {
  activeTab: 'pin',
  query: '',
  name: '',
  searchStatus: 'idle',
  candidates: [],
  selectedCandidate: PIN_RESULT,
  coordSource: 'PIN',
  pinAddressStatus: 'ok',
  coordConfirmed: true,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

describe('FP-1 · 좌표의 출처가 registerRoute를 정한다 (AC-7 · S-4)', () => {
  it('핀으로 잡은 좌표는 PIN으로, 지도 검색으로 잡은 좌표는 MAP_SEARCH로 나간다', () => {
    // 핀 — 이 칸이 새로 여는 경로.
    const pinRequest = buildStayRegisterRequest(PIN_READY);
    expect(pinRequest?.registerRoute).toBe('PIN');
    expect(pinRequest?.lat).toBe(PIN_RESULT.lat);
    expect(pinRequest?.lng).toBe(PIN_RESULT.lng);
    expect(pinRequest?.coordConfirmed).toBe(true);

    // 짝 — 같은 함수가 지도 검색 좌표는 여전히 MAP_SEARCH로 보낸다(무회귀).
    const searchRequest = buildStayRegisterRequest({
      ...PIN_READY,
      selectedCandidate: SEARCH_CANDIDATE,
      coordSource: 'MAP_SEARCH',
      pinAddressStatus: 'idle',
    });
    expect(searchRequest?.registerRoute).toBe('MAP_SEARCH');
  });

  it('탭이 어디에 있든 출처만이 경로를 정한다 (D4 — 탭 전환은 좌표를 건드리지 않는다)', () => {
    // 화면이 어느 탭을 보고 있는지는 서버로 나가는 값에 영향을 주면 안 된다.
    // 탭으로 registerRoute를 정하는 구현(가장 흔한 지름길)이 여기서 걸린다.
    fc.assert(
      fc.property(
        fc.constantFrom<StayRegisterFlow['activeTab']>(
          'mapsearch',
          'linkpaste',
          'pin'
        ),
        fc.constantFrom<StayRegisterFlow['coordSource']>('MAP_SEARCH', 'PIN'),
        (activeTab, coordSource) => {
          const request = buildStayRegisterRequest({
            ...PIN_READY,
            activeTab,
            coordSource,
          });
          expect(request?.registerRoute).toBe(coordSource);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('FP-2 · 숙소명은 사용자가 친 값이 이긴다 (D2 · S-2 · 입력 소실 금지)', () => {
  const CASES: { name: string; typed: string; expected: string }[] = [
    {
      name: '이름 칸이 비어 있으면 후보/건물명으로 떨어진다',
      typed: '',
      expected: PIN_RESULT.name,
    },
    {
      name: '공백만 쳤으면 비어 있는 것으로 본다',
      typed: '   ',
      expected: PIN_RESULT.name,
    },
    {
      name: '사용자가 친 이름이 있으면 그것으로 나간다',
      typed: '내가 예약한 숙소',
      expected: '내가 예약한 숙소',
    },
    {
      name: '앞뒤 공백은 다듬어서 나간다',
      typed: '  내가 예약한 숙소  ',
      expected: '내가 예약한 숙소',
    },
  ];

  it.each(CASES)('$name', ({ typed, expected }) => {
    expect(buildStayRegisterRequest({ ...PIN_READY, name: typed })?.name).toBe(
      expected
    );
  });

  it('역지오코딩이 건물명을 못 준 핀도 사용자가 친 이름으로 등록된다 (D3 짝)', () => {
    // 좌표만 있고 이름이 빈 핀 — Q2의 공백을 사람이 메우는 경로다(Figma "숙소명 직접 입력").
    const nameless: GeocodeCandidate = { ...PIN_RESULT, name: '', address: '' };

    expect(
      buildStayRegisterRequest({
        ...PIN_READY,
        selectedCandidate: nameless,
        pinAddressStatus: 'error',
        name: '이름만 아는 숙소',
      })?.name
    ).toBe('이름만 아는 숙소');
  });
});

describe('FP-3 · 좌표 게이트는 출처와 무관하다 (AC-6 · BR-U1-22 · INV-U1-08)', () => {
  it('coordConfirmed가 false면 핀으로 찍었어도 등록할 수 없다', () => {
    // 가중치 1.0 규칙이 새 경로에도 그대로 적용된다 — "핀은 사람이 직접 찍었으니 확정으로
    // 쳐 주자"는 지름길을 원천 차단한다(D5 — 확정은 bottom-sheet 단일 경로).
    fc.assert(
      fc.property(
        fc.record({
          activeTab: fc.constantFrom<StayRegisterFlow['activeTab']>(
            'mapsearch',
            'linkpaste',
            'pin'
          ),
          coordSource: fc.constantFrom<StayRegisterFlow['coordSource']>(
            'MAP_SEARCH',
            'PIN'
          ),
          pinAddressStatus: fc.constantFrom<
            StayRegisterFlow['pinAddressStatus']
          >('idle', 'loading', 'ok', 'error'),
          name: fc.string(),
          hasDates: fc.boolean(),
        }),
        (input) => {
          expect(
            canSubmitStayRegister({
              ...PIN_READY,
              activeTab: input.activeTab,
              coordSource: input.coordSource,
              pinAddressStatus: input.pinAddressStatus,
              name: input.name,
              coordConfirmed: false,
              checkIn: input.hasDates ? '2026-06-10' : null,
              checkOut: input.hasDates ? '2026-06-12' : null,
            })
          ).toBe(false);
        }
      ),
      { numRuns: 300 }
    );

    // 가짜 통과 방지 짝 — "항상 false"인 구현도 위 성질만으로는 통과한다.
    expect(canSubmitStayRegister(PIN_READY)).toBe(true);
  });
});

describe('FP-4 · 역지오코딩 실패가 등록을 막지 않는다 (D3 · INV-4 · BR-U1-55)', () => {
  it('주소를 못 받았어도 좌표만으로 등록이 열린다', () => {
    // 저장 정본은 좌표이고 주소는 표시용 사본이다(확정 3) — 사본이 없다고 정본을 막을
    // 근거가 없다. 막으면 "지도가 안 될 때 쓰는 폴백"이 지도보다 더 잘 끊긴다.
    const failed: StayRegisterFlow = {
      ...PIN_READY,
      selectedCandidate: { ...PIN_RESULT, name: '', address: '' },
      pinAddressStatus: 'error',
      name: '직접 입력한 숙소',
    };

    expect(canSubmitStayRegister(failed)).toBe(true);

    const request = buildStayRegisterRequest(failed);
    expect(request?.registerRoute).toBe('PIN');
    expect(request?.lat).toBe(PIN_RESULT.lat);
    expect(request?.lng).toBe(PIN_RESULT.lng);
    expect(request?.coordConfirmed).toBe(true);
  });
});
