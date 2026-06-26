package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/xena-studios/raptor/apps/wings/internal/filesystem"
	"gopkg.in/yaml.v3"
)

// errUnsupportedParser marks a config-file parser we don't implement; the file
// is skipped rather than aborting the whole create.
var errUnsupportedParser = errors.New("unsupported config parser")

// applyConfigFiles merges each managed config file into the data volume. Values
// in Replace are already substituted by the panel. Unknown parsers are skipped;
// other errors abort so a misconfigured template surfaces loudly.
func (m *Manager) applyConfigFiles(
	ctx context.Context,
	serverID string,
	files []ConfigFile,
) error {
	for _, cf := range files {
		if len(cf.Replace) == 0 {
			continue
		}
		// Ensure a nested parent dir exists before writing (install usually
		// created it, but be safe).
		rel := strings.TrimPrefix(cf.File, "/")
		if dir := path.Dir(rel); dir != "." && dir != "/" && dir != "" {
			_ = m.files.Mkdir(ctx, serverID, dir)
		}

		existing, err := m.files.Read(ctx, serverID, cf.File)
		if err != nil && !errors.Is(err, filesystem.ErrNotFound) {
			// The current file can't be read (too large, a symlink, …). Skip
			// templating it rather than failing the whole deploy over one config.
			slog.Warn("skipping config-file template",
				"server", serverID, "file", cf.File, "err", err)
			continue
		}

		merged, err := mergeConfig(cf.Parser, existing, cf.Replace)
		if errors.Is(err, errUnsupportedParser) {
			continue
		}
		if err != nil {
			return fmt.Errorf("config %s: %w", cf.File, err)
		}
		if err := m.files.Write(ctx, serverID, cf.File, merged); err != nil {
			return fmt.Errorf("config %s: %w", cf.File, err)
		}
	}
	return nil
}

func mergeConfig(parser string, existing []byte, replace map[string]string) ([]byte, error) {
	switch strings.ToLower(parser) {
	case "properties":
		return mergeProperties(existing, replace), nil
	case "ini":
		return mergeINI(existing, replace), nil
	case "json":
		return mergeJSON(existing, replace)
	case "yaml", "yml":
		return mergeYAML(existing, replace)
	case "file":
		return mergeFile(existing, replace), nil
	default:
		return nil, errUnsupportedParser
	}
}

// ── parsers ───────────────────────────────────────────────────────────────────

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// mergeProperties rewrites `key=value` lines in place (preserving comments and
// order) and appends any keys that weren't present.
func mergeProperties(existing []byte, replace map[string]string) []byte {
	lines := strings.Split(strings.ReplaceAll(string(existing), "\r\n", "\n"), "\n")
	seen := map[string]bool{}
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "!") {
			continue
		}
		eq := strings.Index(line, "=")
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		if val, ok := replace[key]; ok {
			lines[i] = key + "=" + val
			seen[key] = true
		}
	}
	out := lines
	if len(existing) == 0 {
		out = nil // start clean so we don't emit a leading blank line
	}
	for _, k := range sortedKeys(replace) {
		if !seen[k] {
			out = append(out, k+"="+replace[k])
		}
	}
	return []byte(strings.Join(out, "\n"))
}

// mergeINI parses sections, applies `section.key` / `key` replacements, and
// re-emits. Comments are not preserved (ini is rare in eggs).
func mergeINI(existing []byte, replace map[string]string) []byte {
	type kv struct{ k, v string }
	order := []string{""}
	data := map[string][]kv{"": {}}
	cur := ""
	for _, line := range strings.Split(string(existing), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, ";") || strings.HasPrefix(t, "#") {
			continue
		}
		if strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]") {
			cur = strings.TrimSpace(t[1 : len(t)-1])
			if _, ok := data[cur]; !ok {
				order = append(order, cur)
				data[cur] = []kv{}
			}
			continue
		}
		if eq := strings.Index(line, "="); eq >= 0 {
			data[cur] = append(data[cur], kv{
				strings.TrimSpace(line[:eq]),
				strings.TrimSpace(line[eq+1:]),
			})
		}
	}
	set := func(section, key, val string) {
		if _, ok := data[section]; !ok {
			order = append(order, section)
			data[section] = []kv{}
		}
		for i := range data[section] {
			if data[section][i].k == key {
				data[section][i].v = val
				return
			}
		}
		data[section] = append(data[section], kv{key, val})
	}
	for _, dotted := range sortedKeys(replace) {
		section, key := "", dotted
		if i := strings.Index(dotted, "."); i >= 0 {
			section, key = dotted[:i], dotted[i+1:]
		}
		set(section, key, replace[dotted])
	}
	var b strings.Builder
	for _, s := range order {
		if len(data[s]) == 0 {
			continue
		}
		if s != "" {
			fmt.Fprintf(&b, "[%s]\n", s)
		}
		for _, e := range data[s] {
			fmt.Fprintf(&b, "%s=%s\n", e.k, e.v)
		}
	}
	return []byte(b.String())
}

func mergeJSON(existing []byte, replace map[string]string) ([]byte, error) {
	root := map[string]any{}
	if len(bytes.TrimSpace(existing)) > 0 {
		// Tolerate an unparseable existing file by starting fresh.
		_ = json.Unmarshal(existing, &root)
		if root == nil {
			root = map[string]any{}
		}
	}
	for _, dotted := range sortedKeys(replace) {
		setDotted(root, strings.Split(dotted, "."), coerce(replace[dotted]))
	}
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}

func mergeYAML(existing []byte, replace map[string]string) ([]byte, error) {
	root := map[string]any{}
	if len(bytes.TrimSpace(existing)) > 0 {
		_ = yaml.Unmarshal(existing, &root)
		if root == nil {
			root = map[string]any{}
		}
	}
	for _, dotted := range sortedKeys(replace) {
		setDotted(root, strings.Split(dotted, "."), coerce(replace[dotted]))
	}
	return yaml.Marshal(root)
}

// mergeFile is Pterodactyl's "file" parser: a literal find→replace across the
// raw text. Applied in sorted key order for determinism.
func mergeFile(existing []byte, replace map[string]string) []byte {
	s := string(existing)
	for _, k := range sortedKeys(replace) {
		s = strings.ReplaceAll(s, k, replace[k])
	}
	return []byte(s)
}

// setDotted walks/creates nested maps and sets the leaf value.
func setDotted(root map[string]any, parts []string, val any) {
	cur := root
	for i, p := range parts {
		if i == len(parts)-1 {
			cur[p] = val
			return
		}
		next, ok := cur[p].(map[string]any)
		if !ok {
			next = map[string]any{}
			cur[p] = next
		}
		cur = next
	}
}

// coerce keeps booleans and numbers as native types so structured configs get
// `port: 25565` (not `port: "25565"`); everything else stays a string.
func coerce(v string) any {
	switch strings.ToLower(v) {
	case "true":
		return true
	case "false":
		return false
	}
	if i, err := strconv.ParseInt(v, 10, 64); err == nil {
		return i
	}
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		return f
	}
	return v
}
