import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const THEMES = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeSwitcher() {
	const { setTheme, theme } = useTheme();
	const [mounted, setMounted] = useState(false);

	// The active theme is only known on the client, so defer the highlight until
	// after mount to avoid a hydration mismatch.
	useEffect(() => {
		setMounted(true);
	}, []);

	const active = mounted ? theme : undefined;

	return (
		<div className="inline-flex gap-1 rounded-lg border p-1">
			{THEMES.map((option) => (
				<Button
					aria-pressed={active === option.value}
					key={option.value}
					onClick={() => setTheme(option.value)}
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
