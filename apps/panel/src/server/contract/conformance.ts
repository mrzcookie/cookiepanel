/**
 * Contract conformance (panel side). Each hand-written daemon-client wire type
 * must be structurally identical to the matching spec-generated type. If the
 * panel's types and the OpenAPI spec drift apart, one of these `Expect<Equal<…>>`
 * lines stops type-checking — the panel-side half of the contract's anti-drift
 * guarantee. Type-only; no runtime code, nothing imports it (tsc evaluates it).
 */

import type { components } from "@cookiepanel/contract";
import type {
	DaemonBackup,
	DaemonDownloadJob,
	DaemonDrive,
	DaemonFileEntry,
	DaemonFirewall,
	DaemonNetwork,
	DaemonNetworkSpec,
	DaemonSchedule,
	DaemonScheduleStep,
	DaemonServer,
	DaemonServerSpec,
	DaemonSftpMint,
	DaemonSftpStatus,
} from "@/server/nodes/daemon-client";

// Strict structural equality (the canonical two-function trick).
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;

type S = components["schemas"];

// One exported tuple so the assertions aren't flagged as unused locals; every
// element must resolve to `true` or tsc fails on the drifted line. Exported (not
// imported anywhere) on purpose — see knip ignore for this file.
export type ContractConformance = [
	Expect<Equal<DaemonServer, S["Server"]>>,
	Expect<Equal<DaemonServerSpec, S["CreateServerRequest"]>>,
	Expect<Equal<DaemonNetwork, S["Network"]>>,
	Expect<Equal<DaemonNetworkSpec, S["CreateNetworkRequest"]>>,
	Expect<Equal<DaemonFirewall, S["FirewallStatus"]>>,
	Expect<Equal<DaemonDrive, S["Drive"]>>,
	Expect<Equal<DaemonFileEntry, S["FileEntry"]>>,
	Expect<Equal<DaemonDownloadJob, S["DownloadJob"]>>,
	Expect<Equal<DaemonSftpMint, S["SftpMintResponse"]>>,
	Expect<Equal<DaemonSftpStatus, S["SftpStatusResponse"]>>,
	Expect<Equal<DaemonScheduleStep, S["ScheduleStep"]>>,
	Expect<Equal<DaemonSchedule, S["Schedule"]>>,
	Expect<Equal<DaemonBackup, S["Backup"]>>,
];
