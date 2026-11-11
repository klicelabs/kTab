import { Icon, type IconName } from "@ktab/ui/icons/icon";
import { faviconUrl } from "../../../lib/url";
import { IconAppTile } from "../icon-app-tile";

/** The Home app-art pipeline, at list scale; no separate favicon system. */
export function SearchResultIcon({
	url,
	favicon,
	icon,
}: {
	url?: string;
	favicon?: string | null;
	icon: IconName;
}) {
	return url ? (
		<IconAppTile
			url={url}
			favicon={favicon || faviconUrl(url)}
			className="ktab-search-app-icon"
		/>
	) : (
		<span className="ktab-search-result-icon">
			<Icon name={icon} size={18} aria-hidden="true" />
		</span>
	);
}
