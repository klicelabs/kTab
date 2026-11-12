import { useEffect, useRef } from "react";
import type { WeatherAtmosphereKind } from "../../../lib/weather-conditions";
import {
	describeWeatherCondition,
	weatherLocationKey,
} from "../../../lib/weather-conditions";
import { useSetupStore } from "../../../stores/setup-store";
import { useWeatherRuntimeStore } from "../../../stores/weather-runtime-store";
import { useWeatherMotionAllowed } from "./weather-actions";

interface Particle {
	x: number;
	y: number;
	speed: number;
	drift: number;
	size: number;
	alpha: number;
}

function createParticles(
	kind: WeatherAtmosphereKind,
	width: number,
	height: number,
): Particle[] {
	if (kind === "mist") return [];
	const divisor = kind === "rain" ? 30 : 38;
	const count = Math.max(24, Math.min(72, Math.ceil(width / divisor)));
	return Array.from({ length: count }, () => ({
		x: Math.random() * width,
		y: Math.random() * height,
		speed:
			kind === "rain" ? 1.5 + Math.random() * 2.5 : 0.45 + Math.random() * 1.1,
		drift:
			kind === "rain" ? 0.4 + Math.random() * 0.8 : -0.35 + Math.random() * 0.7,
		size: kind === "rain" ? 9 + Math.random() * 11 : 1 + Math.random() * 2.2,
		alpha:
			kind === "rain"
				? 0.08 + Math.random() * 0.08
				: 0.2 + Math.random() * 0.28,
	}));
}

function WeatherAtmosphereCanvas({ kind }: { kind: WeatherAtmosphereKind }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d", {
			alpha: true,
			desynchronized: true,
		});
		if (!context) return;
		const drawableCanvas: HTMLCanvasElement = canvas;
		const drawingContext: CanvasRenderingContext2D = context;

		let width = 0;
		let height = 0;
		let particles: Particle[] = [];
		let frame = 0;
		let lastPaint = 0;
		let pixelRatio = 1;

		function resize() {
			const bounds = drawableCanvas.parentElement?.getBoundingClientRect();
			width = Math.max(1, Math.round(bounds?.width ?? window.innerWidth));
			height = Math.max(1, Math.round(bounds?.height ?? window.innerHeight));
			pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
			drawableCanvas.width = Math.round(width * pixelRatio);
			drawableCanvas.height = Math.round(height * pixelRatio);
			drawingContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
			particles = createParticles(kind, width, height);
		}

		function drawMist(time: number) {
			const shift = Math.sin(time / 6_000) * width * 0.06;
			for (const [index, offset] of [0.2, 0.48, 0.72].entries()) {
				const y = height * offset;
				const gradient = drawingContext.createLinearGradient(
					shift - width * 0.2,
					y,
					shift + width * 0.9,
					y + height * 0.1,
				);
				gradient.addColorStop(0, "rgba(255,255,255,0)");
				gradient.addColorStop(
					0.42,
					`rgba(255,255,255,${0.035 + index * 0.008})`,
				);
				gradient.addColorStop(1, "rgba(255,255,255,0)");
				drawingContext.fillStyle = gradient;
				drawingContext.fillRect(0, y - 24, width, Math.max(72, height * 0.12));
			}
		}

		function draw(time: number) {
			if (document.hidden) {
				frame = 0;
				return;
			}
			frame = window.requestAnimationFrame(draw);
			if (time - lastPaint < 42) return;
			lastPaint = time;
			drawingContext.clearRect(0, 0, width, height);

			if (kind === "mist") {
				drawMist(time);
				return;
			}

			for (const particle of particles) {
				if (kind === "rain") {
					drawingContext.beginPath();
					drawingContext.moveTo(particle.x, particle.y);
					drawingContext.lineTo(particle.x + 2, particle.y + particle.size);
					drawingContext.strokeStyle = `rgba(255,255,255,${particle.alpha})`;
					drawingContext.lineWidth = 1;
					drawingContext.stroke();
					particle.y += particle.speed;
					particle.x += particle.drift;
					if (particle.y > height + 20) {
						particle.y = -particle.size;
						particle.x = Math.random() * width;
					}
				} else {
					drawingContext.beginPath();
					drawingContext.arc(
						particle.x,
						particle.y,
						particle.size,
						0,
						Math.PI * 2,
					);
					drawingContext.fillStyle = `rgba(255,255,255,${particle.alpha})`;
					drawingContext.fill();
					particle.y += particle.speed;
					particle.x +=
						particle.drift + Math.sin(time / 1300 + particle.y) * 0.25;
					if (particle.y > height + 4) {
						particle.y = -4;
						particle.x = Math.random() * width;
					}
					if (particle.x < -4) particle.x = width + 4;
					if (particle.x > width + 4) particle.x = -4;
				}
			}
		}

		function start() {
			if (frame === 0 && !document.hidden) {
				frame = window.requestAnimationFrame(draw);
			}
		}

		function handleVisibilityChange() {
			if (document.hidden) {
				if (frame !== 0) window.cancelAnimationFrame(frame);
				frame = 0;
				drawingContext.clearRect(0, 0, width, height);
			} else {
				start();
			}
		}

		resize();
		start();
		window.addEventListener("resize", resize, { passive: true });
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			if (frame !== 0) window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", resize);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			drawingContext.clearRect(0, 0, width, height);
		};
	}, [kind]);

	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 z-0"
		>
			<canvas
				ref={canvasRef}
				className="block h-full w-full"
				data-weather-atmosphere={kind}
			/>
		</div>
	);
}

export function WeatherAtmosphereOverlay() {
	const weather = useSetupStore((state) => state.settings.weather);
	const locationKey = weatherLocationKey(weather.latitude, weather.longitude);
	const reading = useWeatherRuntimeStore((state) =>
		state.locationKey === locationKey ? state.reading : null,
	);
	const paused = useWeatherRuntimeStore((state) => state.atmospherePaused);
	const motionAllowed = useWeatherMotionAllowed();

	if (
		!weather.enabled ||
		!weather.dynamicAtmosphere ||
		paused ||
		!motionAllowed ||
		!reading
	) {
		return null;
	}

	const condition = describeWeatherCondition(
		reading.weatherCode,
		reading.isDay,
		typeof navigator !== "undefined" ? navigator.language : "en",
	);
	return condition.atmosphere ? (
		<WeatherAtmosphereCanvas kind={condition.atmosphere} />
	) : null;
}
