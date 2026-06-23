// SFTP session domain types. A session is a short-lived, per-server credential
// the daemon mints so a user can manage files in bulk with any SFTP client
// (sandboxed to that server's data volume — see the daemon's sftp package).

/** A freshly-minted session, returned once (the password is not recoverable). */
export type SftpSession = {
	host: string;
	port: number;
	username: string;
	password: string;
	expiresAt: string;
};

/** The non-secret status of a server's SFTP session (for the active indicator). */
export type SftpStatus = {
	active: boolean;
	host: string;
	port: number;
	username: string | null;
	expiresAt: string | null;
};
