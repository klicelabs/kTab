import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("Pexels engine coordinates contexts, consumes cached batches, and preserves prior photo on failures", {
	timeout: 30_000,
}, async () => {
	const child = Bun.spawn(
		[process.execPath, "run", "./scripts/fixtures/pexels-engine-scenario.ts"],
		{
			cwd: fileURLToPath(new URL("../", import.meta.url)),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({
		exitCode: 0,
		output: "",
	});
});

test("resetAll clears Pexels cache and prevents an in-flight image from restoring it", {
	timeout: 30_000,
}, async () => {
	const child = Bun.spawn(
		[process.execPath, "run", "./scripts/fixtures/pexels-reset-scenario.ts"],
		{
			cwd: fileURLToPath(new URL("../", import.meta.url)),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({
		exitCode: 0,
		output: "",
	});
});

test("Pexels startup skips the old wallpaper and repeated searches retry", async () => {
	const child = Bun.spawn(
		[process.execPath, "run", "./scripts/fixtures/pexels-startup-scenario.tsx"],
		{
			cwd: fileURLToPath(new URL("../", import.meta.url)),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({
		exitCode: 0,
		output: "",
	});
});
