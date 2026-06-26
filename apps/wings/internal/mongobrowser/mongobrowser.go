// Package mongobrowser is the read/manage surface behind a server's MongoDB
// "Browser" add-on. It connects to the server's running MongoDB with the official
// driver using the admin user + password the panel passes (over the pinned
// channel; never stored), and exposes a database → collection → document explorer
// plus the common mutations (create/drop collection, drop database, insert/delete
// document). Every op takes a Conn (addr+user+password) so the logic is
// unit-testable against a published-port Mongo container; the API handler resolves
// the addr from the container itself (see docker.PublishedTCPPort).
package mongobrowser

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Sentinel errors the API maps onto HTTP status codes.
var (
	ErrNotFound = errors.New("document not found")
	ErrInvalid  = errors.New("invalid mongo request")
)

const (
	dialTimeout = 6 * time.Second
	// maxDocs bounds one FindDocuments page so a member can't make the root daemon
	// stream an unbounded collection into one response.
	maxDocs = 100
)

// nameRE allow-lists a database / collection name — no metacharacters, no `$`,
// no `.` (mirrors the panel's MONGO_NAME and keeps names shell/driver-safe).
var nameRE = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$`)

// Conn is everything needed to reach one Mongo instance.
type Conn struct {
	Addr     string // host:port, resolved by the caller from the container
	Username string
	Password string
}

// Database is one database in the listing.
type Database struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
}

// Collection is one collection's summary.
type Collection struct {
	Name      string `json:"name"`
	Documents int64  `json:"documents"`
	SizeBytes int64  `json:"sizeBytes"`
	Indexes   int64  `json:"indexes"`
}

// Document is one document: its display id + a relaxed-extJSON body.
type Document struct {
	ID   string `json:"id"`
	JSON string `json:"json"`
}

// DocumentPage is one find page; Total is the collection's document count.
type DocumentPage struct {
	Documents []Document `json:"documents"`
	Total     int64      `json:"total"`
}

func validName(name string) error {
	if !nameRE.MatchString(name) {
		return fmt.Errorf("%w: bad name %q", ErrInvalid, name)
	}
	return nil
}

// systemDBs are Mongo's own databases — the browser may read them but must never
// mutate them (dropping `admin` destroys the root user and bricks auth). A guard
// in the firewall/OS-drive spirit: refuse destructive ops on them server-side.
var systemDBs = map[string]bool{"admin": true, "local": true, "config": true}

func mutableDB(name string) error {
	if err := validName(name); err != nil {
		return err
	}
	if systemDBs[name] {
		return fmt.Errorf("%w: %s is a system database and can't be modified", ErrInvalid, name)
	}
	return nil
}

// uri builds the connection string. directConnection avoids replica-set discovery
// against a single managed container; authSource=admin matches the root user the
// MONGO_INITDB_ROOT_* env creates.
func uri(conn Conn) string {
	if conn.Username != "" {
		return fmt.Sprintf(
			"mongodb://%s:%s@%s/?authSource=admin&directConnection=true",
			url.QueryEscape(conn.Username), url.QueryEscape(conn.Password), conn.Addr,
		)
	}
	return fmt.Sprintf("mongodb://%s/?directConnection=true", conn.Addr)
}

// connect dials and returns a client; the caller defers disconnect.
func connect(ctx context.Context, conn Conn) (*mongo.Client, error) {
	cctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	client, err := mongo.Connect(cctx, options.Client().
		ApplyURI(uri(conn)).
		SetConnectTimeout(dialTimeout).
		SetServerSelectionTimeout(dialTimeout))
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}
	if err := client.Ping(cctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("mongo ping: %w", err)
	}
	return client, nil
}

// ListDatabases returns the instance's databases with on-disk sizes.
func ListDatabases(ctx context.Context, conn Conn) ([]Database, error) {
	client, err := connect(ctx, conn)
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(context.Background())

	res, err := client.ListDatabases(ctx, bson.D{})
	if err != nil {
		return nil, fmt.Errorf("listDatabases: %w", err)
	}
	out := make([]Database, 0, len(res.Databases))
	for _, d := range res.Databases {
		out = append(out, Database{Name: d.Name, SizeBytes: d.SizeOnDisk})
	}
	return out, nil
}

// ListCollections returns a database's collections with per-collection stats.
func ListCollections(ctx context.Context, conn Conn, dbName string) ([]Collection, error) {
	if err := validName(dbName); err != nil {
		return nil, err
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return nil, err
	}
	defer client.Disconnect(context.Background())

	db := client.Database(dbName)
	names, err := db.ListCollectionNames(ctx, bson.D{})
	if err != nil {
		return nil, fmt.Errorf("listCollections: %w", err)
	}
	out := make([]Collection, 0, len(names))
	for _, name := range names {
		out = append(out, collectionStats(ctx, db, name))
	}
	return out, nil
}

// collectionStats reads count/size/index stats best-effort (collStats), falling
// back to an estimated document count if the command is unavailable.
func collectionStats(ctx context.Context, db *mongo.Database, name string) Collection {
	c := Collection{Name: name}
	var stats struct {
		Count    int64 `bson:"count"`
		Size     int64 `bson:"size"`
		NIndexes int64 `bson:"nindexes"`
	}
	cmd := db.RunCommand(ctx, bson.D{{Key: "collStats", Value: name}})
	if err := cmd.Decode(&stats); err == nil {
		c.Documents, c.SizeBytes, c.Indexes = stats.Count, stats.Size, stats.NIndexes
		return c
	}
	if n, err := db.Collection(name).EstimatedDocumentCount(ctx); err == nil {
		c.Documents = n
	}
	return c
}

// FindDocuments returns one page of documents (sorted by _id) + the total count.
func FindDocuments(ctx context.Context, conn Conn, dbName, coll string, skip, limit int64) (DocumentPage, error) {
	if err := validName(dbName); err != nil {
		return DocumentPage{}, err
	}
	if err := validName(coll); err != nil {
		return DocumentPage{}, err
	}
	if skip < 0 {
		skip = 0
	}
	if limit <= 0 || limit > maxDocs {
		limit = 25
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return DocumentPage{}, err
	}
	defer client.Disconnect(context.Background())

	c := client.Database(dbName).Collection(coll)
	total, err := c.CountDocuments(ctx, bson.D{})
	if err != nil {
		return DocumentPage{}, fmt.Errorf("count: %w", err)
	}
	cur, err := c.Find(ctx, bson.D{}, options.Find().
		SetSkip(skip).SetLimit(limit).SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return DocumentPage{}, fmt.Errorf("find: %w", err)
	}
	defer cur.Close(ctx)

	page := DocumentPage{Documents: []Document{}, Total: total}
	for cur.Next(ctx) {
		var doc bson.D
		if err := cur.Decode(&doc); err != nil {
			return DocumentPage{}, fmt.Errorf("decode: %w", err)
		}
		raw, err := bson.MarshalExtJSON(doc, false, false)
		if err != nil {
			return DocumentPage{}, fmt.Errorf("encode: %w", err)
		}
		page.Documents = append(page.Documents, Document{ID: documentID(doc), JSON: string(raw)})
	}
	return page, cur.Err()
}

// documentID renders a document's _id for display + later delete: a hex string for
// an ObjectID, the raw value for a string/number id.
func documentID(doc bson.D) string {
	for _, e := range doc {
		if e.Key != "_id" {
			continue
		}
		switch v := e.Value.(type) {
		case primitive.ObjectID:
			return v.Hex()
		case string:
			return v
		default:
			return fmt.Sprint(v)
		}
	}
	return ""
}

// idFilter reconstructs the _id filter from the display id — an ObjectID when the
// id is 24 hex chars, otherwise a string match.
func idFilter(id string) bson.D {
	if oid, err := primitive.ObjectIDFromHex(id); err == nil {
		return bson.D{{Key: "_id", Value: oid}}
	}
	return bson.D{{Key: "_id", Value: id}}
}

// InsertDocument inserts one document parsed from extended JSON. Mongo assigns an
// _id if the document omits one.
func InsertDocument(ctx context.Context, conn Conn, dbName, coll, doc string) error {
	if err := mutableDB(dbName); err != nil {
		return err
	}
	if err := validName(coll); err != nil {
		return err
	}
	var parsed bson.D
	if err := bson.UnmarshalExtJSON([]byte(doc), false, &parsed); err != nil {
		return fmt.Errorf("%w: not valid JSON: %v", ErrInvalid, err)
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	_, err = client.Database(dbName).Collection(coll).InsertOne(ctx, parsed)
	if err != nil {
		return fmt.Errorf("insert: %w", err)
	}
	return nil
}

// DeleteDocument deletes the document with the given display id.
func DeleteDocument(ctx context.Context, conn Conn, dbName, coll, id string) error {
	if err := mutableDB(dbName); err != nil {
		return err
	}
	if err := validName(coll); err != nil {
		return err
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	res, err := client.Database(dbName).Collection(coll).DeleteOne(ctx, idFilter(id))
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	if res.DeletedCount == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateCollection creates a collection (materializing its database).
func CreateCollection(ctx context.Context, conn Conn, dbName, coll string) error {
	if err := mutableDB(dbName); err != nil {
		return err
	}
	if err := validName(coll); err != nil {
		return err
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	if err := client.Database(dbName).CreateCollection(ctx, coll); err != nil {
		return fmt.Errorf("createCollection: %w", err)
	}
	return nil
}

// DropCollection drops a collection.
func DropCollection(ctx context.Context, conn Conn, dbName, coll string) error {
	if err := mutableDB(dbName); err != nil {
		return err
	}
	if err := validName(coll); err != nil {
		return err
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	if err := client.Database(dbName).Collection(coll).Drop(ctx); err != nil {
		return fmt.Errorf("dropCollection: %w", err)
	}
	return nil
}

// DropDatabase drops a whole database.
func DropDatabase(ctx context.Context, conn Conn, dbName string) error {
	if err := mutableDB(dbName); err != nil {
		return err
	}
	client, err := connect(ctx, conn)
	if err != nil {
		return err
	}
	defer client.Disconnect(context.Background())
	if err := client.Database(dbName).Drop(ctx); err != nil {
		return fmt.Errorf("dropDatabase: %w", err)
	}
	return nil
}
