import type {
  Reflection,
  ReflectionStats,
} from '@/shared/api/generated/schemas';

import { statsCard } from './statsCard';

/**
 * TRIP-571 · reflectionFallback — 표시본 결정 단일 지점(BR-U5-32/35 · PBT-U5-F1 · AC-8).
 *
 * 무엇을 보장하나(폴백 3단 방어층): 어떤 회고 응답이 와도 표시본이 **비어 있지 않다**.
 *  - ① 서버 `narrative`(서버가 이미 `editedNarrative ?? draftNarrative` 로 정한 표시본)가 비지 않으면 그대로.
 *  - ② 결측·빈 문자열이면 클라가 방어적으로 `editedNarrative ?? draftNarrative` 재조립.
 *  - ③ 그마저 없으면 `statsCard`(0채움)로 조립한 BASIC 문장 — stats 가 결측이어도 늘 문장이 생긴다.
 *
 * ★ 클라 함수는 **1차 결정자가 아니라 빈 화면 방지 최후수단**(맹점①) — openapi `Reflection.narrative` 주석대로
 * 표시본 선택은 서버 업무 규칙이므로 서버 우선(①)을 못박고, 결측일 때만 방어한다. 클라가 매번 재판정하면
 * 조회 화면과 목록 화면이 서로 다르게 고르는 날이 온다. 그래서 이 결정은 **이 파일 한 곳에만** 산다(AC-8).
 *
 * ★ 입력이 `Reflection | undefined` 인 이유: 응답 자체 결측(네트워크 실패)·필드 결측·빈 문자열을 전부 방어한다.
 * 그래서 필드 접근은 `res?.` 로만 하고, 값이 문자열이며 공백만도 아닌지(`nonEmpty`)를 매번 확인한다.
 */

/** 공백만 문자열도 "비었다"로 잡는다(양끝 공백을 걷은 뒤 문자 수). 계약 위반(비문자열)도 여기서 걸러진다. */
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveDisplayNarrative(res: Reflection | undefined): string {
  // ① 서버가 정한 표시본 — 비지 않으면 그대로(클라 재판정 금지).
  const narrative = res?.narrative;
  if (nonEmpty(narrative)) return narrative;

  // ② 결측·빈 → 방어적으로 edited ?? draft.
  const edited = res?.editedNarrative;
  if (nonEmpty(edited)) return edited;
  const draft = res?.draftNarrative;
  if (nonEmpty(draft)) return draft;

  // ③ 그마저 없으면 stats 로 조립한 BASIC 문장(항상 비지 않음 — PBT-U5-F1 의 실체).
  return basicNarrative(statsCard(res?.stats));
}

/** 폴백 ③ — 근거 수치만으로 만든 최소 문장. 정확한 카피는 발명하지 않고 "비지 않음"만 계약(6-b 픽셀 소관). */
function basicNarrative(stats: ReflectionStats): string {
  return `방문 ${stats.visitCount}곳 · 이동 ${stats.distanceKm}km · 사진 ${stats.photoCount}장의 하루였어요.`;
}
