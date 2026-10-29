package handlers

import (
	"fmt"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// A Vault-synced credential must never be refresh-probed, not even with
// ?probe=1: the rotated token could only be saved into the Secret, where
// ESO puts Vault's copy back within a minute, leaving the agents that hold
// the same token with a spent one. An expired access token with nobody on
// the lineage, which opens the gate for any other Secret, must not open it
// here.
func TestVaultSyncedCredentialIsNeverProbed(t *testing.T) {
	nobodyHolds := lineageCensus{holders: map[string]int{}, complete: true}
	expired := time.Now().Add(-time.Hour)

	for _, force := range []bool{false, true} {
		gate, f := credentialGate(CredentialHealth{SyncedFromVault: true, Lineage: "abc"}, nobodyHolds, expired, true, force)
		if gate.safe || f {
			t.Fatalf("force=%v: Vault-synced credential would be probed (safe=%v force=%v)", force, gate.safe, f)
		}
		if gate.reason != vaultSyncedSkip {
			t.Fatalf("force=%v: reason %q", force, gate.reason)
		}
	}

	// The same token in a plain Secret still opens the gate, as before.
	gate, f := credentialGate(CredentialHealth{Lineage: "abc"}, nobodyHolds, expired, true, true)
	if !gate.safe || !f {
		t.Fatalf("plain Secret: safe=%v force=%v, want true true", gate.safe, f)
	}
	owned := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{Kind: "ExternalSecret", Name: "x"}}}}
	if !ownedByExternalSecret(owned) {
		t.Fatal("an ExternalSecret-owned Secret was not recognised")
	}
}

// A plain Secret (no ExternalSecret owner) keeps the old behaviour.
func TestPlainSecretIsNotVaultSynced(t *testing.T) {
	if ownedByExternalSecret(&corev1.Secret{}) {
		t.Fatal("a Secret without owners counted as Vault-synced")
	}
	other := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{Kind: "Deployment"}}}}
	if ownedByExternalSecret(other) {
		t.Fatal("a Deployment-owned Secret counted as Vault-synced")
	}
}

func TestTurnsVerdict(t *testing.T) {
	turnStore.Lock()
	saved := turnStore.m
	turnStore.m = map[string]TurnHealth{}
	turnStore.Unlock()
	defer func() { turnStore.Lock(); turnStore.m = saved; turnStore.Unlock() }()

	recordTurn("gw-ok", TurnHealth{OK: true})
	recordTurn("gw-bad", TurnHealth{OK: false, Error: "OAuth token refresh failed"})
	recordTurn("gw-silent", TurnHealth{OK: false})

	cases := []struct {
		gateways []string
		want     *bool
		problem  string
	}{
		{[]string{"gw-ok"}, ptr(true), ""},
		{[]string{"gw-none"}, nil, ""},
		{[]string{"gw-none", "gw-ok"}, ptr(true), ""},
		{[]string{"gw-ok", "gw-bad"}, ptr(false), "gw-bad: OAuth token refresh failed"},
		{[]string{"gw-silent"}, ptr(false), "gw-silent: no answer"},
	}
	for _, c := range cases {
		got, problem := turnsVerdict(c.gateways)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) || problem != c.problem {
			t.Errorf("turnsVerdict(%v) = %v %q, want %v %q", c.gateways, deref(got), problem, deref(c.want), c.problem)
		}
	}
}

func TestCredentialHealthyVaultSyncedFollowsTurns(t *testing.T) {
	cases := []struct {
		name string
		c    CredentialHealth
		want bool
	}{
		{"vault copy expired, no turn yet", CredentialHealth{SyncedFromVault: true, SecretExists: true, AccessTokenExpired: true}, true},
		{"vault copy expired, turn answered", CredentialHealth{SyncedFromVault: true, SecretExists: true, AccessTokenExpired: true, TurnsOK: ptr(true)}, true},
		{"turn failed", CredentialHealth{SyncedFromVault: true, SecretExists: true, TurnsOK: ptr(false), TurnProblem: "runtab-help: no answer"}, false},
		{"secret missing", CredentialHealth{SyncedFromVault: true}, false},
		{"plain secret, expired, not probed", CredentialHealth{SecretExists: true, AccessTokenExpired: true}, false},
		{"plain secret, refresh alive", CredentialHealth{SecretExists: true, AccessTokenExpired: true, RefreshAlive: ptr(true)}, true},
	}
	for _, c := range cases {
		if got := credentialHealthy(c.c); got != c.want {
			t.Errorf("%s: credentialHealthy = %v, want %v", c.name, got, c.want)
		}
	}
	failed := CredentialHealth{Secret: "runtab-help-codex-credentials", SyncedFromVault: true, SecretExists: true, TurnsOK: ptr(false), TurnProblem: "runtab-help: no answer"}
	if got := credentialProblem(failed); !strings.Contains(got, "daily test turn failed on runtab-help: no answer") {
		t.Errorf("credentialProblem = %q", got)
	}
}

func ptr(b bool) *bool { return &b }

func deref(b *bool) string {
	if b == nil {
		return "nil"
	}
	return fmt.Sprint(*b)
}
