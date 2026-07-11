import { App, PluginSettingTab, Setting } from "obsidian";
import { mountStatus } from "./resolver";
import type ExternalAttachmentsPlugin from "./main";

export interface ExternalAttachmentsSettings {
	/** Ordered list of external folders; earlier entries win. */
	mounts: string[];
	/** Also search subfolders of each mount. */
	recursive: boolean;
	/** Outline embeds that resolved externally. */
	showIndicator: boolean;
}

export const DEFAULT_SETTINGS: ExternalAttachmentsSettings = {
	mounts: [],
	recursive: false,
	showIndicator: true
};

/**
 * Accept both current data.json shapes and the original single-path shape
 * ({ mountPath: string }), so existing installs upgrade in place.
 */
export function migrateSettings(raw: Record<string, unknown>): {
	settings: ExternalAttachmentsSettings;
	migrated: boolean;
} {
	let migrated = false;
	const data = { ...raw };
	if (typeof data.mountPath === "string" && !Array.isArray(data.mounts)) {
		data.mounts = data.mountPath ? [data.mountPath] : [];
		delete data.mountPath;
		migrated = true;
	}
	const settings: ExternalAttachmentsSettings = {
		...DEFAULT_SETTINGS,
		...data,
		mounts: Array.isArray(data.mounts)
			? (data.mounts as unknown[]).filter((m): m is string => typeof m === "string")
			: []
	};
	return { settings, migrated };
}

export class ExternalAttachmentsSettingTab extends PluginSettingTab {
	plugin: ExternalAttachmentsPlugin;

	constructor(app: App, plugin: ExternalAttachmentsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("p", {
			text:
				"When a wikilink embed fails to resolve inside this vault, the plugin searches " +
				"the folders below (top to bottom, first match wins) and renders the file from " +
				"there. This lets you offload heavy attachments to drives or extra cloud folders " +
				"outside the vault while embeds keep working.",
			cls: "setting-item-description"
		});

		this.plugin.settings.mounts.forEach((mount, i) => {
			const status = mount ? mountStatus(mount) : null;
			const setting = new Setting(containerEl)
				.setName(`External folder ${i + 1}`)
				.addText((text) =>
					text
						.setPlaceholder("D:\\ObsidianAttachments  or  ~/CloudDrive/attachments")
						.setValue(mount)
						.onChange(async (value) => {
							this.plugin.settings.mounts[i] = value.trim();
							await this.plugin.saveSettings();
						})
				)
				.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Remove this folder")
						.onClick(async () => {
							this.plugin.settings.mounts.splice(i, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);
			if (status) {
				setting.setDesc(status.ok ? status.detail : `⚠ ${status.detail}`);
			} else {
				setting.setDesc("Absolute path to a folder outside the vault.");
			}
		});

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add external folder")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.mounts.push("");
					await this.plugin.saveSettings();
					this.display();
				})
		);

		new Setting(containerEl)
			.setName("Search subfolders")
			.setDesc(
				"Also look inside subfolders of each external folder. The plugin builds a " +
					"filename index on first use; run “Rebuild external folder index” from the " +
					"command palette after adding files."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.recursive).onChange(async (value) => {
					this.plugin.settings.recursive = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Show visual indicator")
			.setDesc(
				"Draw a thin dashed outline around embeds that resolved from an external " +
					"folder, so they stand apart from in-vault attachments."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showIndicator).onChange(async (value) => {
					this.plugin.settings.showIndicator = value;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("p", {
			text:
				"Matching happens by filename only, so keep filenames unique across your " +
				"external folders. Files render read-only; the vault never copies them back in.",
			cls: "setting-item-description"
		});
	}
}
