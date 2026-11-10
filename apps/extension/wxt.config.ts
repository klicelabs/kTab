import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifestVersion: 3,
	dev: {
		server: {
			// The dev server URL is baked into .output/*-mv3-dev/*.html. If a second
			// instance silently fails over to another port (or the server dies), the
			// loaded extension keeps requesting scripts from a dead port and the
			// newtab/popup render as an empty dark screen. Fail fast instead.
			port: 5555,
			strictPort: true,
		},
	},
	manifest: {
		name: "Klice Start",
		// Firefox MV3 requires an explicit extension ID.
		browser_specific_settings: {
			gecko: {
				id: "{a1e9c3d2-5b74-4f08-9d26-3c8f70b41e55}",
				data_collection_permissions: { required: ["none"] },
			},
		},
		version: "1.3.5",
		default_locale: "en",
		description: "A personal browser dashboard for your new tab.",
		permissions: [
			"storage",
			"activeTab",
			"tabs",
			"contextMenus",
			"bookmarks",
			// Auto-capturing thumbnails for saved-but-thumbless bookmarks needs
			// to know when a relevant site finishes loading. The
			// webNavigation.onCompleted url filter wakes the worker for exactly
			// the http(s) top-frame loads that can match a card.
			"webNavigation",
		],
		// Install-time host permissions for the pages the dashboard reads
		// (webNavigation events, tab URLs). Capturing requires the literal
		// "<all_urls>" pattern (see src/lib/thumbnail-permission.ts), which is
		// declared optional and granted once through the Settings pane's
		// "Allow access" consent flow — keeping the install warning narrow.
		host_permissions: ["http://*/*", "https://*/*"],
		optional_host_permissions: ["<all_urls>"],
		commands: {
			"add-current-page": {
				// Ctrl+Shift+D is Chrome's native "Bookmark all tabs" — it used
				// to fire both actions. Alt+Shift+D is unclaimed in Chromium
				// and Firefox defaults.
				suggested_key: { default: "Alt+Shift+D", mac: "Command+Shift+D" },
				description: "Save current page to Klice Start",
			},
		},
	},
	zip: {
		// AMO sources zip must cover the whole workspace: bun.lock and the
		// workspace packages (@klice-start/ui, @klice-start/env, @klice-start/config) live at the
		// repo root, not in apps/extension.
		sourcesRoot: "../..",
		excludeSources: [
			"apps/web/**",
			"apps/fumadocs/**",
			"docs/**",
			"ruvector.db",
			// Agent working material, not build sources: knowledge-graph
			// output and captured session transcripts.
			"graphify-out/**",
			"pi-session-*.html",
			// Local legacy artifact, not part of the extension's source tree.
			"apps/_old-background.ts",
			// Local benchmark outputs and investigation captures can include old
			// release archives; they are not source code for the AMO submission.
			"apps/extension/scripts/results/**",
			"pexels-*.png",
		],
	},
	vite: () => ({
		resolve: {
			// Bun's isolated node_modules layout exposes react via multiple paths
			// (workspace junction + .bun store). Without dedupe, rolldown emits two
			// React instances and hooks crash with a null dispatcher
			// ("can't access property \"useEffect\", f.H is null").
			dedupe: ["react", "react-dom"],
		},
	}),
});
