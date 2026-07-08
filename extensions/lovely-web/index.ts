import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { registerLovelyWebCommand } from "./command.js"
import { applyToolConfig, loadScopedConfig } from "./config.js"
import { asErrorMessage } from "./format.js"
import { resetSmartRuntimeState, validateSmartConfig } from "./smart.js"
import { registerLovelyWebSearchTool, registerLovelyWebStaticTools } from "./tools.js"

export default function (pi: ExtensionAPI) {
	registerLovelyWebStaticTools(pi)
	pi.on("session_start", async (_event, ctx) => {
		try {
			resetSmartRuntimeState()
			const loaded = loadScopedConfig(ctx.cwd, ctx)
			if (loaded.warnings.length > 0) ctx.ui.notify(loaded.warnings.map(w => `${w.path}: ${w.message}`).join("\n"), "warning")
			const config = validateSmartConfig(loaded.value, ctx) ? loaded.value : { ...loaded.value, smartSearchEnabled: false }
			registerLovelyWebSearchTool(pi, config)
			registerLovelyWebStaticTools(pi, config)
			applyToolConfig(pi, config)
		} catch (error) {
			ctx.ui.notify(`Lovely Web config error: ${asErrorMessage(error)}`, "error")
		}
	})
	registerLovelyWebCommand(pi)
}
