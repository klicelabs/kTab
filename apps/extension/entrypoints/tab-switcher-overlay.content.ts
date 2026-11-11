import { installTabSwitcherReceiver } from "../src/lib/tab-switcher";

export default defineContentScript({
	matches: ["http://*/*", "https://*/*"],
	runAt: "document_idle",
	main() {
		installTabSwitcherReceiver();
	},
});
