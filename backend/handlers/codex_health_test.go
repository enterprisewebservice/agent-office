package handlers

import (
	"strings"
	"testing"
	"time"
)

// The gate is the whole safety argument of the conservative probe: a
// wrong "safe" spends a refresh token that running agents are holding.
// This is its decision table.
func TestLineageCensusGate(t *testing.T) {
	const inUse, spare = "aaaaaaaaaaaa", "bbbbbbbbbbbb"
	complete := lineageCensus{holders: map[string]int{inUse: 5}, complete: true}
	partial := lineageCensus{holders: map[string]int{inUse: 5}, complete: false}

	far := time.Now().Add(10 * 24 * time.Hour)
	soon := time.Now().Add(refreshSafetyWindow - time.Minute)
	past := time.Now().Add(-time.Hour)

	tests := []struct {
		name       string
		census     lineageCensus
		lineage    string
		expiresAt  time.Time
		haveExpiry bool
		wantSafe   bool
		wantReason string // substring; empty when safe
	}{
		{"in use, expiry far off", complete, inUse, far, true, false, "lineage in use"},
		{"in use, inside safety window", complete, inUse, soon, true, true, ""},
		{"in use, already expired", complete, inUse, past, true, true, ""},
		{"nobody holds it", complete, spare, far, true, true, ""},
		{"census incomplete", partial, spare, far, true, false, "may be in use"},
		{"census incomplete but expiry near", partial, inUse, soon, true, true, ""},
		{"no expiry, in use", complete, inUse, time.Time{}, false, false, "lineage in use"},
		{"no expiry, nobody holds it", complete, spare, time.Time{}, false, true, ""},
		{"no fingerprint", complete, "", far, true, false, "lineage unknown"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.census.gate(tc.lineage, tc.expiresAt, tc.haveExpiry)
			if got.safe != tc.wantSafe {
				t.Fatalf("safe = %v, want %v (reason %q)", got.safe, tc.wantSafe, got.reason)
			}
			if tc.wantSafe {
				if got.reason != "" {
					t.Fatalf("safe gate carried a reason: %q", got.reason)
				}
				return
			}
			if !strings.Contains(got.reason, tc.wantReason) {
				t.Fatalf("reason = %q, want it to contain %q", got.reason, tc.wantReason)
			}
			if !strings.HasPrefix(got.reason, "not probed") {
				t.Fatalf("reason %q must start with \"not probed\" — the card keys its informational rendering on it", got.reason)
			}
		})
	}
}

func TestNewLineageCensus(t *testing.T) {
	const a, b = "aaaaaaaaaaaa", "bbbbbbbbbbbb"

	gateways := []GatewayHealth{{
		Name: "newsroom-gateway",
		Agents: []AgentAuthHealth{
			{Name: "wire", Lineages: []string{a}},
			{Name: "scout", Lineages: []string{a}},
			{Name: "anchor", Lineages: []string{b}},
			{Name: "provisioning", Error: noAgentStoreMsg},
		},
	}}

	c := newLineageCensus(gateways, true)
	if !c.complete {
		t.Error("an agent with no store yet is a clean read, not a gap in the census")
	}
	if c.holders[a] != 2 || c.holders[b] != 1 {
		t.Errorf("holders = %v, want a:2 b:1", c.holders)
	}

	t.Run("unreadable store closes the gate", func(t *testing.T) {
		gw := []GatewayHealth{{Agents: []AgentAuthHealth{{Name: "wire", Error: "SqliteError: database is locked"}}}}
		if newLineageCensus(gw, true).complete {
			t.Error("an unreadable agent store may hold any lineage — census must be incomplete")
		}
	})
	t.Run("failed pod probe closes the gate", func(t *testing.T) {
		if newLineageCensus([]GatewayHealth{{ProbeError: "no running gateway pod"}}, true).complete {
			t.Error("an unprobed gateway may hold any lineage — census must be incomplete")
		}
	})
	t.Run("failed discovery closes the gate", func(t *testing.T) {
		if newLineageCensus(gateways, false).complete {
			t.Error("un-enumerated gateways may hold any lineage — census must be incomplete")
		}
	})
}

func TestLineageFingerprint(t *testing.T) {
	const token = "rt_live_example_refresh_token"
	fp := lineageFingerprint(token)
	if len(fp) != 12 {
		t.Fatalf("fingerprint %q is %d chars, want 12", fp, len(fp))
	}
	if fp != lineageFingerprint(token) {
		t.Error("fingerprint is not stable")
	}
	if strings.Contains(fp, token) || lineageFingerprint(token+"x") == fp {
		t.Error("fingerprint must be a one-way, token-specific digest")
	}
	if lineageFingerprint("") != "" {
		t.Error("no token means no lineage")
	}
}

// A rotation must be reported as informational, never as a fault, and the
// overall verdict must stay green while the access token is good.
func TestCredentialProblemDistinguishesSkipFromError(t *testing.T) {
	skipped := CredentialHealth{
		Secret: "nl2sql-codex-credentials", SecretExists: true,
		AccessTokenExpired: true, AccessTokenExpiresAt: "2026-08-24T01:06:59Z",
		RefreshSkipReason: "not probed (lineage in use) — 5 agent profiles are running on this exact refresh token",
	}
	if got := credentialProblem(skipped); !strings.Contains(got, "not probed") {
		t.Errorf("problem = %q, want it to name the skip rather than imply a failed check", got)
	}

	errored := skipped
	errored.RefreshSkipReason = ""
	errored.RefreshError = "token endpoint unreachable"
	if got := credentialProblem(errored); !strings.Contains(got, "could not be verified") {
		t.Errorf("problem = %q, want it to name the probe failure", got)
	}
}
