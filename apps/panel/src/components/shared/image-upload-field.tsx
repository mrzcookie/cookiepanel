import { Loader2, type LucideIcon } from "lucide-react";
import {
	type ChangeEvent,
	type ReactNode,
	useId,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Single source of truth so avatars and org logos accept exactly the same
// formats and size. The most common raster formats; no SVG.
export const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
export const IMAGE_UPLOAD_HINT = "PNG, JPG, or WebP, up to 2 MB.";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Two modes:
 * - **Preview** (`value`/`onChange`, or neither): reads the file to a data URL
 *   locally — for fields whose backend isn't wired yet (org logo, template icon).
 * - **Live upload** (`onUpload`): hands the raw `File` to the caller, which owns
 *   the request, the toast, and refreshing `value` (so pass `value` too). No
 *   data-URL read and no premature "updated" toast; the field shows a busy state
 *   while the caller's promise is in flight.
 */
export function ImageUploadField({
	icon: Icon,
	label,
	shape,
	value,
	onChange,
	onUpload,
	onRemove,
	loading,
	fallback,
}: {
	icon: LucideIcon;
	label: string;
	shape: "circle" | "square";
	/** Controlled image (data URL or remote URL). Omit for an uncontrolled
	 * preview-only field. Required when using `onUpload`. */
	value?: string | null;
	/** Preview mode: called with the new data URL (or null when removed). */
	onChange?: (dataUrl: string | null) => void;
	/** Live-upload mode: called with the picked File; resolve once persisted. */
	onUpload?: (file: File) => Promise<void>;
	/** Live-upload mode: called when the user removes the current image. */
	onRemove?: () => void | Promise<void>;
	/** The image value is still loading — show a skeleton in place of it and
	 * disable the controls. The label + hint stay (they're not fetched). */
	loading?: boolean;
	/** Shown in the avatar when there's no image (e.g. a name's initials); falls
	 * back to `icon` when omitted or empty. */
	fallback?: ReactNode;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Controlled when a value prop is passed; otherwise track an internal preview.
	const controlled = value !== undefined;
	const current = controlled ? value : preview;
	const square = shape === "square";
	const hintId = useId();

	async function onSelect(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) {
			return;
		}
		// `accept` is only a picker hint, so re-check the type here.
		if (!IMAGE_UPLOAD_ACCEPT.split(",").includes(file.type)) {
			toast.error("Use a PNG, JPG, or WebP image.");
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			toast.error("That image is over 2 MB. Pick a smaller one.");
			return;
		}
		// Live-upload mode: hand the raw File to the caller; it owns the toast and
		// refreshing `value`. No data-URL read, no premature success toast.
		if (onUpload) {
			setBusy(true);
			try {
				await onUpload(file);
			} finally {
				setBusy(false);
			}
			return;
		}
		// Preview mode: read to a data URL.
		const reader = new FileReader();
		reader.onerror = () => toast.error("Couldn't read that image.");
		reader.onload = () => {
			if (typeof reader.result === "string") {
				if (controlled) {
					onChange?.(reader.result);
				} else {
					setPreview(reader.result);
				}
				toast.success("Image updated.");
			}
		};
		reader.readAsDataURL(file);
	}

	async function remove() {
		if (onRemove) {
			setBusy(true);
			try {
				await onRemove();
			} finally {
				setBusy(false);
			}
			return;
		}
		if (controlled) {
			onChange?.(null);
		} else {
			setPreview(null);
		}
	}

	return (
		<div className="flex items-center gap-4">
			{loading ? (
				<Skeleton
					className={cn("size-16", square ? "rounded-md" : "rounded-full")}
				/>
			) : (
				<Avatar
					className={cn("size-16", square && "rounded-md after:rounded-md")}
				>
					{current ? (
						<AvatarImage
							alt={label.replace(/^Upload\s+/i, "")}
							className={square ? "rounded-md" : undefined}
							src={current}
						/>
					) : null}
					<AvatarFallback className={square ? "rounded-md" : undefined}>
						{fallback || <Icon className="size-7" />}
					</AvatarFallback>
				</Avatar>
			)}
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Button
						aria-describedby={hintId}
						disabled={busy || loading}
						onClick={() => inputRef.current?.click()}
						size="sm"
						type="button"
						variant="outline"
					>
						{busy ? <Loader2 className="animate-spin" /> : null}
						{label}
					</Button>
					{current && !loading ? (
						<Button
							disabled={busy}
							onClick={remove}
							size="sm"
							type="button"
							variant="ghost"
						>
							Remove
						</Button>
					) : null}
				</div>
				<p className="text-muted-foreground text-xs" id={hintId}>
					{IMAGE_UPLOAD_HINT}
				</p>
				<input
					accept={IMAGE_UPLOAD_ACCEPT}
					aria-label={label}
					className="hidden"
					onChange={onSelect}
					ref={inputRef}
					type="file"
				/>
			</div>
		</div>
	);
}
