package diskquota

import (
	"context"
	"os/exec"
	"testing"
)

func TestProjectIDDeterministicAndBounded(t *testing.T) {
	a := ProjectID("/var/lib/docker/volumes/wings-srv-abc/_data")
	b := ProjectID("/var/lib/docker/volumes/wings-srv-abc/_data")
	c := ProjectID("/var/lib/docker/volumes/wings-srv-xyz/_data")
	if a != b {
		t.Errorf("ProjectID not deterministic: %d != %d", a, b)
	}
	if a == c {
		t.Errorf("ProjectID collided across different dirs: %d", a)
	}
	for _, id := range []uint32{a, b, c} {
		if id < 1000 || id > 1_000_999 {
			t.Errorf("ProjectID %d outside [1000, 1000999]", id)
		}
	}
}

func TestApplyValidationIsNoOp(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		dir   string
		bytes int64
	}{
		{"", 1024},
		{"/data", 0},
		{"/data", -1},
	} {
		enforced, err := Apply(ctx, tc.dir, tc.bytes)
		if enforced || err != nil {
			t.Errorf("Apply(%q, %d) = (%v, %v), want (false, nil)", tc.dir, tc.bytes, enforced, err)
		}
	}
}

func TestApplyNoToolIsNoOp(t *testing.T) {
	// Where xfs_quota isn't installed (the dev box / CI), Apply must degrade to a
	// clean no-op rather than erroring — it never blocks server creation.
	if _, err := exec.LookPath("xfs_quota"); err == nil {
		t.Skip("xfs_quota present; can't assert the no-tool no-op here")
	}
	enforced, err := Apply(context.Background(), "/tmp/wings-quota-test", 64*1024*1024)
	if enforced {
		t.Error("Apply enforced a quota without xfs_quota present")
	}
	if err != nil {
		t.Errorf("Apply without xfs_quota = %v, want nil", err)
	}
}
