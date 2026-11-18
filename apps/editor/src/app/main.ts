import { mount } from "svelte";
import App from "./App.svelte";
import Output from "./Output.svelte";
import "./theme.ts";

// ?view=output: the preview popped out into its own window; otherwise the editor
const view = new URLSearchParams(location.search).get("view");
mount(view === "output" ? Output : App, { target: document.getElementById("app")! });
