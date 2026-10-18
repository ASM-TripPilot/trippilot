/**
 * 닉네임 설정 배선 (US-ONB-03 · AC B1·B2·B5~B9).
 * useNickname 상태 → NicknameScreen props, 저장 성공 → 게이트('/') 복귀로 부트스트랩 재판정.
 */
import { useRef, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { useNickname } from '../model/useNickname';
import { NicknameScreen } from './NicknameScreen';

export function NicknamePage(): ReactElement {
  const router = useRouter();
  const {
    value,
    canProceed,
    errorReason,
    suggestions,
    change,
    regenerate,
    selectSuggestion,
    submit,
  } = useNickname();

  // 제출 잠금 — 입구가 둘(return 키·[다음])이라 같은 순간에 두 번 들어올 수 있다. 상태값은 다음 그리기에야
  // 바뀌므로 즉시 읽히는 ref 로 잠근다(TRIP-1427 · SettingsPage TRIP-1305 선례). 실패하면 풀어 재시도를 열고,
  // 성공하면 화면을 떠날 때까지 잠근 채 둔다(PrefStep1/2 관례).
  const inFlightRef = useRef(false);

  // 저장·완료가 모두 성공하면 위치 프리프롬프트(c08)로 넘어간다(TRIP-459 — pref1 앞에 c08 삽입).
  // 실패면 오류만 남고 머문다(INV-4).
  const handleNext = () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void (async () => {
      const done = await submit();
      if (done) {
        router.replace('/(onboarding)/location');
      } else {
        inFlightRef.current = false;
      }
    })();
  };

  return (
    <NicknameScreen
      value={value}
      canProceed={canProceed}
      errorReason={errorReason}
      suggestions={suggestions}
      onChange={change}
      onRegenerate={regenerate}
      onSelectSuggestion={selectSuggestion}
      onNext={handleNext}
    />
  );
}
