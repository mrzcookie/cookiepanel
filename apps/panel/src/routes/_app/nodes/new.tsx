import { createFileRoute } from "@tanstack/react-router";
import { ConnectNodeWizard } from "@/components/nodes/connect-node-wizard";

export const Route = createFileRoute("/_app/nodes/new")({
	component: ConnectNodeWizard,
});
