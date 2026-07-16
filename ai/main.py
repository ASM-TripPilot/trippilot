"""TripPilot AI 서비스 — 컨테이너 통합 테스트용 최소 스텁.
실제 C1(LLM Gateway)/C2(Solver)는 후속. 지금은 /health 만 응답한다."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8000


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/health", "/"):
            body = json.dumps({"status": "UP", "service": "ai"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):  # 조용히
        pass


if __name__ == "__main__":
    print(f"ai stub listening on :{PORT}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
