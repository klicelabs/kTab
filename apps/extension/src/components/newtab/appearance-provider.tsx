import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ACCENT_COLORS } from "../../lib/accent";
import {
	clampGlassIntensity,
	type GlassIntensityParams,
	glassCssVariables,
	glassIntensityParams,
} from "../../lib/glass";
import { useSetupStore } from "../../stores/setup-store";
import type {
	AccentColor,
	AppearanceMode,
	ColorScheme,
	CornerScale,
	MaterialMode,
} from "../../types";

export interface AppearanceContextValue {
	mode: AppearanceMode;
	/** Product material concept: Glass chrome vs Flat chrome. */
	material: MaterialMode;
	/** Legacy alias for `material === "glass"` (mirrors appearanceMode). */
	isLiquid: boolean;
	colorScheme: ColorScheme;
	accentColor: AccentColor;
	resolvedDark: boolean;
	/** prefers-contrast: more — forces dense veils + strong ink. */
	prefersContrastMore: boolean;
	/** Corner-scale preference; geometry consumers re-measure on change. */
	cornerScale: CornerScale;
}

export interface GlassAppearanceContextValue {
	/** Liquid Glass intensity 0 (Ultra Clear) … 100 (Fully Tinted). */
	glassIntensity: number;
	/** Optical recipe derived from glassIntensity (blur ≤12, refraction…). */
	glassParams: GlassIntensityParams;
}

const AppearanceContext = createContext<AppearanceContextValue>({
	mode: "liquid",
	material: "glass",
	isLiquid: true,
	colorScheme: "auto",
	accentColor: "blue",
	resolvedDark: true,
	prefersContrastMore: false,
	cornerScale: "soft",
});

const GlassAppearanceContext = createContext<GlassAppearanceContextValue>({
	glassIntensity: 60,
	glassParams: glassIntensityParams(60),
});

export function AppearanceProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const mode = useSetupStore((s) => s.settings.appearanceMode);
	const colorScheme = useSetupStore((s) => s.settings.colorScheme ?? "auto");
	const accentColor = useSetupStore((s) => s.settings.accentColor ?? "blue");
	const glassIntensity = useSetupStore((s) =>
		clampGlassIntensity(s.settings.glassIntensity),
	);
	const cornerScale = useSetupStore((s) => s.settings.cornerScale ?? "soft");

	const [systemDark, setSystemDark] = useState<boolean>(() => {
		if (typeof window === "undefined") return true;
		return window.matchMedia("(prefers-color-scheme: dark)").matches;
	});
	const [prefersContrastMore, setPrefersContrastMore] = useState<boolean>(
		() => {
			if (typeof window === "undefined") return false;
			return window.matchMedia("(prefers-contrast: more)").matches;
		},
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia("(prefers-contrast: more)");
		const handler = (e: MediaQueryListEvent) =>
			setPrefersContrastMore(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	const resolvedDark =
		colorScheme === "dark" || (colorScheme === "auto" && systemDark);
	const accent = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.blue;
	const material: MaterialMode = mode === "liquid" ? "glass" : "flat";
	const glassParams = useMemo(
		() => glassIntensityParams(glassIntensity, resolvedDark),
		[glassIntensity, resolvedDark],
	);

	useEffect(() => {
		if (typeof document === "undefined") return;
		if (resolvedDark) {
			document.documentElement.classList.add("dark");
			document.documentElement.classList.remove("light");
		} else {
			document.documentElement.classList.add("light");
			document.documentElement.classList.remove("dark");
		}
	}, [resolvedDark]);

	useEffect(() => {
		if (typeof document === "undefined") return;
		const root = document.documentElement;
		const value = resolvedDark ? accent.dark : accent.light;
		root.style.setProperty("--ktab-accent", value);
		root.style.setProperty("--ktab-accent-foreground", accent.foreground);
		root.style.setProperty("--ktab-accent-rgb", accent.rgb);
		// Text selection follows the accent so highlighted query text, menu
		// typeahead and field selections read as one system.
		root.style.setProperty("--selection", value);
		root.style.setProperty("--selection-foreground", accent.foreground);
		// Existing semantic surfaces use this established alias. Keep it mapped
		// to the new single accent source while migrating no decorative colors.
		root.style.setProperty("--apple-blue", value);
	}, [accent, resolvedDark]);

	useEffect(() => {
		if (typeof document === "undefined") return;
		const root = document.documentElement;
		// Top-level material contract: Flat mode must contain zero Glass and
		// Glass mode no forgotten Flat chrome. Styles that need the mode
		// (e.g. the toolbar disabled-ink gate) read this attribute.
		root.dataset.ktabMaterial = material;
		// High-contrast users get dense veils + strong ink (GlassSurface
		// upgrades `surface` to the dense `menu` tier; helpers already pick
		// the strong-ink branch off resolvedDark). Never a separate theme.
		root.dataset.ktabContrast = prefersContrastMore ? "more" : "less";
		// The corner scale drives tokens.css' --shape-* variables, so every
		// semantic shape role re-renders instantly (live settings preview).
		root.dataset.ktabCorner = cornerScale;
		// Continuous intensity and optical values keep CSS-driven surfaces and
		// inline SVG lens nodes on one recipe. This is the only runtime writer
		// for Glass material variables.
		root.style.setProperty(
			"--ktab-glass-intensity",
			String(glassIntensity / 100),
		);
		for (const [name, value] of Object.entries(
			glassCssVariables(glassParams),
		)) {
			root.style.setProperty(name, value);
		}
	}, [glassParams, glassIntensity, material, prefersContrastMore, cornerScale]);

	const value = useMemo(
		() => ({
			mode,
			material,
			isLiquid: mode === "liquid",
			colorScheme,
			accentColor,
			resolvedDark,
			prefersContrastMore,
			cornerScale,
		}),
		[
			mode,
			material,
			colorScheme,
			accentColor,
			resolvedDark,
			prefersContrastMore,
			cornerScale,
		],
	);
	const glassValue = useMemo(
		() => ({ glassIntensity, glassParams }),
		[glassIntensity, glassParams],
	);

	return (
		<AppearanceContext.Provider value={value}>
			<GlassAppearanceContext.Provider value={glassValue}>
				{children}
			</GlassAppearanceContext.Provider>
		</AppearanceContext.Provider>
	);
}

export function useAppearance(): AppearanceContextValue {
	return useContext(AppearanceContext);
}

export function useGlassAppearance(): GlassAppearanceContextValue {
	return useContext(GlassAppearanceContext);
}
