package safe

import (
	"errors"
	"sync"
	"testing"
)

func TestRecoverSwallowsPanic(t *testing.T) {
	// A panic inside the deferred-Recover scope must not propagate.
	func() {
		defer Recover("test")
		panic("boom")
	}()
	// Reaching here means the panic was recovered.
}

func TestGuardReturnsErrorOnPanic(t *testing.T) {
	err := Guard("test", func() error {
		panic("boom")
	})
	if err == nil {
		t.Fatal("Guard returned nil for a panicking fn, want an error")
	}
}

func TestGuardPassesThroughError(t *testing.T) {
	want := errors.New("real error")
	if got := Guard("test", func() error { return want }); !errors.Is(got, want) {
		t.Errorf("Guard = %v, want %v", got, want)
	}
	if got := Guard("test", func() error { return nil }); got != nil {
		t.Errorf("Guard = %v, want nil", got)
	}
}

func TestGoRecoversAndCompletes(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)
	// A panicking background task must not crash the process; Go's wrapper recovers.
	Go("test", func() {
		defer wg.Done()
		panic("boom")
	})
	wg.Wait()
}
