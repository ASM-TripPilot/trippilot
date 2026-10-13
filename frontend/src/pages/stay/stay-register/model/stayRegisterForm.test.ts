import fc from 'fast-check';
import type { GeocodeCandidate } from '@/shared/api/index.schemas';
import {
  buildStayRegisterRequest,
  canSubmitStayRegister,
  type StayRegisterFlow,
} from './stayRegisterForm';

/**
 * e05 등록 폼 순수 함수 — `canSubmitStayRegister`·`buildStayRegisterRequest` property 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1148, README 판정 1): 같은 두 함수를 보던 옛 `stayRegisterForm.test.ts`(검색 후보 경로)·
 * `.pin.test.ts`(핀 경로)를 각자의 바깥 describe 로 옮겼다. property 는 하나도 지우지 않았다.
 */

// 옛 stayRegisterForm.test
describe('검색 후보 경로 (옛 본 파일)', () => {
  /**
   * F-7 · F-8 (AC-1 · AC-3 · AC-4 · AC-5 · 01b Seed §3-5) — 등록 폼의 판정과 요청 조립.
   *
   * 무엇을 보장하나: "지금 등록해도 되는가"(`canSubmitStayRegister`)의 답이 좌표·후보·제출 중·
   * 이름에서만 나오고(날짜 입력은 TRIP-1052에서 사라졌다), 서버로 보낼 본문
   * (`buildStayRegisterRequest`)이 계약대로 조립된다 — 특히 **`checkIn`·`checkOut` 키가 절대
   * 붙지 않는다**(TRIP-1052 AC-2 — 서버 계약에는 nullable로 남지만 앱은 싣지 않는다).
   *
   * 클라이언트 검증은 UX 사본이고 판정 정본은 서버지만(§5), **좌표 게이트만은 클라이언트가
   * 진짜로 막아야 한다**(AC-3 — 서버 400에 의존하면 위반). 그 무결성을 여기서 PBT로 잠근다.
   */

  /** 픽스처는 파일마다 각자 갖는 것이 리포 관례다(02a ★15). */
  const CANDIDATE: GeocodeCandidate = {
    name: '해운대 그랜드 호텔',
    address: '부산 해운대구 우동 1407',
    lat: 35.1587,
    lng: 129.1604,
  };

  /** 등록 직전(모든 조건이 갖춰진) 기본 상태 — 케이스마다 한 축만 무너뜨린다. */
  const READY: StayRegisterFlow = {
    // TRIP-199 신규 4축은 required라 여기서 채워야 한다. `name: ''`은 "사용자가 이름을 안
    // 쳤다"는 뜻이고, 그때 요청의 name은 후보 이름으로 떨어진다(02a ★11) — 아래 F-8의
    // 기존 단언이 그대로 유지되는 이유다.
    activeTab: 'mapsearch',
    query: '해운대',
    name: '',
    searchStatus: 'success',
    candidates: [CANDIDATE],
    selectedCandidate: CANDIDATE,
    coordSource: 'MAP_SEARCH',
    pinAddressStatus: 'idle',
    coordConfirmed: true,
    mapSheetState: 'closed',
    submitStatus: 'idle',
    submitAttempted: false,
  };

  describe('canSubmitStayRegister — 등록 가능 판정 (F-7)', () => {
    const CASES: { name: string; flow: StayRegisterFlow; expected: boolean }[] =
      [
        {
          name: '후보를 아직 고르지 않음 → 불가',
          flow: { ...READY, selectedCandidate: null, coordConfirmed: false },
          expected: false,
        },
        {
          name: '후보는 골랐지만 좌표 미확정 → 불가 (AC-3 · §3-2 라디오 선택만으로는 false)',
          flow: { ...READY, coordConfirmed: false },
          expected: false,
        },
        {
          name: '좌표 확정 → 가능 (US-STAY-08 좌표만으로 등록 완료)',
          flow: READY,
          expected: true,
        },
        {
          name: '이미 제출 중 → 불가 (§3-5 중복 제출 차단)',
          flow: { ...READY, submitStatus: 'submitting' },
          expected: false,
        },
      ];

    it.each(CASES)('$name', ({ flow, expected }) => {
      expect(canSubmitStayRegister(flow)).toBe(expected);
    });

    it('coordConfirmed가 false이면 다른 어떤 필드도 그 판정을 뒤집지 못한다 (좌표게이트 무결성)', () => {
      // 가중치 1.0 원칙의 기계적 강제 — "이름은 있으니 보내자" 같은 우회를 원천 차단한다.
      fc.assert(
        fc.property(
          fc.record({
            query: fc.string(),
            searchStatus: fc.constantFrom<StayRegisterFlow['searchStatus']>(
              'idle',
              'loading',
              'success',
              'empty',
              'error'
            ),
            mapSheetState: fc.constantFrom<StayRegisterFlow['mapSheetState']>(
              'closed',
              'open',
              'open-map-failed'
            ),
            submitStatus: fc.constantFrom<StayRegisterFlow['submitStatus']>(
              'idle',
              'error'
            ),
            hasCandidate: fc.boolean(),
          }),
          (input) => {
            const flow: StayRegisterFlow = {
              // TRIP-199 신규 4축은 required라 이 리터럴도 채워야 한다(게이트①-2).
              // 이 성질이 재는 것은 `coordConfirmed=false`의 절대성이므로 네 축은 고정값으로
              // 둔다 — 이 축들을 흔든 판은 `stayRegisterForm.pin.test.ts` FP-3이 진다.
              activeTab: 'mapsearch',
              name: '',
              coordSource: 'MAP_SEARCH',
              pinAddressStatus: 'idle',
              query: input.query,
              searchStatus: input.searchStatus,
              candidates: [CANDIDATE],
              selectedCandidate: input.hasCandidate ? CANDIDATE : null,
              coordConfirmed: false,
              mapSheetState: input.mapSheetState,
              submitStatus: input.submitStatus,
              submitAttempted: false,
            };
            expect(canSubmitStayRegister(flow)).toBe(false);
          }
        ),
        { numRuns: 500 }
      );

      // 가짜 통과 방지 짝 — "항상 false를 반환하는 구현"도 위 성질만으로는 통과하므로,
      // 같은 조합에서 coordConfirmed만 true로 뒤집으면 실제로 true가 나오는 것을 잠근다.
      // (TRIP-1052 — 예전엔 날짜 유무 축을 흔들었으나 그 축이 사라져 직접 단언 한 줄로 충분하다.)
      expect(canSubmitStayRegister({ ...READY, coordConfirmed: true })).toBe(
        true
      );
    });
  });

  describe('buildStayRegisterRequest — 요청 본문 조립 (F-8 · AC-1 · TRIP-1052 AC-2)', () => {
    it('고른 후보가 없으면 null을 돌려준다 (보낼 것이 없다)', () => {
      expect(
        buildStayRegisterRequest({ ...READY, selectedCandidate: null })
      ).toBeNull();
    });

    it('🔴 요청 본문의 키는 정확히 다섯 개다 — checkIn·checkOut 키가 없다 (TRIP-1052 AC-2)', () => {
      const request = buildStayRegisterRequest(READY);

      expect(request).toEqual({
        name: '해운대 그랜드 호텔',
        registerRoute: 'MAP_SEARCH',
        lat: 35.1587,
        lng: 129.1604,
        coordConfirmed: true,
      });
      // toEqual은 값이 undefined인 키를 무시한다 — 키 목록 자체를 완전일치로 잠근다.
      // `checkIn: null`은 물론 `checkIn: undefined`로 키만 남는 것도 여기서 red다.
      expect(Object.keys(request ?? {}).sort()).toEqual([
        'coordConfirmed',
        'lat',
        'lng',
        'name',
        'registerRoute',
      ]);
    });

    it('좌표 출처가 MAP_SEARCH이면 registerRoute도 MAP_SEARCH이고 좌표는 후보 값 그대로다', () => {
      // TRIP-199 계약 변경(전제): 원래 제목은 "어떤 상태에서도 MAP_SEARCH"였고 주석은
      // "LINK_PASTE·PIN이 새어 나갈 길이 없다"였다. TRIP-199가 핀 경로를 열면서 그 전제가
      // 거짓이 됐다 — 이제 `registerRoute`는 **좌표의 출처**(`coordSource`)를 따른다(D4).
      // 단언 본문은 그대로 참이다(READY의 출처가 MAP_SEARCH라서). 사실과 어긋난 제목·주석만
      // 고친다. 핀 쪽 판정은 `stayRegisterForm.pin.test.ts` FP-1이 진다.
      fc.assert(
        fc.property(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }),
            address: fc.string({ minLength: 1, maxLength: 40 }),
            lat: fc.double({ min: 33, max: 39, noNaN: true }),
            lng: fc.double({ min: 124, max: 132, noNaN: true }),
            coordConfirmed: fc.boolean(),
          }),
          (input) => {
            const candidate: GeocodeCandidate = {
              name: input.name,
              address: input.address,
              lat: input.lat,
              lng: input.lng,
            };
            const request = buildStayRegisterRequest({
              ...READY,
              candidates: [candidate],
              selectedCandidate: candidate,
              coordConfirmed: input.coordConfirmed,
            });

            expect(request).not.toBeNull();
            expect(request?.registerRoute).toBe('MAP_SEARCH');
            expect(request?.name).toBe(input.name);
            expect(request?.lat).toBe(input.lat);
            expect(request?.lng).toBe(input.lng);
            // 확정 여부를 임의로 참으로 바꿔 서버에 거짓말하지 않는다.
            expect(request?.coordConfirmed).toBe(input.coordConfirmed);
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});

// 옛 stayRegisterForm.pin — TRIP-866
describe('핀 경로 (옛 .pin)', () => {
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
    submitStatus: 'idle',
    submitAttempted: false,
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
      expect(
        buildStayRegisterRequest({ ...PIN_READY, name: typed })?.name
      ).toBe(expected);
    });

    it('역지오코딩이 건물명을 못 준 핀도 사용자가 친 이름으로 등록된다 (D3 짝)', () => {
      // 좌표만 있고 이름이 빈 핀 — Q2의 공백을 사람이 메우는 경로다(Figma "숙소명 직접 입력").
      const nameless: GeocodeCandidate = {
        ...PIN_RESULT,
        name: '',
        address: '',
      };

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
});
