import { useId, useMemo } from "react";
import { cn } from "../../lib/utils";

interface SvgIconProps {
	svgXml: string | null;
	className?: string;
	alt?: string;
}

function prepareSvg(svgXml: string, prefix: string): string {
	const ids = new Map<string, string>();
	let xml = svgXml.replace(
		/(\s)id\s*=\s*(["'])([^"']+)\2/g,
		(_attribute, space, quote, id: string) => {
			const scoped = ids.get(id) ?? `${prefix}-${ids.size}`;
			ids.set(id, scoped);
			return `${space}id=${quote}${scoped}${quote}`;
		},
	);
	// SVG fragments resolve at document scope, including across portals and
	// hidden copies. Every reference must follow this rendered instance's IDs.
	xml = xml.replace(
		/url\(\s*(["']?)#([^'"\s)]+)\1\s*\)/g,
		(value, _quote, id: string) =>
			ids.has(id) ? `url(#${ids.get(id)})` : value,
	);
	xml = xml.replace(
		/(\s(?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/g,
		(value, attribute, quote, id: string) =>
			ids.has(id) ? `${attribute}${quote}#${ids.get(id)}${quote}` : value,
	);
	xml = xml.replace(
		/(\saria-(?:labelledby|describedby)\s*=\s*)(["'])([^"']+)\2/g,
		(_value, attribute, quote, list: string) =>
			`${attribute}${quote}${list
				.split(/\s+/)
				.map((id) => ids.get(id) ?? id)
				.join(" ")}${quote}`,
	);
	xml = xml.replace(
		/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
		(_block, opening, css: string, closing) => {
			const scoped = css.replace(/([^{}]+)\{/g, (_rule, selectors: string) => {
				let next = selectors;
				for (const [id, replacement] of ids) {
					const selector = id
						.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
						.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					next = next.replace(
						new RegExp(`#${selector}(?![\\w-])`, "g"),
						`#${replacement}`,
					);
				}
				return `${next}{`;
			});
			return `${opening}${scoped}${closing}`;
		},
	);
	return xml.replace(/<svg\b([^>]*)>/i, (_tag, attributes: string) => {
		const root = attributes.replace(
			/\s(?:width|height|fill|stroke|preserveAspectRatio)\s*=\s*(["'])[^"']*\1/gi,
			"",
		);
		return `<svg${root} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
	});
}

/** Inline brand art with an explicit viewport and instance-local SVG resources. */
export function SvgIcon({ svgXml, className, alt }: SvgIconProps) {
	const instanceId = useId();
	const prefix = `ktab-brand-${instanceId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
	const prepared = useMemo(
		() => (svgXml ? prepareSvg(svgXml, prefix) : null),
		[svgXml, prefix],
	);
	if (!prepared) return null;

	return (
		<span
			className={cn("inline-flex items-center justify-center", className)}
			role="img"
			aria-label={alt ?? ""}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: brand SVG stays inline to preserve its instance-scoped paint and clipping resources.
			dangerouslySetInnerHTML={{ __html: prepared }}
		/>
	);
}
