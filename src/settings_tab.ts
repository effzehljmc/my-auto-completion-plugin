import { App, ButtonComponent, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import {isInstalled as isCalloutManagerInstalled} from "obsidian-callout-manager";
import MyAutoCompletionPlugin from "./main";
import { FileScanner } from "./provider/scanner_provider";
import { WordList } from "./provider/word_list_provider";
import { CalloutProviderSource, MyAutoCompletionSettings, WordInsertionMode } from "./settings";
import { TextDecoder } from "util";
import { detect } from "jschardet";

export default class MyAutoCompletionSettingsTab extends PluginSettingTab {

    private plugin: MyAutoCompletionPlugin;
    private isReloadingWords: boolean;

    constructor(app: App, plugin: MyAutoCompletionPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Word character regex")
            .setDesc("A regular expression which matches a character of a word. Used by during completion to find the word to the left of the cursor and used by the file scanner to find valid words.")
            .addText(text => text
                .setValue(this.plugin.getSettings().characterRegex)
                .onChange(async val => {
                    try {
                        //Check if regex is valid
                        new RegExp("[" + val + "]+").test("");
                        text.inputEl.removeClass("my-auto-completion-settings-error");
                        const settings = this.plugin.getSettings();
                        settings.characterRegex = val;
                        await this.plugin.saveSettings();
                    } catch (e) {
                        text.inputEl.addClass("my-auto-completion-settings-error");
                    }
                }));

        new Setting(containerEl)
            .setName("Auto focus")
            .setDesc("Whether the popup is automatically focused once it opens.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().autoFocus)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.autoFocus = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Auto trigger")
            .setDesc("Whether the popup opens automatically when typing.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().autoTrigger)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.autoTrigger = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Minimum word length")
            .setDesc("The minimum length a word has to be, to count as a valid suggestion. This value is used by the file" +
                " scanner and word list provider.")
            .addText(text => {
                text.inputEl.type = "number";
                text
                    .setValue(this.plugin.getSettings().minWordLength + "")
                    .onChange(async val => {
                        if (!val || val.length < 1)
                            return;

                        const settings = this.plugin.getSettings();
                        settings.minWordLength = parseInt(val);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Minimum word trigger length")
            .setDesc("The minimum length a word has to be, to trigger suggestions.")
            .addText(text => {
                text.inputEl.type = "number";
                text
                    .setValue(this.plugin.getSettings().minWordTriggerLength + "")
                    .onChange(async val => {
                        if (!val || val.length < 1)
                            return;

                        const settings = this.plugin.getSettings();
                        settings.minWordTriggerLength = parseInt(val);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Word insertion mode")
            .setDesc("The insertion mode that is used. Ignore-case would suggest 'Hello' if the typed text is 'hello', match-case would not. " +
                "Append would complete 'Hell' with 'Hello' while replace would complete it with 'hello' instead (if only 'hello' was a known word). Only used by the file scanner and word list provider.")
            .addDropdown(dropdown => dropdown
                .addOption(WordInsertionMode.IGNORE_CASE_REPLACE, WordInsertionMode.IGNORE_CASE_REPLACE)
                .addOption(WordInsertionMode.IGNORE_CASE_APPEND, WordInsertionMode.IGNORE_CASE_APPEND)
                .addOption(WordInsertionMode.MATCH_CASE_REPLACE, WordInsertionMode.MATCH_CASE_REPLACE)
                .setValue(this.plugin.getSettings().wordInsertionMode)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.wordInsertionMode = val as WordInsertionMode;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Ignore diacritics when filtering")
            .setDesc("When enabled, the query 'Hello' can suggest 'Hèllò', meaning diacritics will be ignored when filtering the suggestions. Only used by the file scanner and word list provider.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().ignoreDiacriticsWhenFiltering)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.ignoreDiacriticsWhenFiltering = val;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("Add space after completed word")
            .setDesc("When enabled, a space will be added after a word has been completed.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().insertSpaceAfterComplete)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.insertSpaceAfterComplete = val;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("Insert period after double space")
            .setDesc("When enabled, a period is added after a completed word if a space is added after an automatic space, via the option above.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().insertPeriodAfterSpaces)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.insertPeriodAfterSpaces = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Formatting Suggestions")
            .setHeading();

        this.createEnabledSetting(
            "formattingSuggestionsEnabled",
            "Enable AI-powered formatting suggestions while typing",
            containerEl
        );

        new Setting(containerEl)
            .setName("AI Settings")
            .setHeading();

        new Setting(containerEl)
            .setName("AI API Key")
            .setDesc("Your API key for AI services (required for formatting suggestions)")
            .addText(text => text
                .setPlaceholder("Enter your API key")
                .setValue(this.plugin.getSettings().aiApiKey)
                .onChange(async (value) => {
                    const settings = this.plugin.getSettings();
                    settings.aiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("AI Model")
            .setDesc("The AI model to use for suggestions")
            .addDropdown(dropdown => dropdown
                // GPT-4 Models
                .addOption("gpt-4-0125-preview", "GPT-4 Turbo (Latest)")
                .addOption("gpt-4-turbo-preview", "GPT-4 Turbo")
                .addOption("gpt-4-1106-preview", "GPT-4 Turbo (Legacy)")
                .addOption("gpt-4", "GPT-4")
                .addOption("gpt-4o", "GPT-4o")
                .addOption("gpt-4-0613", "GPT-4 (Legacy)")
                // GPT-3.5 Models
                .addOption("gpt-3.5-turbo-0125", "GPT-3.5 Turbo (Latest)")
                .addOption("gpt-3.5-turbo", "GPT-3.5 Turbo")
                .addOption("gpt-3.5-turbo-1106", "GPT-3.5 Turbo (Legacy)")
                .addOption("gpt-3.5-turbo-0613", "GPT-3.5 Turbo (Legacy)")
                // Remove o3-mini as it's not a valid OpenAI model
                .setValue(this.plugin.getSettings().aiModel)
                .onChange(async (value) => {
                    const settings = this.plugin.getSettings();
                    settings.aiModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("AI Temperature")
            .setDesc("Controls randomness in AI responses (0.0 - 1.0)")
            .addSlider(slider => slider
                .setLimits(0, 1, 0.1)
                .setValue(this.plugin.getSettings().aiTemperature)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    const settings = this.plugin.getSettings();
                    settings.aiTemperature = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Max Tokens")
            .setDesc("Maximum length of AI responses")
            .addText(text => {
                text.inputEl.type = "number";
                text
                    .setValue(String(this.plugin.getSettings().aiMaxTokens))
                    .onChange(async (value) => {
                        const settings = this.plugin.getSettings();
                        settings.aiMaxTokens = Number(value);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("File scanner provider")
            .setHeading()
            .addExtraButton(button => button
                .setIcon("search")
                .setTooltip("Immediately scan all .md files currently in your vault.")
                .onClick(() => {
                    new ConfirmationModal(this.plugin.app,
                        "Start scanning?",
                        "Depending on the size of your vault and computer, this may take a while.",
                        button => button
                            .setButtonText("Scan")
                            .setCta(),
                        async () => {
                            await FileScanner.scanFiles(this.plugin.getSettings(), this.plugin.app.vault.getMarkdownFiles());
                        },
                    ).open();
                }))
            .addExtraButton(button => button
                .setIcon("trash")
                .setTooltip("Delete all known words.")
                .onClick(async () => {
                    new ConfirmationModal(this.plugin.app,
                        "Delete all known words?",
                        "This will delete all words that have been scanned. No suggestions from this provider will show up anymore until new files are scanned.",
                        button => button
                            .setButtonText("Delete")
                            .setWarning(),
                        async () => {
                            await FileScanner.deleteAllWords(this.plugin.app.vault);
                        },
                    ).open();
                }));

        this.createEnabledSetting("fileScannerProviderEnabled", "Whether or not the file scanner provider is enabled.", containerEl);

        new Setting(containerEl)
            .setName("Scan active file")
            .setDesc("If this setting is enabled, the currently opened file will be scanned to find new words.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings().fileScannerScanCurrent)
                .onChange(async val => {
                    const settings = this.plugin.getSettings();
                    settings.fileScannerScanCurrent = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Word list provider")
            .setHeading();

        this.createEnabledSetting("wordListProviderEnabled", "Whether or not the word list provider is enabled", containerEl);

        const fileInput = createEl("input", {
            attr: {
                type: "file",
            }
        });

        fileInput.onchange = async () => {
            const files = fileInput.files;
            if (files.length < 1)
                return;

            let changed = false;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                try {
                    const buf = await file.arrayBuffer();
                    const encoding = detect(Buffer.from(buf.slice(0, 1024))).encoding;
                    const text = new TextDecoder(encoding).decode(buf);
                    const success = await WordList.importWordList(this.app.vault, file.name, text);
                    changed ||= success;

                    if (!success)
                        new Notice("Unable to import " + file.name + " because it already exists!");
                } catch (e) {
                    console.error(e);
                    new Notice("Error while importing " + file.name);
                }
            }

            // Only refresh if something was added
            if (!changed)
                return;

            await this.reloadWords();
            this.display();
        }

        new Setting(containerEl)
            .setName('Word list files')
            .setDesc('A list of files which contain words to be used as suggestions. Each word should be on its own line.')
            .addExtraButton(button => button
                .setIcon("switch")
                .setTooltip("Reload")
                .onClick(async () => {
                    await this.reloadWords();
                    //Refresh because loadFromFiles might have removed an invalid file
                    this.display();
                }))
            .addButton(button => {
                button.buttonEl.appendChild(fileInput);
                button
                    .setButtonText("+")
                    .setCta()
                    .onClick(() => fileInput.click());
            });

        const wordListDiv = containerEl.createDiv();
        WordList.getRelativeFilePaths(this.app.vault).then((names) => {
            for (const name of names) {
                new Setting(wordListDiv)
                    .setName(name)
                    .addExtraButton((button) => button
                        .setIcon("trash")
                        .setTooltip("Remove")
                        .onClick(async () => {
                            new ConfirmationModal(
                                this.app,
                                "Delete " + name + "?",
                                "The file will be removed and the words inside of it won't show up as suggestions anymore.",
                                button => button
                                    .setButtonText("Delete")
                                    .setWarning(),
                                async () => {
                                    await WordList.deleteWordList(this.app.vault, name);
                                    await this.reloadWords();
                                    this.display();
                                }).open();
                        })
                    ).settingEl.addClass("my-auto-completion-settings-list-item");
            }
        });

        new Setting(containerEl)
            .setName("Callout provider")
            .setHeading();

        this.createEnabledSetting("calloutProviderEnabled", "Whether or not the callout provider is enabled", containerEl);
        new Setting(containerEl)
            .setName("Source")
            .setDesc("Where callout suggestions come from.")
            .addDropdown(component => {
                component.addOption("Default", CalloutProviderSource.DEFAULT)
                    .setValue(CalloutProviderSource.DEFAULT) // Default option.
                    .onChange(async (value) => {
                        const settings = this.plugin.getSettings();
                        settings.calloutProviderSource = value as CalloutProviderSource;
                        await this.plugin.saveSettings();
                    });

                if (isCalloutManagerInstalled()) {
                    component.addOption("Callout Manager", CalloutProviderSource.CALLOUT_MANAGER);
                    if (this.plugin.getSettings().calloutProviderSource === CalloutProviderSource.CALLOUT_MANAGER) {
                        component.setValue(this.plugin.getSettings().calloutProviderSource);
                    }
                }
            })
    }

    private async reloadWords() {
        if (this.isReloadingWords)
            return;

        this.isReloadingWords = true;
        const count = await WordList.loadFromFiles(this.app.vault, this.plugin.getSettings());
        this.isReloadingWords = false;

        new Notice(`Loaded ${count} words`);
    }

    private createEnabledSetting(propertyName: keyof MyAutoCompletionSettings, desc: string, container: HTMLElement) {
        new Setting(container)
            .setName("Enabled")
            .setDesc(desc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.getSettings()[propertyName] as boolean)
                .onChange(async (val) => {
                    const settings = this.plugin.getSettings();
                    const updatedSettings = {
                        ...settings,
                        [propertyName]: val
                    };
                    Object.assign(settings, updatedSettings);
                    await this.plugin.saveSettings();
                }));
    }
}

class ConfirmationModal extends Modal {

    constructor(app: App, title: string, body: string, buttonCallback: (button: ButtonComponent) => void, clickCallback: () => Promise<void>) {
        super(app);
        this.titleEl.setText(title);
        this.contentEl.setText(body);
        new Setting(this.modalEl)
            .addButton(button => {
                buttonCallback(button);
                button.onClick(async () => {
                    await clickCallback();
                    this.close();
                })
            })
            .addButton(button => button
                .setButtonText("Cancel")
                .onClick(() => this.close())).settingEl.addClass("my-auto-completion-settings-no-border");
    }
}
