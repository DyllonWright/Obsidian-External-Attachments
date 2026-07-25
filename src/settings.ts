import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import { ALIGNMENTS, Alignment, mountStatus } from "./resolver";
import type ExternalAttachmentsPlugin from "./main";

export interface ExternalAttachmentsSettings {
	/** Ordered list of external folders; earlier entries win. */
	mounts: string[];
	/** Also search subfolders of each mount. */
	recursive: boolean;
	/** Outline embeds that resolved externally. */
	showIndicator: boolean;
	/** Where externally-resolved media sits in the note; a |right suffix on an
	 *  individual wikilink overrides it. */
	alignment: Alignment;
}

export const DEFAULT_SETTINGS: ExternalAttachmentsSettings = {
	mounts: [],
	recursive: false,
	showIndicator: true,
	alignment: "left"
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
			: [],
		alignment: (ALIGNMENTS as string[]).includes(data.alignment as string)
			? (data.alignment as Alignment)
			: DEFAULT_SETTINGS.alignment
	};
	return { settings, migrated };
}

const MOUNT_KEY = /^mounts\.(\d+)$/;

const INTRO =
	"When a wikilink embed fails to resolve inside this vault, the plugin searches " +
	"the folders below (top to bottom, first match wins) and renders the file from " +
	"there. This lets you offload heavy attachments to drives or extra cloud folders " +
	"outside the vault while embeds keep working.";

const MOUNT_PLACEHOLDER = "D:\\ObsidianAttachments  or  ~/CloudDrive/attachments";

const ALIGNMENT_DESC =
	"Where externally-resolved media sits in the note. Left matches how Obsidian " +
	"places ordinary attachments. Override any single embed by adding the word to " +
	"its wikilink: ![[photo.png|right]] or, with a size, ![[photo.png|400|right]].";

const RECURSIVE_DESC =
	"Also look inside subfolders of each external folder. The plugin builds a " +
	"filename index on first use; run “Rebuild external folder index” from the " +
	"command palette after adding files.";

const INDICATOR_DESC =
	"Draw a thin dashed outline around embeds that resolved from an external " +
	"folder, so they stand apart from in-vault attachments.";

export class ExternalAttachmentsSettingTab extends PluginSettingTab {
	plugin: ExternalAttachmentsPlugin;

	constructor(app: App, plugin: ExternalAttachmentsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Declarative settings, so the options show up in Obsidian's settings search
	 * (1.13.0 and later). `display()` below stays for earlier versions, which
	 * render nothing without it — this plugin's minAppVersion predates the
	 * declarative API by a wide margin.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const mounts = this.plugin.settings.mounts;
		return [
			{
				type: "list",
				heading: "External folders",
				emptyState:
					"No external folders yet. Add one and the plugin starts resolving " +
					"embeds that the vault can't find.",
				items: mounts.map((mount, i) => {
					const status = mount ? mountStatus(mount) : null;
					return {
						name: `External folder ${i + 1}`,
						desc: status
							? (status.ok ? status.detail : `⚠ ${status.detail}`)
							: "Absolute path to a folder outside the vault.",
						aliases: ["external", "folder", "path", "mount", "drive", "cloud"],
						control: {
							type: "text",
							key: `mounts.${i}`,
							placeholder: MOUNT_PLACEHOLDER
						}
					};
				}),
				addItem: {
					name: "Add external folder",
					action: () => {
						void this.addMount();
					}
				},
				onDelete: (index: number) => {
					void this.removeMount(index);
				}
			},
			{
				name: "Alignment",
				desc: ALIGNMENT_DESC,
				aliases: ["align", "left", "center", "right", "placement"],
				control: {
					type: "dropdown",
					key: "alignment",
					options: { left: "Left", center: "Center", right: "Right" }
				}
			},
			{
				name: "Search subfolders",
				desc: RECURSIVE_DESC,
				aliases: ["recursive", "nested", "index"],
				control: { type: "toggle", key: "recursive" }
			},
			{
				name: "Show visual indicator",
				desc: INDICATOR_DESC,
				aliases: ["outline", "dashed", "highlight"],
				control: { type: "toggle", key: "showIndicator" }
			}
		];
	}

	/** Folder paths live in an array, so their keys carry an index. */
	getControlValue(key: string): unknown {
		const indexed = MOUNT_KEY.exec(key);
		if (indexed) return this.plugin.settings.mounts[Number(indexed[1])] ?? "";
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		const indexed = MOUNT_KEY.exec(key);
		if (indexed) {
			settings.mounts[Number(indexed[1])] = String(value ?? "").trim();
		} else if (key === "alignment") {
			settings.alignment = (ALIGNMENTS as string[]).includes(String(value))
				? (String(value) as Alignment)
				: DEFAULT_SETTINGS.alignment;
		} else if (key === "recursive") {
			settings.recursive = Boolean(value);
		} else if (key === "showIndicator") {
			settings.showIndicator = Boolean(value);
		} else {
			return;
		}
		await this.plugin.saveSettings();
	}

	private async addMount(): Promise<void> {
		this.plugin.settings.mounts.push("");
		await this.plugin.saveSettings();
		this.display();
	}

	private async removeMount(index: number): Promise<void> {
		this.plugin.settings.mounts.splice(index, 1);
		await this.plugin.saveSettings();
		this.display();
	}

	/**
	 * Hand-rendered fallback for Obsidian before 1.13.0, which has no
	 * declarative settings API and would otherwise show an empty tab. Every
	 * label and description comes from the constants the definitions use, so
	 * the two paths can't drift apart.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("p", { text: INTRO, cls: "setting-item-description" });

		this.plugin.settings.mounts.forEach((mount, i) => {
			const status = mount ? mountStatus(mount) : null;
			const setting = new Setting(containerEl)
				.setName(`External folder ${i + 1}`)
				.addText((text) =>
					text
						.setPlaceholder(MOUNT_PLACEHOLDER)
						.setValue(mount)
						.onChange(async (value) => {
							await this.setControlValue(`mounts.${i}`, value);
						})
				)
				.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Remove this folder")
						.onClick(() => {
							void this.removeMount(i);
						})
				);
			setting.setDesc(
				status
					? (status.ok ? status.detail : `⚠ ${status.detail}`)
					: "Absolute path to a folder outside the vault."
			);
		});

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add external folder")
				.setCta()
				.onClick(() => {
					void this.addMount();
				})
		);

		new Setting(containerEl)
			.setName("Search subfolders")
			.setDesc(RECURSIVE_DESC)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.recursive).onChange(async (value) => {
					await this.setControlValue("recursive", value);
				})
			);

		new Setting(containerEl)
			.setName("Alignment")
			.setDesc(ALIGNMENT_DESC)
			.addDropdown((drop) =>
				drop
					.addOption("left", "Left")
					.addOption("center", "Center")
					.addOption("right", "Right")
					.setValue(this.plugin.settings.alignment)
					.onChange(async (value) => {
						await this.setControlValue("alignment", value);
					})
			);

		new Setting(containerEl)
			.setName("Show visual indicator")
			.setDesc(INDICATOR_DESC)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showIndicator).onChange(async (value) => {
					await this.setControlValue("showIndicator", value);
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
