import fc from 'fast-check';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';

import {
  buildStayRegisterRequest,
  canSubmitStayRegister,
  type StayRegisterFlow,
} from './stayRegisterForm';

/**
 * F-7 · F-8 (AC-1 · AC-3 · AC-4 · AC-5 · 01b Seed §3-5) — 등록 폼의 판정과 요청 조립.
 *
 * 무엇을 보장하나: "지금 등록해도 되는가"(`canSubmitStayRegister`)의 답이 좌표 확정 여부와
 * 날짜 유효성에서만 나오고, 서버로 보낼 본문(`buildStayRegisterRequest`)이 계약대로
 * 조립된다 — 특히 **날짜를 비웠으면 `checkIn`·`checkOut` 키 자체가 붙지 않는다**(AC-5).
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
  query: '해운대',
  searchStatus: 'success',
  candidates: [CANDIDATE],
  selectedCandidate: CANDIDATE,
  coordConfirmed: true,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

describe('canSubmitStayRegister — 등록 가능 판정 (F-7)', () => {
  const CASES: { name: string; flow: StayRegisterFlow; expected: boolean }[] = [
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
      name: '좌표 확정 + 날짜 없음 → 가능 (AC-5 날짜 필수화는 위반)',
      flow: READY,
      expected: true,
    },
    {
      name: '정상 날짜 범위 → 가능',
      flow: { ...READY, checkIn: '2026-06-10', checkOut: '2026-06-12' },
      expected: true,
    },
    {
      name: '체크아웃이 체크인보다 빠름 → 불가 (AC-4)',
      flow: { ...READY, checkIn: '2026-06-12', checkOut: '2026-06-10' },
      expected: false,
    },
    {
      name: '체크인·체크아웃이 같은 날 → 불가 (INV-U1-09)',
      flow: { ...READY, checkIn: '2026-06-10', checkOut: '2026-06-10' },
      expected: false,
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
          hasDates: fc.boolean(),
          dateSheetOpen: fc.boolean(),
        }),
        (input) => {
          const flow: StayRegisterFlow = {
            query: input.query,
            searchStatus: input.searchStatus,
            candidates: [CANDIDATE],
            selectedCandidate: input.hasCandidate ? CANDIDATE : null,
            coordConfirmed: false,
            mapSheetState: input.mapSheetState,
            checkIn: input.hasDates ? '2026-06-10' : null,
            checkOut: input.hasDates ? '2026-06-12' : null,
            dateSheetOpen: input.dateSheetOpen,
            submitStatus: input.submitStatus,
          };
          expect(canSubmitStayRegister(flow)).toBe(false);
        }
      ),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — "항상 false를 반환하는 구현"도 위 성질만으로는 통과하므로,
    // 같은 조합에서 coordConfirmed만 true로 뒤집으면 실제로 true가 나오는 것을 잠근다.
    fc.assert(
      fc.property(fc.boolean(), (hasDates) => {
        expect(
          canSubmitStayRegister({
            ...READY,
            coordConfirmed: true,
            checkIn: hasDates ? '2026-06-10' : null,
            checkOut: hasDates ? '2026-06-12' : null,
          })
        ).toBe(true);
      }),
      { numRuns: 500 }
    );
  });
});

describe('buildStayRegisterRequest — 요청 본문 조립 (F-8 · AC-1 · AC-5)', () => {
  it('고른 후보가 없으면 null을 돌려준다 (보낼 것이 없다)', () => {
    expect(
      buildStayRegisterRequest({ ...READY, selectedCandidate: null })
    ).toBeNull();
  });

  it('날짜를 비우면 checkIn·checkOut 키 자체가 붙지 않는다 (AC-5)', () => {
    const request = buildStayRegisterRequest(READY);

    expect(request).toEqual({
      name: '해운대 그랜드 호텔',
      registerRoute: 'MAP_SEARCH',
      lat: 35.1587,
      lng: 129.1604,
      coordConfirmed: true,
    });
    // toEqual은 값이 undefined인 키를 무시한다 — 키의 부재 자체를 따로 잠근다.
    expect(request !== null && 'checkIn' in request).toBe(false);
    expect(request !== null && 'checkOut' in request).toBe(false);
  });

  it('날짜가 있으면 그대로 실린다', () => {
    expect(
      buildStayRegisterRequest({
        ...READY,
        checkIn: '2026-06-10',
        checkOut: '2026-06-12',
      })
    ).toEqual({
      name: '해운대 그랜드 호텔',
      registerRoute: 'MAP_SEARCH',
      lat: 35.1587,
      lng: 129.1604,
      coordConfirmed: true,
      checkIn: '2026-06-10',
      checkOut: '2026-06-12',
    });
  });

  it('후보가 있으면 registerRoute는 어떤 상태에서도 MAP_SEARCH이고 좌표는 후보 값 그대로다', () => {
    // 이 칸의 등록 경로는 지도 검색 하나뿐이다(§3-5). LINK_PASTE·PIN이 새어 나갈 길이 없다.
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
