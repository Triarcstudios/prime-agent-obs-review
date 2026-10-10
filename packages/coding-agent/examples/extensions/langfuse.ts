/**
 * Opt-in, content-free Langfuse tracing using OTLP/HTTP JSON (no SDK dependency).
 * Load with --extension or copy into the agent extensions directory.
 * Set PI_LANGFUSE_ENABLED=1, LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY,
 * and LANGFUSE_SECRET_KEY. Credentials stay in the environment.
 * Alternatively set PI_OTEL_TRACE_ENDPOINT and PI_OTEL_AUTHORIZATION for a collector.
 * The host must resolve from the agent runtime (including remote workers).
 * One root span is awaited per run; prompt and response bodies are not exported.
 */
import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function langfuse(pi: ExtensionAPI) {
	if (process.env.PI_LANGFUSE_ENABLED !== "1") return;
	const host = process.env.LANGFUSE_HOST;
	const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
	const secretKey = process.env.LANGFUSE_SECRET_KEY;
	const endpoint =
		process.env.PI_OTEL_TRACE_ENDPOINT || (host ? `${host.replace(/\/$/, "")}/api/public/otel/v1/traces` : undefined);
	const authorization =
		process.env.PI_OTEL_AUTHORIZATION ||
		(publicKey && secretKey ? `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}` : undefined);
	if (!endpoint || !authorization) {
		console.error("Langfuse tracing FAIL: missing configuration");
		return;
	}
	let run: { traceId: string; spanId: string; startTimeUnixNano: string } | undefined;
	pi.on("agent_start", () => {
		run = {
			traceId: randomBytes(16).toString("hex"),
			spanId: randomBytes(8).toString("hex"),
			startTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
		};
	});
	pi.on("agent_end", async (_event, ctx) => {
		const completed = run;
		run = undefined;
		if (!completed) return;
		const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [attribute("service.name", "prime-agent")] },
					scopeSpans: [
						{
							scope: { name: "prime-agent.langfuse" },
							spans: [
								{
									...completed,
									name: "pi.agent",
									kind: 1,
									endTimeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
									attributes: [
										attribute("langfuse.observation.type", "agent"),
										attribute("langfuse.session.id", ctx.sessionManager.getSessionId()),
										attribute("gen_ai.request.model", ctx.model?.id ?? "unknown"),
									],
								},
							],
						},
					],
				},
			],
		};
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { authorization, "content-type": "application/json", "x-langfuse-ingestion-version": "4" },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(5000),
			});
			await response.body?.cancel();
			if (!response.ok) console.error(`Langfuse tracing FAIL: HTTP ${response.status}`);
		} catch {
			console.error("Langfuse tracing FAIL: export unavailable");
		}
	});
}
