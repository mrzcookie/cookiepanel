import type { LucideIcon } from "lucide-react";
import { type ChangeEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Single source of truth so avatars and org logos accept exactly the same
// formats and size. The most common raster formats; no SVG.
export const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
export const IMAGE_UPLOAD_HINT = "PNG, JPG, or WebP, up to 2 MB.";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function ImageUploadField({
	icon: Icon,
	label,
	shape,
	value,
	onChange,
}: {
	icon: LucideIcon;
	label: string;
	shape: "circle" | "square";
	/** Controlled image (data URL). Omit for an uncontrolled preview-only field. */
	value?: string | null;
	/** Called with the new data URL (or null when removed) in controlled mode. */
	onChange?: (dataUrl: string | null) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<string | null>(null);
	// Controlled when a value prop is passed; otherwise track an internal preview.
	const controlled = value !== undefined;
	const current = controlled ? value : preview;
	const square = shape === "square";
	const hintId = useId();

	function onSelect(event: ChangeEvent<HTMLInputElement>) {
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

	function remove() {
		if (controlled) {
			onChange?.(null);
		} else {
			setPreview(null);
		}
	}

	return (
		<div className="flex items-center gap-4">
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
					<Icon className="size-7" />
				</AvatarFallback>
			</Avatar>
			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Button
						aria-describedby={hintId}
						onClick={() => inputRef.current?.click()}
						size="sm"
						type="button"
						variant="outline"
					>
						{label}
					</Button>
					{current ? (
						<Button onClick={remove} size="sm" type="button" variant="ghost">
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
