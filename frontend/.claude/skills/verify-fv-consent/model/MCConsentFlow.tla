---- MODULE MCConsentFlow ----
EXTENDS ConsentFlow
\* 앱은 위치 권한 허용, 웹은 2026-10-31 웹 QA 에서 관측한 NOT_DETERMINED(가정 W1).
MCPerm == [d \in {"app", "web"} |-> IF d = "app" THEN "GRANTED" ELSE "NOT_DETERMINED"]
====
