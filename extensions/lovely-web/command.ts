import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { ScopedConfigEditor } from "@xl0/pi-lovely-config"
import { applyToolConfig, loadScopedConfig } from "./config.js"
import { asErrorMessage } from "./format.js"
import { resetSmartConfigState, validateSmartConfig } from "./smart.js"
import { registerLovelyWebSearchTool, registerLovelyWebStaticTools } from "./tools.js"

export function registerLovelyWebCommand(pi: ExtensionAPI) {
	pi.registerCommand("lovely-web", {
		description: "Configure Lovely Web search, fetch, and image tools",
		async handler(_args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("The /lovely-web command is only available in interactive mode.", "warning")
				return
			}

			try {
				const config = loadScopedConfig(ctx.cwd)
				notifyConfigWarnings(ctx, config.warnings)

				await ctx.ui.custom<void>(
					(tui, theme, _keybindings, done) =>
						new ScopedConfigEditor({
							tui,
							theme,
							config,
							onChange(config) {
								resetSmartConfigState()
								const value = validateSmartConfig(config.value, ctx) ? config.value : { ...config.value, smartSearchEnabled: false }
								registerLovelyWebSearchTool(pi, value)
								registerLovelyWebStaticTools(pi, value)
								applyToolConfig(pi, value)
							},
							done
						})
				)
			} catch (error) {
				ctx.ui.notify(asErrorMessage(error), "error")
			}
		}
	})
}

function notifyConfigWarnings(ctx: ExtensionCommandContext, warnings: ReturnType<typeof loadScopedConfig>["warnings"]): void {
	if (warnings.length === 0) return
	ctx.ui.notify(warnings.map(warning => `${warning.path}: ${warning.message}`).join("\n"), "warning")
}
