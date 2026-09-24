import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { StepperCheckBadge, StepperSunGlyph } from './CoPickStepperGlyphs';

/**
 * TRIP-794 · CoPickStepper — 같이 고르기(co-pick) 위저드 3단 스텝퍼(h09·h10 공유 widget).
 *
 * 이전(고름) → 현재(지금 고르는 중) → 다음(비어 있음) 흐름을 role 고정 3슬롯으로 그린다. current 는
 * 필수, prev/next 는 첫·마지막 슬롯에서 optional 이라 미주입이면 그 열을 안 그린다(부재). **현재 단만
 * 빨강**(role·status className `text-primary`), 이전/다음은 muted — 색 대비를 className 토큰으로 잠근다.
 *
 * 이 인터페이스(`{prev?, current, next?}` 각 `{title,status,iconKey?,done?}`)는 seed D2 로 확정됐고
 * **h10(TRIP-795) 재사용을 구속한다** — steps 배열이 아니라 role 고정 3슬롯이라 795 도 이 shape 그대로 받는다.
 *
 * presentation-only(`useState` 0 — `widgetsStructure` F 규약). 원 안 마커·완료 배지는 위젯 로컬 글리프
 * (`CoPickStepperGlyphs.tsx`, D4 — widgets→features import 금지라 로컬 복제). 원·연결선·완료 배지의 실제
 * 색/모양/좌표는 jest 사각(글리프 raw-hex 제외)이라 6-b 육안 전용. INV-3 — 소요시간 문자열은 어디에도
 * 없다("오후"는 시간대 라벨이라 허용, `CoPickStepper.test.tsx` T5 가 렌더 텍스트 전수로 잠근다).
 */

export interface CoPickStep {
  /** 제목 — 예 '황령산 전망대'(이전 슬롯 이름) · '오후 · 전시'(현재 시간대·컨셉). */
  title: string;
  /** 상태 표시 문구 — '고름' | '지금 고르는 중' | '비어 있음'. */
  status: string;
  /** 위젯 로컬 글리프 선택 키(D4). 미주입이면 기본 글리프. */
  iconKey?: string;
  /** 완료 체크 배지(이전 단계). */
  done?: boolean;
}

export interface CoPickStepperProps {
  /** 이전 단계 — 첫 슬롯에서 없음(optional). */
  prev?: CoPickStep;
  /** 현재 단계 — 항상 존재(필수). */
  current: CoPickStep;
  /** 다음 단계 — 마지막 슬롯에서 없음(optional). */
  next?: CoPickStep;
}

type Role = 'prev' | 'current' | 'next';

// 한 열(역할 라벨 + 원 마커 + 제목 + 상태). 연결선은 좌/우 이웃이 있을 때만 원 뒤로 그린다(원이 위에
// 덮음). 훅 없는 순수 함수라 위젯 presentation-only 규약(useState 0)을 안 깬다.
function StepColumn({
  role,
  label,
  step,
  hasLeftLine,
  hasRightLine,
}: {
  role: Role;
  label: string;
  step: CoPickStep;
  hasLeftLine: boolean;
  hasRightLine: boolean;
}): ReactElement {
  const isCurrent = role === 'current';
  const roleClass = isCurrent
    ? 'font-noto-bold text-caption font-bold text-primary'
    : 'font-noto text-caption text-muted';
  const statusClass = isCurrent
    ? 'font-noto-bold text-caption font-bold text-primary'
    : 'font-noto text-caption text-muted';
  const titleClass = isCurrent
    ? 'font-noto-bold text-label font-bold text-ink'
    : 'font-noto text-label text-ink';
  const circleClass = isCurrent
    ? 'bg-primary'
    : role === 'prev'
      ? 'bg-surface-strong'
      : 'border border-hairline-strong bg-canvas';
  return (
    <View
      testID={`copick-stepper-${role}`}
      className="flex-1 items-center gap-[4px]"
    >
      <Text testID={`copick-stepper-${role}-role`} className={roleClass}>
        {label}
      </Text>
      <View className="relative h-[40px] w-full items-center justify-center">
        {hasLeftLine ? (
          <View className="absolute left-0 top-[19px] h-[2px] w-1/2 bg-hairline-strong" />
        ) : null}
        {hasRightLine ? (
          <View className="absolute right-0 top-[19px] h-[2px] w-1/2 bg-hairline-strong" />
        ) : null}
        <View
          className={`relative h-[36px] w-[36px] items-center justify-center rounded-pill ${circleClass}`}
        >
          <StepperSunGlyph tone={isCurrent ? 'white' : 'muted'} />
          {step.done ? (
            <View className="absolute bottom-[-2px] right-[-2px]">
              <StepperCheckBadge />
            </View>
          ) : null}
        </View>
      </View>
      <Text
        testID={`copick-stepper-${role}-title`}
        className={titleClass}
        numberOfLines={1}
      >
        {step.title}
      </Text>
      <Text testID={`copick-stepper-${role}-status`} className={statusClass}>
        {step.status}
      </Text>
    </View>
  );
}

export function CoPickStepper({
  prev,
  current,
  next,
}: CoPickStepperProps): ReactElement {
  return (
    <View testID="copick-stepper" className="w-full flex-row items-start">
      {prev ? (
        <StepColumn
          role="prev"
          label="이전"
          step={prev}
          hasLeftLine={false}
          hasRightLine
        />
      ) : null}
      <StepColumn
        role="current"
        label="현재"
        step={current}
        hasLeftLine={prev !== undefined}
        hasRightLine={next !== undefined}
      />
      {next ? (
        <StepColumn
          role="next"
          label="다음"
          step={next}
          hasLeftLine
          hasRightLine={false}
        />
      ) : null}
    </View>
  );
}
