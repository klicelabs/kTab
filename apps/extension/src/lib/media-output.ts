import type { MediaOutputResult } from "./media-session";

export interface SinkableMediaElement {
	setSinkId?: (deviceId: string) => Promise<void>;
	sinkId?: string;
}

export interface AudioOutputDevice {
	deviceId: string;
	label: string;
}

export interface EnumeratableMediaDevices {
	enumerateDevices: () => Promise<
		Array<{ kind: string; deviceId: string; label: string }>
	>;
}

export type AudioOutputListResult =
	| { ok: true; devices: AudioOutputDevice[] }
	| { ok: false; reason: "unsupported" | "failed" };

/** Enumerate in the media tab's own origin so device IDs match its setSinkId scope. */
export async function listAudioOutputDevices(
	mediaDevices: EnumeratableMediaDevices | null,
): Promise<AudioOutputListResult> {
	if (!mediaDevices || typeof mediaDevices.enumerateDevices !== "function") {
		return { ok: false, reason: "unsupported" };
	}
	try {
		const devices = (await mediaDevices.enumerateDevices())
			.filter((device) => device.kind === "audiooutput")
			.map((device) => ({
				deviceId: device.deviceId,
				label: device.label.trim(),
			}));
		return { ok: true, devices };
	} catch {
		return { ok: false, reason: "failed" };
	}
}

/** Called only from the explicit audio-output selection message for one media tab. */
export async function setMediaOutputForElement(
	media: SinkableMediaElement | null,
	deviceId: string,
): Promise<MediaOutputResult> {
	if (!media) return { ok: false, reason: "no-media" };
	if (typeof media.setSinkId !== "function") {
		return { ok: false, reason: "unsupported" };
	}
	if (
		media.sinkId === deviceId ||
		(deviceId === "" && (!media.sinkId || media.sinkId === "default"))
	) {
		return { ok: true };
	}
	try {
		await media.setSinkId(deviceId);
		return { ok: true };
	} catch (error) {
		const name =
			typeof error === "object" &&
			error !== null &&
			"name" in error &&
			typeof error.name === "string"
				? error.name
				: "";
		return {
			ok: false,
			reason: name === "NotAllowedError" ? "blocked" : "failed",
		};
	}
}
