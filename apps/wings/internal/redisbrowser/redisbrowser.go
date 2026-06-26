// Package redisbrowser is the read/manage surface behind a server's Redis
// "Browser" add-on. It connects to the server's running Redis with go-redis using
// the admin password the panel passes (over the pinned channel; never stored),
// and exposes an INFO-derived overview, a paginated keyspace scan, type-aware key
// inspection, and the common key mutations (set/create, ttl, rename, delete,
// flush). Every op takes a Conn (addr+password+db) so the logic is unit-testable
// against a published-port Redis container; the API handler resolves the addr from
// the container itself (see docker.PublishedTCPPort).
package redisbrowser

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Sentinel errors the API maps onto HTTP status codes.
var (
	ErrNotFound = errors.New("key not found")
	ErrInvalid  = errors.New("invalid redis request")
)

// dialTimeout bounds the initial connect so an unreachable/locked instance fails
// fast rather than hanging the panel request.
const dialTimeout = 5 * time.Second

// Conn is everything needed to reach one Redis instance + logical DB.
type Conn struct {
	Addr     string // host:port, resolved by the caller from the container
	Password string
	DB       int
}

// Overview is the INFO-derived dashboard.
type Overview struct {
	Version          string       `json:"version"`
	Mode             string       `json:"mode"`
	UptimeSeconds    int64        `json:"uptimeSeconds"`
	ConnectedClients int64        `json:"connectedClients"`
	UsedMemoryBytes  int64        `json:"usedMemoryBytes"`
	PeakMemoryBytes  int64        `json:"peakMemoryBytes"`
	MaxMemoryBytes   int64        `json:"maxMemoryBytes"`
	KeyspaceHits     int64        `json:"keyspaceHits"`
	KeyspaceMisses   int64        `json:"keyspaceMisses"`
	TotalCommands    int64        `json:"totalCommands"`
	Databases        []DBKeyspace `json:"databases"`
}

// DBKeyspace is one logical DB's key counts (from the INFO keyspace section).
type DBKeyspace struct {
	DB      int   `json:"db"`
	Keys    int64 `json:"keys"`
	Expires int64 `json:"expires"`
}

// KeySummary is one row in the keyspace list.
type KeySummary struct {
	Key string `json:"key"`
	// Type is string|hash|list|set|zset|stream|none.
	Type string `json:"type"`
	// TTLSeconds is the seconds until expiry, or -1 for no expiry.
	TTLSeconds int64 `json:"ttlSeconds"`
	// SizeBytes is the key's memory footprint (MEMORY USAGE), 0 if unavailable.
	SizeBytes int64 `json:"sizeBytes"`
	// Length is the element count (or string length).
	Length int64 `json:"length"`
}

// KeyList is one SCAN page. Cursor is the opaque next-page cursor as a string
// ("0" means the scan is complete) — a string avoids uint64↔JS-number precision
// loss on the wire.
type KeyList struct {
	Keys   []KeySummary `json:"keys"`
	Cursor string       `json:"cursor"`
}

// Field is one hash field / stream-entry field.
type Field struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

// ScoreMember is one sorted-set member with its score.
type ScoreMember struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

// StreamEntry is one stream entry.
type StreamEntry struct {
	ID     string  `json:"id"`
	Fields []Field `json:"fields"`
}

// KeyDetail is a key's full, type-shaped value. Only the slice for the key's type
// is populated. Truncated is true when the value was capped (Length is the real
// element count / byte length) so the daemon never loads an unbounded structure.
type KeyDetail struct {
	Key        string        `json:"key"`
	Type       string        `json:"type"`
	TTLSeconds int64         `json:"ttlSeconds"`
	SizeBytes  int64         `json:"sizeBytes"`
	Length     int64         `json:"length"`
	Truncated  bool          `json:"truncated"`
	String     string        `json:"string,omitempty"`
	Fields     []Field       `json:"fields,omitempty"`
	Items      []string      `json:"items,omitempty"`
	Members    []ScoreMember `json:"members,omitempty"`
	Entries    []StreamEntry `json:"entries,omitempty"`
}

// SetRequest creates or fully replaces a key. The value field matching Type is
// used; TTLSeconds < 0 means no expiry.
type SetRequest struct {
	Key        string        `json:"key"`
	Type       string        `json:"type"`
	TTLSeconds int64         `json:"ttlSeconds"`
	String     string        `json:"string,omitempty"`
	Fields     []Field       `json:"fields,omitempty"`
	Items      []string      `json:"items,omitempty"`
	Members    []ScoreMember `json:"members,omitempty"`
}

// maxScanCount bounds how many keys one ScanKeys page hydrates (TYPE+TTL+size per
// key is N round-trips via a pipeline; keep the page modest).
const maxScanCount = 500

func dial(conn Conn) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:        conn.Addr,
		Password:    conn.Password,
		DB:          conn.DB,
		DialTimeout: dialTimeout,
	})
}

// GetOverview connects and returns the INFO-derived dashboard.
func GetOverview(ctx context.Context, conn Conn) (Overview, error) {
	c := dial(conn)
	defer c.Close()
	raw, err := c.Info(ctx).Result()
	if err != nil {
		return Overview{}, fmt.Errorf("redis INFO: %w", err)
	}
	return parseInfo(raw), nil
}

// ScanKeys returns one page of keys matching pattern (default "*"), each hydrated
// with its type, TTL, size, and length. cursor is the opaque page cursor as a
// string ("" or "0" starts a new scan).
func ScanKeys(ctx context.Context, conn Conn, pattern, cursor string, count int64) (KeyList, error) {
	if pattern == "" {
		pattern = "*"
	}
	if count <= 0 || count > maxScanCount {
		count = 100
	}
	start := uint64(0)
	if cursor != "" {
		var err error
		if start, err = strconv.ParseUint(cursor, 10, 64); err != nil {
			return KeyList{}, fmt.Errorf("%w: bad cursor %q", ErrInvalid, cursor)
		}
	}
	c := dial(conn)
	defer c.Close()

	keys, next, err := c.Scan(ctx, start, pattern, count).Result()
	if err != nil {
		return KeyList{}, fmt.Errorf("redis SCAN: %w", err)
	}
	out := KeyList{Keys: make([]KeySummary, 0, len(keys)), Cursor: strconv.FormatUint(next, 10)}
	for _, k := range keys {
		out.Keys = append(out.Keys, summarize(ctx, c, k))
	}
	sort.Slice(out.Keys, func(i, j int) bool { return out.Keys[i].Key < out.Keys[j].Key })
	return out, nil
}

func summarize(ctx context.Context, c *redis.Client, key string) KeySummary {
	s := KeySummary{Key: key, Type: "none", TTLSeconds: -1}
	if t, err := c.Type(ctx, key).Result(); err == nil {
		s.Type = t
	}
	if d, err := c.TTL(ctx, key).Result(); err == nil {
		s.TTLSeconds = ttlToSeconds(d)
	}
	if n, err := c.MemoryUsage(ctx, key).Result(); err == nil {
		s.SizeBytes = n
	}
	s.Length = keyLength(ctx, c, key, s.Type)
	return s
}

func keyLength(ctx context.Context, c *redis.Client, key, typ string) int64 {
	switch typ {
	case "string":
		n, _ := c.StrLen(ctx, key).Result()
		return n
	case "hash":
		n, _ := c.HLen(ctx, key).Result()
		return n
	case "list":
		n, _ := c.LLen(ctx, key).Result()
		return n
	case "set":
		n, _ := c.SCard(ctx, key).Result()
		return n
	case "zset":
		n, _ := c.ZCard(ctx, key).Result()
		return n
	case "stream":
		n, _ := c.XLen(ctx, key).Result()
		return n
	default:
		return 0
	}
}

// GetKey returns a key's value, shaped by its type. Every branch is bounded — the
// daemon runs as root, so a member must not be able to make it load a
// million-field hash or a 512 MB string into memory. A missing key is an error.
func GetKey(ctx context.Context, conn Conn, key string) (KeyDetail, error) {
	c := dial(conn)
	defer c.Close()

	typ, err := c.Type(ctx, key).Result()
	if err != nil {
		return KeyDetail{}, fmt.Errorf("redis TYPE: %w", err)
	}
	if typ == "none" {
		return KeyDetail{}, ErrNotFound
	}
	d := KeyDetail{Key: key, Type: typ, TTLSeconds: -1}
	if ttl, err := c.TTL(ctx, key).Result(); err == nil {
		d.TTLSeconds = ttlToSeconds(ttl)
	}
	if n, err := c.MemoryUsage(ctx, key).Result(); err == nil {
		d.SizeBytes = n
	}
	d.Length = keyLength(ctx, c, key, typ)

	switch typ {
	case "string":
		if d.Length > maxStringBytes {
			d.String, err = c.GetRange(ctx, key, 0, maxStringBytes-1).Result()
			d.Truncated = true
		} else {
			d.String, err = c.Get(ctx, key).Result()
		}
	case "hash":
		d.Fields, err = scanHash(ctx, c, key)
		d.Truncated = d.Length > int64(len(d.Fields))
	case "set":
		d.Items, err = scanSet(ctx, c, key)
		d.Truncated = d.Length > int64(len(d.Items))
	case "list":
		d.Items, err = c.LRange(ctx, key, 0, maxElems-1).Result()
		d.Truncated = d.Length > int64(len(d.Items))
	case "zset":
		var zs []redis.Z
		zs, err = c.ZRangeWithScores(ctx, key, 0, maxElems-1).Result()
		for _, z := range zs {
			d.Members = append(d.Members, ScoreMember{Member: fmt.Sprint(z.Member), Score: z.Score})
		}
		d.Truncated = d.Length > int64(len(d.Members))
	case "stream":
		var msgs []redis.XMessage
		msgs, err = c.XRangeN(ctx, key, "-", "+", maxElems).Result()
		for _, m := range msgs {
			d.Entries = append(d.Entries, StreamEntry{ID: m.ID, Fields: fieldsFromAny(m.Values)})
		}
		d.Truncated = d.Length > int64(len(d.Entries))
	}
	if err != nil {
		return KeyDetail{}, fmt.Errorf("redis read %s: %w", typ, err)
	}
	return d, nil
}

// maxElems bounds how many collection elements GetKey returns; maxStringBytes
// bounds a single string value — both guard the root daemon against loading an
// unbounded structure into memory (it sets Truncated when it caps).
const (
	maxElems       = 1000
	maxStringBytes = 256 * 1024
)

// scanHash collects up to maxElems hash field/value pairs via HSCAN, so a huge
// hash is bounded incrementally rather than loaded whole (HGETALL).
func scanHash(ctx context.Context, c *redis.Client, key string) ([]Field, error) {
	var out []Field
	var cursor uint64
	for len(out) < maxElems {
		kv, next, err := c.HScan(ctx, key, cursor, "*", 200).Result()
		if err != nil {
			return nil, err
		}
		for i := 0; i+1 < len(kv) && len(out) < maxElems; i += 2 {
			out = append(out, Field{Field: kv[i], Value: kv[i+1]})
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Field < out[j].Field })
	return out, nil
}

// scanSet collects up to maxElems set members via SSCAN (bounded like scanHash).
func scanSet(ctx context.Context, c *redis.Client, key string) ([]string, error) {
	var out []string
	var cursor uint64
	for len(out) < maxElems {
		members, next, err := c.SScan(ctx, key, cursor, "*", 200).Result()
		if err != nil {
			return nil, err
		}
		for _, m := range members {
			if len(out) >= maxElems {
				break
			}
			out = append(out, m)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Strings(out)
	return out, nil
}

// SetKey creates or fully replaces a key with the value for its type, then applies
// the TTL. Replace semantics keep create + edit one operation.
func SetKey(ctx context.Context, conn Conn, req SetRequest) error {
	if req.Key == "" {
		return fmt.Errorf("%w: key is required", ErrInvalid)
	}
	c := dial(conn)
	defer c.Close()

	// Replace: drop any existing value so a type change is clean.
	if err := c.Del(ctx, req.Key).Err(); err != nil {
		return fmt.Errorf("redis DEL: %w", err)
	}
	if err := writeValue(ctx, c, req); err != nil {
		return err
	}
	if req.TTLSeconds >= 0 {
		if err := c.Expire(ctx, req.Key, time.Duration(req.TTLSeconds)*time.Second).Err(); err != nil {
			return fmt.Errorf("redis EXPIRE: %w", err)
		}
	}
	return nil
}

func writeValue(ctx context.Context, c *redis.Client, req SetRequest) error {
	switch req.Type {
	case "string":
		return c.Set(ctx, req.Key, req.String, 0).Err()
	case "hash":
		if len(req.Fields) == 0 {
			return fmt.Errorf("%w: hash needs at least one field", ErrInvalid)
		}
		pairs := make([]any, 0, len(req.Fields)*2)
		for _, f := range req.Fields {
			pairs = append(pairs, f.Field, f.Value)
		}
		return c.HSet(ctx, req.Key, pairs...).Err()
	case "list":
		if len(req.Items) == 0 {
			return fmt.Errorf("%w: list needs at least one item", ErrInvalid)
		}
		return c.RPush(ctx, req.Key, toAnySlice(req.Items)...).Err()
	case "set":
		if len(req.Items) == 0 {
			return fmt.Errorf("%w: set needs at least one member", ErrInvalid)
		}
		return c.SAdd(ctx, req.Key, toAnySlice(req.Items)...).Err()
	case "zset":
		if len(req.Members) == 0 {
			return fmt.Errorf("%w: zset needs at least one member", ErrInvalid)
		}
		zs := make([]redis.Z, 0, len(req.Members))
		for _, m := range req.Members {
			zs = append(zs, redis.Z{Member: m.Member, Score: m.Score})
		}
		return c.ZAdd(ctx, req.Key, zs...).Err()
	default:
		return fmt.Errorf("%w: unsupported type %q", ErrInvalid, req.Type)
	}
}

// DeleteKey removes a key (idempotent).
func DeleteKey(ctx context.Context, conn Conn, key string) error {
	c := dial(conn)
	defer c.Close()
	return c.Del(ctx, key).Err()
}

// RenameKey renames key to newKey (RENAME — fails if key is missing).
func RenameKey(ctx context.Context, conn Conn, key, newKey string) error {
	if key == "" || newKey == "" {
		return fmt.Errorf("%w: key and newKey are required", ErrInvalid)
	}
	c := dial(conn)
	defer c.Close()
	if err := c.Rename(ctx, key, newKey).Err(); err != nil {
		return fmt.Errorf("redis RENAME: %w", err)
	}
	return nil
}

// SetTTL sets a key's expiry; ttlSeconds < 0 removes it (PERSIST).
func SetTTL(ctx context.Context, conn Conn, key string, ttlSeconds int64) error {
	c := dial(conn)
	defer c.Close()
	if ttlSeconds < 0 {
		return c.Persist(ctx, key).Err()
	}
	return c.Expire(ctx, key, time.Duration(ttlSeconds)*time.Second).Err()
}

// FlushDB empties the connected logical DB. Destructive — the panel confirms it.
func FlushDB(ctx context.Context, conn Conn) error {
	c := dial(conn)
	defer c.Close()
	return c.FlushDB(ctx).Err()
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func ttlToSeconds(d time.Duration) int64 {
	if d < 0 { // -1 (no expiry) or -2 (missing) → treat both as "no expiry"
		return -1
	}
	return int64(d / time.Second)
}

func fieldsFromAny(m map[string]any) []Field {
	out := make([]Field, 0, len(m))
	for k, v := range m {
		out = append(out, Field{Field: k, Value: fmt.Sprint(v)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Field < out[j].Field })
	return out
}

func toAnySlice(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

// parseInfo turns a raw INFO reply into the Overview. INFO is `key:value` lines
// grouped by `# Section`; we flatten the scalar fields and parse the keyspace
// (`dbN:keys=..,expires=..`) lines.
func parseInfo(raw string) Overview {
	flat := map[string]string{}
	var dbs []DBKeyspace
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		if strings.HasPrefix(k, "db") {
			if db := parseKeyspaceLine(k, v); db != nil {
				dbs = append(dbs, *db)
			}
			continue
		}
		flat[k] = v
	}
	sort.Slice(dbs, func(i, j int) bool { return dbs[i].DB < dbs[j].DB })
	return Overview{
		Version:          flat["redis_version"],
		Mode:             flat["redis_mode"],
		UptimeSeconds:    atoi(flat["uptime_in_seconds"]),
		ConnectedClients: atoi(flat["connected_clients"]),
		UsedMemoryBytes:  atoi(flat["used_memory"]),
		PeakMemoryBytes:  atoi(flat["used_memory_peak"]),
		MaxMemoryBytes:   atoi(flat["maxmemory"]),
		KeyspaceHits:     atoi(flat["keyspace_hits"]),
		KeyspaceMisses:   atoi(flat["keyspace_misses"]),
		TotalCommands:    atoi(flat["total_commands_processed"]),
		Databases:        dbs,
	}
}

// parseKeyspaceLine parses `db0` + `keys=1,expires=0,avg_ttl=0`.
func parseKeyspaceLine(name, rest string) *DBKeyspace {
	idx, err := strconv.Atoi(strings.TrimPrefix(name, "db"))
	if err != nil {
		return nil
	}
	db := DBKeyspace{DB: idx}
	for _, part := range strings.Split(rest, ",") {
		k, v, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		switch k {
		case "keys":
			db.Keys = atoi(v)
		case "expires":
			db.Expires = atoi(v)
		}
	}
	return &db
}

func atoi(s string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n
}
