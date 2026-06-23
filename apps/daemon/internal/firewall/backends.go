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
	_, err := run(
		ctx, "ufw", "delete", "allow",
		fmt.Sprintf("%d/%s", r.Port, r.Protocol),
	)
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
