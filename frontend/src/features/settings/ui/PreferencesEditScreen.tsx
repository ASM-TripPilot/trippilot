/**
 * l05 취향 전체 수정 화면 (TRIP-610) — GET 초기값 → 타일 반영 → 축 재선택 → PUT 저장/400.
 *
 * `PreferencesEditScreen` 은 필수 prop 없는 **자족 컨테이너**(스스로 GET/PUT, 02a §2.2) — 데이터·선택
 * 상태를 쥐고 순수 뷰 `PreferencesEditView`(별도 파일)에 내린다. 뷰를 순수 파일로 뺀 이유는
 * `PreferencesEditView.tsx` 머리말 참고 — 프리뷰가 QueryClient·네트워크 계층 없이 뷰만 태우기 위해서다.
 */
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { toggleMulti, toggleSingle } from '@/shared/pref/preferenceSelection';
import { type PreferenceView } from '@/shared/api/generated/schemas';

import {
  buildPreferenceInput,
  initialSelection,
  type PreferenceSelection,
} from '../model/preferenceDraft';
import { usePreferences } from '../model/usePreferences';
import {
  type EditableAxis,
  isMultiAxis,
  PreferencesEditView,
} from './PreferencesEditView';

export function PreferencesEditScreen(): ReactElement {
  const router = useRouter();
  const { view, save, saveError } = usePreferences();
  const [selection, setSelection] = useState<PreferenceSelection | null>(null);
  // 저장 diff 기준선 = 편집을 시작한 시드 스냅숏(baseline freeze). 살아있는 view 를 기준선으로
  // 쓰면 편집 도중 GET 재요청으로 안 만진 축이 "바뀐 것"처럼 PUT 에 실려 서버 최신값을 덮는다(경고-1).
  const [baseView, setBaseView] = useState<PreferenceView | null>(null);

  // GET 해소되면 초기 선택과 기준선 view 를 한 번 시드한다(이후엔 사용자 조작만 반영).
  useEffect(() => {
    if (view && selection === null) {
      setSelection(initialSelection(view));
      setBaseView(view);
    }
  }, [view, selection]);

  const handleToggle = useCallback((axis: EditableAxis, value: string) => {
    setSelection((prev) => {
      if (prev === null) return prev;
      const next: PreferenceSelection = { ...prev };
      if (isMultiAxis(axis)) {
        next[axis] = toggleMulti(prev[axis], value);
      } else {
        next[axis] = toggleSingle(prev[axis], value);
      }
      return next;
    });
  }, []);

  const handleTogglePet = useCallback(() => {
    setSelection((prev) =>
      prev === null ? prev : { ...prev, petFlag: !prev.petFlag }
    );
  }, []);

  const handleSave = useCallback(() => {
    if (baseView && selection) {
      save(buildPreferenceInput(baseView, selection));
    }
  }, [baseView, selection, save]);

  return (
    <PreferencesEditView
      selection={selection}
      saveError={saveError}
      onToggle={handleToggle}
      onTogglePet={handleTogglePet}
      onSave={handleSave}
      onBack={() => router.back()}
    />
  );
}
