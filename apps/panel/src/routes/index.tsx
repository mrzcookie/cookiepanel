import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="flex flex-1 items-center justify-center">
			<h1 className="font-semibold text-2xl">CookiePanel</h1>
		</main>
	);
}
