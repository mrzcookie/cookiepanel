package firewall

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

// ─── unsupported: no firewall tool present (e.g. macOS dev) ───

type unsupportedBackend struct{}

func (unsupportedBackend) Name() string                      { return "unsupported" }
func (unsupportedBackend) Open(context.Context, Rule) error  { return ErrUnsupported }
func (unsupportedBackend) Close(context.Context, Rule) error { return ErrUnsupported }
func (unsupportedBackend) List(context.Context) ([]Rule, error) {
	return []Rule{}, nil
}

// ─── ufw ───

type ufwBackend struct{}

func (ufwBackend) Name() string { return "ufw" }

func (ufwBackend) Open(ctx context.Context, r Rule) error {
	_, err := run(
		ctx, "ufw", "allow",
		fmt.Sprintf("%d/%s", r.Port, r.Protocol),
		"comment", RuleComment,
	)
	return err
}

func (ufwBackend) Close(ctx context.Context, r Rule) error {
	// ufw matches rules by spec and ignores the comment, so `ufw delete allow
	// PORT/PROTO` could remove the operator's OWN untagged rule for that port.
	// Instead find our tagged rule's number and delete exactly that one.
	out, err := run(ctx, "ufw", "status", "numbered")
	if err != nil {
		return err
	}
	spec := fmt.Sprintf("%d/%s", r.Port, r.Protocol)
	num := ""
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, RuleComment) {
			continue
		}
		start := strings.IndexByte(line, '[')
		end := strings.IndexByte(line, ']')
		if start < 0 || end < start {
			continue
		}
		// The port/proto must appear as a whole field (not a substring of e.g.
		// 122/tcp) after the "[ n]" index prefix.
		matched := false
		for _, f := range strings.Fields(line[end+1:]) {
			if f == spec {
				matched = true
				break
			}
		}
		if matched {
			num = strings.TrimSpace(line[start+1 : end])
			break
		}
	}
	if num == "" {
		return nil // no tagged rule of ours to remove
	}
	// "y\n" answers ufw's interactive delete confirmation (run uses arg vectors,
	// never a shell), so the delete proceeds non-interactively.
	_, err = runStdin(ctx, "y\n", "ufw", "delete", num)
	return err
}

func (ufwBackend) List(ctx context.Context) ([]Rule, error) {
	out, err := run(ctx, "ufw", "status")
	if err != nil {
		return nil, err
	}
	var rules []Rule
	for _, line := range strings.Split(out, "\n") {
		// Only our tagged rules.
		if !strings.Contains(line, RuleComment) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if rule, ok := parsePortProto(fields[0]); ok {
			rules = append(rules, rule)
		}
	}
	return rules, nil
}

// ─── iptables ───

type iptablesBackend struct{}

func (iptablesBackend) Name() string { return "iptables" }

func ruleArgs(op string, r Rule) []string {
	return []string{
		op, "INPUT",
		"-p", r.Protocol,
		"--dport", strconv.Itoa(r.Port),
		"-m", "comment", "--comment", RuleComment,
		"-j", "ACCEPT",
	}
}

func (iptablesBackend) Open(ctx context.Context, r Rule) error {
	// Idempotent: -C checks for the rule; skip the append if it already exists.
	if _, err := run(ctx, "iptables", ruleArgs("-C", r)...); err == nil {
		return nil
	}
	_, err := run(ctx, "iptables", ruleArgs("-A", r)...)
	return err
}

func (iptablesBackend) Close(ctx context.Context, r Rule) error {
	_, err := run(ctx, "iptables", ruleArgs("-D", r)...)
	return err
}

func (iptablesBackend) List(ctx context.Context) ([]Rule, error) {
	out, err := run(ctx, "iptables", "-S", "INPUT")
	if err != nil {
		return nil, err
	}
	var rules []Rule
	for _, line := range strings.Split(out, "\n") {
		if !(strings.Contains(line, RuleComment) && strings.Contains(line, "--dport")) {
			continue
		}
		fields := strings.Fields(line)
		var port, proto string
		for i, f := range fields {
			if f == "-p" && i+1 < len(fields) {
				proto = fields[i+1]
			}
			if f == "--dport" && i+1 < len(fields) {
				port = fields[i+1]
			}
		}
		if port != "" && proto != "" {
			if rule, ok := parsePortProto(port + "/" + proto); ok {
				rules = append(rules, rule)
			}
		}
	}
	return rules, nil
}

// parsePortProto parses "25565/tcp" or "25565" (default tcp), bounded + validated.
func parsePortProto(tok string) (Rule, bool) {
	parts := strings.SplitN(tok, "/", 2)
	port, err := strconv.Atoi(parts[0])
	if err != nil || port < 1 || port > 65535 {
		return Rule{}, false
	}
	proto := "tcp"
	if len(parts) == 2 {
		proto = strings.ToLower(parts[1])
	}
	if proto != "tcp" && proto != "udp" {
		return Rule{}, false
	}
	return Rule{Port: port, Protocol: proto}, true
}
