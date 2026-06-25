BINARY := cookied
PKG     := ./cmd/cookied
BIN_DIR := bin

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

LDFLAGS := -s -w \
	-X github.com/cookiepanel/cookied/internal/version.Version=$(VERSION) \
	-X github.com/cookiepanel/cookied/internal/version.Commit=$(COMMIT) \
	-X github.com/cookiepanel/cookied/internal/version.Date=$(DATE)

.PHONY: build run test vet fmt cross checksums release clean

build:
	go build -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) $(PKG)

run:
	go run $(PKG) run

test:
	go test ./...

vet:
	go vet ./...

fmt:
	gofmt -w .

cross:
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY)-linux-amd64 $(PKG)
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY)-linux-arm64 $(PKG)

# Write a `<binary>.sha256` sidecar beside every cross-built binary. The panel
# fetches these (one digest per file, lowercase hex) to verify a download before
# the daemon swaps itself — see internal/system/maintenance.go (UpdateDaemon).
# The sidecar is bare-digest form (no filename column) so the panel can read it
# as-is; `cd` keeps it that way regardless of where make is invoked from.
checksums:
	cd $(BIN_DIR) && for f in $(BINARY)-linux-*; do \
		case "$$f" in *.sha256) continue;; esac; \
		sha256sum "$$f" | cut -d' ' -f1 > "$$f.sha256"; \
	done

# Everything a tagged release publishes: the per-arch binaries + their sidecars.
release: cross checksums

clean:
	rm -rf $(BIN_DIR)
