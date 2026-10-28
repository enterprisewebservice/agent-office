package handlers

import (
	"strings"
	"testing"
)

func TestParseTurnOutputOK(t *testing.T) {
	out := "agent=monday-ops-reporter\n\x1b[32m[state-migrations]\x1b[39m Legacy state migration warnings:\n- Left legacy update-check state in place\n{\n  \"runId\": \"r1\",\n  \"status\": \"ok\",\n  \"summary\": \"completed\",\n  \"result\": {\n    \"payloads\": [\n      {\n        \"text\": \"OK\",\n        \"mediaUrl\": null\n      }\n    ]\n  }\n}\n"
	agent, ok, errText := parseTurnOutput(out)
	if agent != "monday-ops-reporter" || !ok || errText != "" {
		t.Fatalf("got agent=%q ok=%v err=%q", agent, ok, errText)
	}
}

func TestParseTurnOutputDeadSignIn(t *testing.T) {
	// The CLI's failure on 2026-10-28: an error line whose JSON body starts
	// mid-line, so it must be reported, not decoded.
	out := "agent=handsonmode-help\nGatewayClientRequestError: FailoverError: OAuth token refresh failed for openai: OpenAI Codex token refresh failed (401): {\n  \"error\": {\n    \"message\": \"Invalid refresh token.\",\n    \"code\": \"invalid_refresh_token\"\n  }\n}. Please try again or re-authenticate.\n"
	agent, ok, errText := parseTurnOutput(out)
	if agent != "handsonmode-help" || ok {
		t.Fatalf("got agent=%q ok=%v", agent, ok)
	}
	if !strings.HasPrefix(errText, "GatewayClientRequestError: FailoverError: OAuth token refresh failed") {
		t.Fatalf("error not reported: %q", errText)
	}
}

func TestParseTurnOutputNoReply(t *testing.T) {
	out := "agent=main\n{\"runId\":\"r2\",\"status\":\"error\",\"result\":{\"payloads\":[]}}\n"
	if _, ok, errText := parseTurnOutput(out); ok || !strings.Contains(errText, `"error"`) {
		t.Fatalf("ok=%v err=%q", ok, errText)
	}
}

func TestTurnMetrics(t *testing.T) {
	turnStore.Lock()
	saved := turnStore.m
	turnStore.m = map[string]TurnHealth{
		"runtab-help":      {OK: true, CheckedAt: "2026-10-28T22:40:00Z"},
		"handsonmode-help": {OK: false, CheckedAt: "2026-10-28T22:41:00Z", Error: "dead"},
	}
	turnStore.Unlock()
	defer func() { turnStore.Lock(); turnStore.m = saved; turnStore.Unlock() }()

	m := renderTurnMetrics()
	for _, want := range []string{
		`agentoffice_codex_gateway_turn_ok{gateway="handsonmode-help"} 0`,
		`agentoffice_codex_gateway_turn_ok{gateway="runtab-help"} 1`,
		`agentoffice_codex_gateway_turn_checked_timestamp_seconds{gateway="runtab-help"} 1793227200`,
		"# TYPE agentoffice_codex_gateway_turn_ok gauge",
	} {
		if !strings.Contains(m, want) {
			t.Errorf("metrics lack %q:\n%s", want, m)
		}
	}
}
