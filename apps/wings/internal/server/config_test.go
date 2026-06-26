package server

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestMergeProperties(t *testing.T) {
	existing := "# a comment\nserver-port=25565\ndifficulty=easy\n"
	out, err := mergeConfig("properties", []byte(existing), map[string]string{
		"server-port": "25571",
		"motd":        "Hello",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	got := string(out)
	if !strings.Contains(got, "server-port=25571") {
		t.Fatalf("port not updated in place:\n%s", got)
	}
	if !strings.Contains(got, "difficulty=easy") || !strings.Contains(got, "# a comment") {
		t.Fatalf("untouched lines/comments lost:\n%s", got)
	}
	if !strings.Contains(got, "motd=Hello") {
		t.Fatalf("new key not appended:\n%s", got)
	}
}

func TestMergeJSONNestedAndTyped(t *testing.T) {
	out, err := mergeConfig("json", []byte(`{"existing":true}`), map[string]string{
		"settings.port": "25565",
		"settings.name": "My Server",
		"enabled":       "false",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var root map[string]any
	if err := json.Unmarshal(out, &root); err != nil {
		t.Fatalf("output not valid json: %v\n%s", err, out)
	}
	settings, ok := root["settings"].(map[string]any)
	if !ok {
		t.Fatalf("settings not nested: %#v", root["settings"])
	}
	// Numbers coerce to JSON numbers, not strings.
	if got, ok := settings["port"].(float64); !ok || got != 25565 {
		t.Fatalf("port = %#v, want number 25565", settings["port"])
	}
	if settings["name"] != "My Server" {
		t.Fatalf("name = %#v", settings["name"])
	}
	if root["enabled"] != false {
		t.Fatalf("enabled = %#v, want bool false", root["enabled"])
	}
	if root["existing"] != true {
		t.Fatalf("existing key clobbered: %#v", root["existing"])
	}
}

func TestMergeYAMLNested(t *testing.T) {
	out, err := mergeConfig("yaml", []byte("keep: 1\n"), map[string]string{
		"server.port": "2456",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var root map[string]any
	if err := yaml.Unmarshal(out, &root); err != nil {
		t.Fatalf("output not valid yaml: %v", err)
	}
	server, ok := root["server"].(map[string]any)
	if !ok {
		t.Fatalf("server not nested: %#v", root["server"])
	}
	if got, _ := server["port"].(int); got != 2456 {
		t.Fatalf("port = %#v, want int 2456", server["port"])
	}
	if root["keep"] == nil {
		t.Fatal("existing key lost")
	}
}

func TestMergeINI(t *testing.T) {
	out, err := mergeConfig("ini", []byte("[net]\nport=1\n"), map[string]string{
		"net.port": "2456",
		"net.name": "world",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	got := string(out)
	if !strings.Contains(got, "[net]") || !strings.Contains(got, "port=2456") || !strings.Contains(got, "name=world") {
		t.Fatalf("ini merge wrong:\n%s", got)
	}
}

func TestMergeFileLiteral(t *testing.T) {
	out, err := mergeConfig("file", []byte("hello WORLD"), map[string]string{
		"WORLD": "there",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if string(out) != "hello there" {
		t.Fatalf("file replace = %q", out)
	}
}

func TestMergeUnsupportedParser(t *testing.T) {
	if _, err := mergeConfig("xml", []byte("<x/>"), map[string]string{"a": "b"}); !errors.Is(err, errUnsupportedParser) {
		t.Fatalf("err = %v, want errUnsupportedParser", err)
	}
}
