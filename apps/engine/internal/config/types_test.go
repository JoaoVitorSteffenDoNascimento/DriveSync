package config

import "testing"

func TestShouldIgnore(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"documentos/relatorio.pdf", false},
		{"node_modules/pkg/index.js", true},
		{"projeto/.git/HEAD", true},
		{"backup.iso", true},
		{"video.tmp", true},
		{".drivesync/devices/abc.json", true},
		{".DriveSync-Quarentena/2026-11-17/a.txt", true},
		{"fotos/viagem.jpg", false},
	}

	for _, tc := range cases {
		if got := ShouldIgnore(tc.path); got != tc.want {
			t.Fatalf("ShouldIgnore(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestIsSenderAllowed(t *testing.T) {
	policyBlock := SenderPolicy{
		Mode:                SenderModeBlocklist,
		UnknownSenderAction: "block",
		Rules: []SenderRule{
			{Email: "joao@gmail.com", Allowed: true},
			{Email: "luiz@gmail.com", Allowed: false},
		},
	}

	if !IsSenderAllowed("Joao@gmail.com", policyBlock) {
		t.Fatal("esperava joao@gmail.com permitido")
	}
	if IsSenderAllowed("luiz@gmail.com", policyBlock) {
		t.Fatal("esperava luiz@gmail.com bloqueado")
	}
	if IsSenderAllowed("", policyBlock) {
		t.Fatal("esperava remetente desconhecido bloqueado")
	}

	policyAllow := SenderPolicy{
		Mode:                SenderModeAllowlist,
		UnknownSenderAction: "block",
		Rules: []SenderRule{
			{Email: "joao@gmail.com", Allowed: true},
		},
	}
	if !IsSenderAllowed("joao@gmail.com", policyAllow) {
		t.Fatal("esperava joao@gmail.com permitido na allowlist")
	}
	if IsSenderAllowed("outro@gmail.com", policyAllow) {
		t.Fatal("esperava outro@gmail.com bloqueado na allowlist")
	}
}
