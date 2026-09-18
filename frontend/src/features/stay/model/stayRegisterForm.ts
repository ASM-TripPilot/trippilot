/**
 * 숙소 등록 폼의 판정·조립(01b Seed §3-5 · F-7 · F-8 · AC-1 · AC-3 · AC-4 · AC-5).
 *
 * 판정 정본은 서버지만(§5), 좌표 게이트만은 클라이언트가 진짜로 막아야 한다(AC-3 — 서버
 * 400에 의존하면 위반). 그래서 `canSubmitStayRegister`는 zod를 거치지 않고 `coordConfirmed`·
 * `selectedCandidate`·`submitStatus`를 직접 본다. 날짜 순서(BR-U1-26 · INV-U1-09)는 서버도
 * 검증하는 UX 사본이라 zod 스키마로 표현한다(§3-5 "폼 = zod + useState").
 */
import { z } from 'zod';

import type {
  GeocodeCandidate,
  RegisterSavedStayRequest,
} from '@/shared/api/generated/schemas';

import { isStayRangeValid } from './stayDates';

/** 3탭 셸의 탭 식별자(TRIP-199). `linkpaste`는 여전히 잠겨 있다(D6·범위 밖). */
export type StayRegisterTab = 'mapsearch' | 'linkpaste' | 'pin';

export interface StayRegisterFlow {
  activeTab: StayRegisterTab;
  query: string;
  /** 사용자가 직접 친 숙소명(D2·D7·S-5). 비어 있으면 후보/건물명으로 떨어진다(★11) — 값이
   * 있으면 재핀에도 덮이지 않는다. */
  name: string;
  searchStatus: 'idle' | 'loading' | 'success' | 'empty' | 'error';
  candidates: GeocodeCandidate[];
  /** 좌표 슬롯은 하나다(02a ★10) — 핀으로 찍은 좌표도 여기 담기고 출처만 coordSource가 태그한다.
   * 'A의 좌표 + B의 이름'이 담길 자리가 구조적으로 없다. */
  selectedCandidate: GeocodeCandidate | null;
  /** 위 좌표가 어디서 왔는지(D4·AC-7) — registerRoute를 이 값이 정한다. orval의 RegisterRoute를
   * 재사용하지 않는다(★15) — 그 타입은 범위 밖 값 LINK_PASTE도 허용해 컴파일러가 못 막는다. */
  coordSource: 'MAP_SEARCH' | 'PIN';
  /** 핀 좌표의 역지오코딩 진행 상태(AC-4·AC-5). 저장 정본은 좌표이고 이 상태·주소는 표시용
   * 사본이라, 실패해도 등록을 막지 않는다(D3·INV-4). */
  pinAddressStatus: 'idle' | 'loading' | 'ok' | 'error';
  coordConfirmed: boolean;
  mapSheetState: 'closed' | 'open' | 'open-map-failed';
  checkIn: string | null;
  checkOut: string | null;
  dateSheetOpen: boolean;
  submitStatus: 'idle' | 'submitting' | 'error';
}

/** 날짜 유효성의 UX 사본(BR-U1-26 · INV-U1-09). 판정 정본은 서버다 — 여기서 막아도 서버가
 * 다시 판정한다. */
export const stayRegisterSchema = z
  .object({
    checkIn: z.string().nullable(),
    checkOut: z.string().nullable(),
  })
  .refine((value) => isStayRangeValid(value.checkIn, value.checkOut), {
    message: '체크아웃은 체크인 이후 날짜여야 해요',
    path: ['checkOut'],
  });

/** 서버로 나갈 이름 — 사용자가 친 값이 있으면 그것, 비었으면 후보/건물명으로 떨어진다
 * (D2·★11). 게이트(canSubmitStayRegister)와 조립(buildStayRegisterRequest)이 같은 식을
 * 써야 "게이트는 열렸는데 조립하면 빈 이름"이 갈라지지 않는다(5-b W-2).
 *
 * 5-b 2차(W-4) — `name`(입력창) 하나만 받도록 시그니처를 좁혔다(예전엔 `flow` 전체를
 * 받았는데 실제로 읽는 필드는 `flow.name`뿐이었다). 화면(`StayRegisterScreen`)이 "이름이
 * 비어 등록이 잠겼다"는 안내를 그리려면 같은 판정을 재사용해야 하는데, 화면은 `StayRegisterFlow`
 * 전체가 아니라 `name` 문자열 하나만 prop으로 받는다(G-2 — 무상태 화면은 자기가 그릴 값만
 * 안다) — 시그니처를 좁혀야 그 값 하나로 바로 부를 수 있고, 게이트·조립·안내 세 곳이 같은
 * 함수를 쓴다(복사하면 그중 하나만 고치는 드리프트가 다시 생긴다, W-2와 같은 이유).
 */
export function resolveName(name: string, candidateName: string): string {
  const trimmed = name.trim();
  return trimmed !== '' ? trimmed : candidateName;
}

/** 지금 등록해도 되는가. 좌표 게이트(AC-3)는 다른 어떤 필드도 뒤집지 못한다(가중치 1.0).
 * 이름 게이트(5-b W-2)는 그 다음이다 — 서버가 name을 NotBlank로 요구하므로, 빈 이름으로
 * 열린 버튼은 반드시 400을 받고 「다시 시도」가 같은 400을 반복한다(AC-3 "서버 400에
 * 의존하면 위반"의 이름 판).
 *
 * 5-c(W-7) — 이 검사만 `.trim()`을 한 번 더 한다. `resolveName`은 여기선 못 건드린다 —
 * `buildStayRegisterRequest`를 직접 부르는 동결 PBT(`stayRegisterForm.test.ts`)가 후보
 * 이름을 (공백이 섞여 있어도) **가공 없이 그대로** 실어 나가는지를 잰다(`request?.name`이
 * `input.name`과 바이트 단위로 같아야 한다) — `resolveName` 안에서 폴백을 trim하면 그 단언이
 * 깨진다. 대신 게이트 쪽만 "다듬어도 빈 문자열이면 잠근다"로 강화한다 — 폴백(후보 이름)이
 * 공백만이면(`"   "`) `resolveName`은 그 값을 그대로 돌려주므로 `=== ''`는 못 잡지만
 * `.trim() === ''`는 잡는다. 실제 제출 경로(`StayRegisterPage.handleSubmit`)는 이 게이트를
 * 통과해야만 `buildStayRegisterRequest`를 부르므로, 화면에서 공백 이름이 서버로 나가는
 * 경로는 이걸로 닫힌다 — 게이트가 조립보다 엄격해지는 방향이라 "게이트는 열렸는데
 * 조립하면 빈 이름"(W-2) 역방향은 생기지 않는다. */
export function canSubmitStayRegister(flow: StayRegisterFlow): boolean {
  if (flow.selectedCandidate === null) return false;
  if (!flow.coordConfirmed) return false;
  if (flow.submitStatus === 'submitting') return false;
  if (resolveName(flow.name, flow.selectedCandidate.name).trim() === '')
    return false;
  return stayRegisterSchema.safeParse({
    checkIn: flow.checkIn,
    checkOut: flow.checkOut,
  }).success;
}

/** 서버로 보낼 본문 조립. 후보가 없으면 null(보낼 것이 없다). 날짜를 비웠으면 checkIn·
 * checkOut 키 자체를 붙이지 않는다(AC-5). 등록 경로는 좌표의 출처가 정한다(D4·AC-7) — 탭이
 * 아니다. 숙소명은 사용자가 친 값이 이기고, 비었을 때만 후보/건물명으로 떨어진다(D2·★11). */
export function buildStayRegisterRequest(
  flow: StayRegisterFlow
): RegisterSavedStayRequest | null {
  const candidate = flow.selectedCandidate;
  if (candidate === null) return null;

  return {
    name: resolveName(flow.name, candidate.name),
    registerRoute: flow.coordSource,
    lat: candidate.lat,
    lng: candidate.lng,
    coordConfirmed: flow.coordConfirmed,
    ...(flow.checkIn !== null && flow.checkOut !== null
      ? { checkIn: flow.checkIn, checkOut: flow.checkOut }
      : {}),
  };
}
