import { mount } from "svelte";
import App from "./App.svelte";
import "./theme.ts";

mount(App, { target: document.getElementById("app")! });
