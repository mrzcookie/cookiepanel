import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const THEMES = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeSwitcher({
	onChange,
}: {
	/** Fired after the theme is applied — e.g. to persist the choice to the
	 * account. Receives "light" | "dark" | "system". */
	onChange?: (theme: string) => void;
}) {
	const { setTheme, theme } = useTheme();
	const [mounted, setMounted] = useState(false);

	// The active theme is only known on the client, so defer the highlight until
	// after mount to avoid a hydration mismatch.
	useEffect(() => {
		setMounted(true);
	}, []);

	const active = mounted ? theme : undefined;

	function select(value: string) {
		setTheme(value);
		onChange?.(value);
	}

	return (
		<div className="inline-flex gap-1 rounded-lg border p-1">
			{THEMES.map((option) => (
				<Button
					aria-pressed={active === option.value}
					key={option.value}
					onClick={() => select(option.value)}
					size="sm"
					type="button"
					variant={active === option.value ? "secondary" : "ghost"}
				>
					<option.icon />
					{option.label}
				</Button>
			))}
		</div>
	);
}
