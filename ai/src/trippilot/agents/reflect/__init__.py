"""agents/reflect — U6 Reflect compose 코어 (TRIP-429, FD business-logic §1).

agent-foundation §1의 예약 자리 실체화. 대화형 REFLECT intent의 AgentTask 봉투
수렴(agent.py)은 오케스트레이터 라우팅 배선과 함께 후속 — 경계는 compose를 직접 쓴다.
"""

from trippilot.agents.reflect.composer import compose

__all__ = ["compose"]
