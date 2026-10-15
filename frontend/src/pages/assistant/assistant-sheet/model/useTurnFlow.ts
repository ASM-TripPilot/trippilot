import { useEffect, useRef, useState } from 'react';

import type { AssistantSurface, TurnInput } from '../api/assistantContract';
import { isAssistantApiError } from '../api/assistantPort';
import { useSendTurn } from './assistantQueries';
import { newClientTurnId } from './clientTurnId';
import { isSlowTurn, secondsLeft } from './turnTiming';

/**
 * 보내는 턴의 상태(TRIP-1326 · frontend-components §3 · BR-U8-21·44 · INV-U8-05).
 *
 * - `clientTurnId` 는 **보내기 직전 1회** 만들고, 실패·취소 뒤 [다시 보내기]에 그대로 다시 쓴다 — 서버가 이미
 *   처리했으면 같은 응답을 돌려준다(멱등).
 * - 보내는 동안 사용자 발화를 낙관 말풍선으로 보인다. 실패(저장 실패·네트워크)·대기 취소면 그 말풍선이
 *   "보내지 못함 · 다시 보내기"로 바뀐다. 취소는 클라 중단이라 서버 결과는 다음 조회에서 합쳐진다.
 * - 보내는 중엔 새 턴을 막는다(ref 잠금 — 같은 이벤트 루프의 연타도 1회).
 * - 15s 가 지나면 `slow`(진행 표시 유지 + [대기 취소] 강조). 429 면 Retry-After 초 동안 막고 남은 초를 센다.
 */

export interface PendingTurn {
  clientTurnId: string;
  input: TurnInput;
  /** 말풍선에 보일 문구(TEXT 는 원문, ACTION 은 quick reply 라벨). */
  text: string;
  status: 'SENDING' | 'FAILED';
}

export interface TurnFlow {
  pending: PendingTurn | null;
  inFlight: boolean;
  slow: boolean;
  /** 429 로 막힌 남은 초 — 0 이면 막히지 않음. */
  rateLimitedSeconds: number;
  send: (input: TurnInput, text: string) => void;
  resend: () => void;
  cancel: () => void;
}

export function useTurnFlow(
  sessionId: string | undefined,
  surface: AssistantSurface,
  onRestoreDraft: (text: string) => void
): TurnFlow {
  const sendTurn = useSendTurn(sessionId);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // 시계 — 보내는 중(15s 판정)이거나 429 로 막힌 동안만 1초마다 다시 그린다.
  const ticking = startedAt !== null || rateLimitedUntil !== null;
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const rateLimitedSeconds =
    rateLimitedUntil === null ? 0 : secondsLeft(rateLimitedUntil, now);
  useEffect(() => {
    if (rateLimitedUntil !== null && rateLimitedSeconds === 0) {
      setRateLimitedUntil(null);
    }
  }, [rateLimitedUntil, rateLimitedSeconds]);

  function dispatch(turn: PendingTurn): void {
    if (!sessionId || inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setPending({ ...turn, status: 'SENDING' });
    setStartedAt(Date.now());
    setNow(Date.now());
    sendTurn.mutate(
      {
        request: {
          clientTurnId: turn.clientTurnId,
          input: turn.input,
          screen: { surface },
        },
        signal: controller.signal,
      },
      {
        onSuccess: () => setPending(null),
        onError: (error) => {
          if (isAssistantApiError(error) && error.code === 'RATE_LIMITED') {
            // 서버가 턴을 기록하지 않았다 — 말풍선을 거두고 입력을 돌려준다.
            setPending(null);
            if (turn.input.type === 'TEXT') onRestoreDraft(turn.text);
            const at = Date.now();
            setNow(at);
            setRateLimitedUntil(at + (error.retryAfterSeconds ?? 1) * 1000);
            return;
          }
          if (isAssistantApiError(error) && error.code === 'TURN_IN_PROGRESS') {
            // 서버가 이미 기록해 처리 중이다 — 말풍선·입력을 그대로 두고(복원하면 같은 말이 두 번 나간다)
            // Retry-After 뒤 **같은 clientTurnId** 로만 다시 보내게 막는다.
            setPending({ ...turn, status: 'FAILED' });
            const at = Date.now();
            setNow(at);
            setRateLimitedUntil(at + (error.retryAfterSeconds ?? 1) * 1000);
            return;
          }
          setPending({ ...turn, status: 'FAILED' });
        },
        onSettled: () => {
          inFlightRef.current = false;
          abortRef.current = null;
          setStartedAt(null);
        },
      }
    );
  }

  function send(input: TurnInput, text: string): void {
    if (rateLimitedSeconds > 0) return;
    dispatch({
      clientTurnId: newClientTurnId(),
      input,
      text,
      status: 'SENDING',
    });
  }

  function resend(): void {
    if (pending?.status !== 'FAILED' || rateLimitedSeconds > 0) return;
    dispatch(pending);
  }

  function cancel(): void {
    const turn = pending;
    abortRef.current?.abort();
    if (turn && turn.input.type === 'TEXT') onRestoreDraft(turn.text);
  }

  return {
    pending,
    inFlight: pending?.status === 'SENDING',
    slow: isSlowTurn(startedAt, now),
    rateLimitedSeconds,
    send,
    resend,
    cancel,
  };
}
