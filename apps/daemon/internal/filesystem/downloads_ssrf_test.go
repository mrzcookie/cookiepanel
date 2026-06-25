package filesystem

import (
	"net"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "::1", // loopback
		"169.254.169.254", // cloud metadata (link-local)
		"fe80::1",         // link-local v6
		"10.0.0.5",        // private
		"172.16.0.1",      // private
		"192.168.1.1",     // private
		"fc00::1",         // unique-local v6
		"0.0.0.0", "::",   // unspecified
		"224.0.0.1", "ff02::1", // multicast
	}
	for _, s := range blocked {
		if isPublicIP(net.ParseIP(s)) {
			t.Errorf("isPublicIP(%s) = true, want false (must be blocked)", s)
		}
	}
	if isPublicIP(nil) {
		t.Error("isPublicIP(nil) = true, want false")
	}

	public := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"}
	for _, s := range public {
		if !isPublicIP(net.ParseIP(s)) {
			t.Errorf("isPublicIP(%s) = false, want true", s)
		}
	}
}

// safeDialControl is what actually runs on each dial; verify it rejects the
// metadata IP and accepts a public one given a resolved ip:port.
func TestSafeDialControl(t *testing.T) {
	if err := safeDialControl("tcp", "169.254.169.254:80", nil); err == nil {
		t.Error("safeDialControl allowed the metadata endpoint")
	}
	if err := safeDialControl("tcp", "127.0.0.1:8080", nil); err == nil {
		t.Error("safeDialControl allowed loopback")
	}
	if err := safeDialControl("tcp", "8.8.8.8:443", nil); err != nil {
		t.Errorf("safeDialControl rejected a public address: %v", err)
	}
}
