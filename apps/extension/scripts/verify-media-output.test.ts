import { expect, test } from "bun:test";
import {
	listAudioOutputDevices,
	setMediaOutputForElement,
} from "../src/lib/media-output";

test("routes output only to the active tab media element when requested", async () => {
	const calls: string[] = [];
	const activeTabMedia = {
		setSinkId: async (deviceId: string) => {
			calls.push(deviceId);
		},
	};

	expect(
		await setMediaOutputForElement(activeTabMedia, "speaker-device-id"),
	).toEqual({
		ok: true,
	});
	expect(calls).toEqual(["speaker-device-id"]);
});

test("reports blocked and unsupported per-tab output selection", async () => {
	const blocked = await setMediaOutputForElement(
		{
			setSinkId: async () => {
				throw { name: "NotAllowedError" };
			},
		},
		"speaker-device-id",
	);
	const unsupported = await setMediaOutputForElement({}, "speaker-device-id");

	expect(blocked).toEqual({ ok: false, reason: "blocked" });
	expect(unsupported).toEqual({ ok: false, reason: "unsupported" });
});

test("enumerates only audio outputs from the media tab origin", async () => {
	const result = await listAudioOutputDevices({
		enumerateDevices: async () => [
			{ kind: "audioinput", deviceId: "mic", label: "Microphone" },
			{ kind: "audiooutput", deviceId: "speaker", label: "Desk speakers" },
		],
	});

	expect(result).toEqual({
		ok: true,
		devices: [{ deviceId: "speaker", label: "Desk speakers" }],
	});
});

test("does not call setSinkId again when that tab already uses the selected device", async () => {
	let calls = 0;
	const result = await setMediaOutputForElement(
		{
			sinkId: "speaker",
			setSinkId: async () => {
				calls += 1;
			},
		},
		"speaker",
	);

	expect(result).toEqual({ ok: true });
	expect(calls).toBe(0);
});

test("does not call a device route when the active tab has no media element", async () => {
	expect(await setMediaOutputForElement(null, "speaker-device-id")).toEqual({
		ok: false,
		reason: "no-media",
	});
});
