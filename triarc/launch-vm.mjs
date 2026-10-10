#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const env = { ...process.env, ...JSON.parse(readFileSync("/srv/pi/config/env.json", "utf8")), PRIME_AGENT_CODING_AGENT_DIR: "/srv/pi/config", PATH: `/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}` };
const child = spawn("/srv/pi/app/triarc/pi-local", process.argv.slice(2), { stdio: "inherit", env, cwd: "/srv/pi/work" });
child.on("error", () => { console.error("pi launch FAIL"); process.exit(1); });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
