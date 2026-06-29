import type { OperationId, OpRequest, OpResponse } from "./envelope";
import type { components } from "./gen/contract";

/**
 * Compile-time proof that the op registry extracts the right payloads from the
 * generated contract. These are type-level assertions only — no runtime output;
 * `tsc --noEmit` (the package's `typecheck` script) is what checks them. If a
 * helper or the spec drifts, one of the `Expect<…>` lines stops compiling.
 */

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

// createServer: body = CreateServerRequest, success = Server.
type _ReqCreate = Expect<
	Equal<OpRequest<"createServer">, components["schemas"]["CreateServerRequest"]>
>;
type _ResCreate = Expect<
	Equal<OpResponse<"createServer">, components["schemas"]["Server"]>
>;

// getSystem: no request body, success = System.
type _ReqNone = Expect<Equal<OpRequest<"getSystem">, undefined>>;
type _ResSystem = Expect<
	Equal<OpResponse<"getSystem">, components["schemas"]["System"]>
>;

// The op namespace includes known operations.
type _HasOp = Expect<"createServer" extends OperationId ? true : false>;

// Reference every alias so it counts as used.
export type _EnvelopeTypeAsserts = [
	_ReqCreate,
	_ResCreate,
	_ReqNone,
	_ResSystem,
	_HasOp,
];
