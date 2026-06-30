package link

import (
	"context"
	"sync"

	"github.com/xena-studios/raptor/apps/wings/internal/rpc"
)

// StreamHandler serves a streaming op (e.g. the live console). It emits chunk
// payloads via emit until it returns — nil ends the stream with a terminal
// `res`, an error ends it with `err` — or the context is cancelled (a `cancel`
// frame from the panel, or the link dropping). The request frame carries the
// op's parameters in its payload (Bind them).
type StreamHandler func(ctx context.Context, req rpc.Frame, emit func(payload any) error) error

// handleStream runs a streaming op in its own goroutine, forwarding emitted
// payloads as chunk frames and a terminal res/err, with the same concurrency
// bound and cancellation wiring as a unary request.
func (c *Client) handleStream(
	ctx context.Context,
	frame rpc.Frame,
	handler StreamHandler,
	out chan<- rpc.Frame,
	inflight *sync.Map,
	sem chan struct{},
) {
	reqCtx, cancel := context.WithCancel(ctx)
	inflight.Store(frame.ID, cancel)

	go func() {
		defer func() {
			inflight.Delete(frame.ID)
			cancel()
			if r := recover(); r != nil {
				c.send(ctx, out, rpc.Errorf(frame.ID, rpc.CodeInternal, "stream panic: %v", r))
			}
		}()

		// Bound concurrency here, not in the read loop, so a full stream budget
		// never blocks reads (incl. cancel frames). Releases on return/cancel.
		select {
		case sem <- struct{}{}:
		case <-reqCtx.Done():
			return
		}
		defer func() { <-sem }()

		emit := func(payload any) error {
			f, err := rpc.Chunk(frame.ID, payload)
			if err != nil {
				return err
			}
			select {
			case out <- f:
				return nil
			case <-reqCtx.Done():
				return reqCtx.Err()
			}
		}

		err := handler(reqCtx, frame, emit)
		switch {
		case reqCtx.Err() != nil:
			// Cancelled (panel sent cancel, or the link dropped) — the panel has
			// already torn the stream down, so just close it out with a res.
			c.sendResult(ctx, out, frame.ID)
		case err != nil:
			c.send(ctx, out, rpc.Errorf(frame.ID, rpc.CodeInternal, "%v", err))
		default:
			c.sendResult(ctx, out, frame.ID)
		}
	}()
}

func (c *Client) sendResult(ctx context.Context, out chan<- rpc.Frame, id string) {
	if done, err := rpc.Result(id, nil); err == nil {
		c.send(ctx, out, done)
	}
}
