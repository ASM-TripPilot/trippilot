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

export interface StayRegisterFlow {
  query: string;
  searchStatus: 'idle' | 'loading' | 'success' | 'empty' | 'error';
  candidates: GeocodeCandidate[];
  selectedCandidate: GeocodeCandidate | null;
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

/** 지금 등록해도 되는가. 좌표 게이트(AC-3)는 다른 어떤 필드도 뒤집지 못한다(가중치 1.0). */
export function canSubmitStayRegister(flow: StayRegisterFlow): boolean {
  if (flow.selectedCandidate === null) return false;
  if (!flow.coordConfirmed) return false;
  if (flow.submitStatus === 'submitting') return false;
  return stayRegisterSchema.safeParse({
    checkIn: flow.checkIn,
    checkOut: flow.checkOut,
  }).success;
}

/** 서버로 보낼 본문 조립. 후보가 없으면 null(보낼 것이 없다). 날짜를 비웠으면 checkIn·
 * checkOut 키 자체를 붙이지 않는다(AC-5). 등록 경로는 이 칸에서 항상 MAP_SEARCH다(§3-5). */
export function buildStayRegisterRequest(
  flow: StayRegisterFlow
): RegisterSavedStayRequest | null {
  const candidate = flow.selectedCandidate;
  if (candidate === null) return null;

  return {
    name: candidate.name,
    registerRoute: 'MAP_SEARCH',
    lat: candidate.lat,
    lng: candidate.lng,
    coordConfirmed: flow.coordConfirmed,
    ...(flow.checkIn !== null && flow.checkOut !== null
      ? { checkIn: flow.checkIn, checkOut: flow.checkOut }
      : {}),
  };
}
