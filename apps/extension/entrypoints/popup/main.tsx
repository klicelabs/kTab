import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "@klice-start/ui/globals.css";
import "../../src/styles/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing popup root");

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
