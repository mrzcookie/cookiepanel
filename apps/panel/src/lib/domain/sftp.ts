// SFTP-session domain types (client-safe). An SftpSession is an ephemeral,
// per-server file-access session — daemon-owned in the real product (a scoped,
// time-boxed account rooted at the server's volume). The mutable stub store
// lives in stores/sftp-store.ts.

export type SftpSession = {
	id: string;
	serverId: string;
	host: string;
	port: number;
	username: string;
	password: string;
};
