BINARY := wings
PKG     := ./cmd/wings
BIN_DIR := bin

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

LDFLAGS := -s -w \
	-X github.com/xena-studios/raptorpanel/apps/wings/internal/version.Version=$(VERSION) \
	-X github.com/xena-studios/raptorpanel/apps/wings/internal/version.Commit=$(COMMIT) \
	-X github.com/xena-studios/raptorpanel/apps/wings/internal/version.Date=$(DATE)

.PHONY: build run test vet fmt cross clean

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

clean:
	rm -rf $(BIN_DIR)
