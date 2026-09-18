import { useEffect, useState } from 'react';

import {
  checkNickname,
  completeOnboarding,
  fetchNicknameSuggestions,
  updateNickname,
} from '@/shared/api';

import type { NicknameErrorReason } from '../ui/NicknameScreen';
import { validateNicknameFormat } from './validateNicknameFormat';

/**
 * 닉네임 상태·서버 호출 (US-ONB-03 · AC B1·B2·B5~B9).
 *
 * 진입 시 서버가 준 중복 없는 후보로 프리필하고(B1), 저장은 서버 검사(check) → PATCH → complete
 * **순서**로만 진행한다(D3). 중복·금칙어는 서버 check 가 판정하고(권한 경계), 저장이 실패하면
 * complete 를 부르지 않는다(INV-4). 클라 검증은 길이(형식)만 본다.
 */

export interface UseNickname {
  value: string;
  canProceed: boolean;
  errorReason: NicknameErrorReason | null;
  /** 서버 거부(중복·금칙어) 시에만 노출하는 대체 후보 칩. 평상시엔 빈 배열이다. */
  suggestions: string[];
  change: (next: string) => void;
  regenerate: () => void;
  selectSuggestion: (value: string) => void;
  /** 성공(true)일 때만 컨테이너가 게이트로 복귀한다. */
  submit: () => Promise<boolean>;
}

function formatError(value: string): NicknameErrorReason | null {
  const result = validateNicknameFormat(value);
  if (result.valid) {
    return null;
  }
  // 형식 위반 사유는 TOO_SHORT/TOO_LONG 둘뿐이다('OK'는 valid 일 때만 나온다).
  return result.reason === 'TOO_LONG' ? 'TOO_LONG' : 'TOO_SHORT';
}

export function useNickname(): UseNickname {
  const [value, setValue] = useState('');
  const [fetchedSuggestions, setFetchedSuggestions] = useState<string[]>([]);
  const [errorReason, setErrorReason] = useState<NicknameErrorReason | null>(
    null
  );

  useEffect(() => {
    void (async () => {
      const suggestions = await fetchNicknameSuggestions();
      setFetchedSuggestions(suggestions);
      // 프리필 = suggestions[0] (계약: 칩 i = suggestions[i]).
      setValue(suggestions[0] ?? '');
    })();
  }, []);

  const canProceed = validateNicknameFormat(value).valid;
  // 칩은 서버가 거부했을 때만 대체안으로 보여준다.
  const rejected = errorReason === 'TAKEN' || errorReason === 'BANNED_WORD';
  const suggestions = rejected ? fetchedSuggestions : [];

  const change = (next: string) => {
    setValue(next);
    // 값이 바뀌면 이전 서버 판정은 더 이상 유효하지 않다 — 형식 판정으로 갱신한다.
    setErrorReason(formatError(next));
  };

  const selectSuggestion = (candidate: string) => {
    change(candidate);
  };

  const regenerate = () => {
    void (async () => {
      const next = await fetchNicknameSuggestions();
      setFetchedSuggestions(next);
      setValue(next[0] ?? '');
      setErrorReason(null);
    })();
  };

  const submit = async (): Promise<boolean> => {
    const formatReason = formatError(value);
    if (formatReason !== null) {
      setErrorReason(formatReason);
      return false;
    }
    // 서버가 중복·금칙어를 판정한다(권한 경계). 거부면 오류 + 대체 후보를 띄우고 멈춘다.
    try {
      const check = await checkNickname(value);
      if (!check.available) {
        setErrorReason(
          check.reason === 'BANNED_WORD' ? 'BANNED_WORD' : 'TAKEN'
        );
        return false;
      }
    } catch {
      setErrorReason('SAVE_FAILED');
      return false;
    }
    // 저장 성공 뒤에만 완료 처리를 부른다(D3 · INV-4).
    try {
      await updateNickname(value);
    } catch {
      setErrorReason('SAVE_FAILED');
      return false;
    }
    try {
      await completeOnboarding();
    } catch {
      setErrorReason('SAVE_FAILED');
      return false;
    }
    setErrorReason(null);
    return true;
  };

  return {
    value,
    canProceed,
    errorReason,
    suggestions,
    change,
    regenerate,
    selectSuggestion,
    submit,
  };
}
