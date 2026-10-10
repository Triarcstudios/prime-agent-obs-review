import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initLogger } from "braintrust";

export default function (pi: ExtensionAPI) {
	if (!process.env.BRAINTRUST_API_KEY) return;
	const logger = initLogger({
		projectName: process.env.BRAINTRUST_PROJECT || "triarc-pi-gtm",
		asyncFlush: true,
		noExitFlush: true,
		onFlushError: () => console.error("Braintrust tracing FAIL"),
	});
	pi.on("turn_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		logger.log({
			metadata: { provider: ctx.model?.provider, model: ctx.model?.id, turn: event.turnIndex },
			metrics: {
				input_tokens: event.message.usage.input,
				output_tokens: event.message.usage.output,
				cost: event.message.usage.cost.total,
			},
		});
	});
	pi.on("session_shutdown", async () => {
		try {
			await logger.flush();
		} catch {
			console.error("Braintrust tracing FAIL");
		}
	});
}
