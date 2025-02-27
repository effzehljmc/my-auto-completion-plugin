import { MyAutoCompletionSettings, intoMyAutoCompletionPath } from "../settings";
import { DictionaryProvider } from "./dictionary_provider";
import { Vault } from "obsidian";
import { SuggestionBlacklist } from "./blacklist";

const WORD_LISTS_FOLDER_PATH = "wordLists";
const NEW_LINE_REGEX = /\r?\n/;

export class WordListSuggestionProvider extends DictionaryProvider {

    readonly wordMap: Map<string, string[]> = new Map<string, string[]>();

    isEnabled(settings: MyAutoCompletionSettings): boolean {
        return settings.wordListProviderEnabled;
    }

    async loadSuggestions(vault: Vault, settings: MyAutoCompletionSettings): Promise<void> {
        await this.loadFromFiles(vault, settings);
    }

    async loadFromFiles(vault: Vault, settings: MyAutoCompletionSettings): Promise<number> {
        this.wordMap.clear();

        const fileNames = await this.getRelativeFilePaths(vault);
        // Read all files
        for (let i = fileNames.length - 1; i >= 0; i--) {
            const fileName = fileNames[i];

            let data: string;
            try {
                data = await vault.adapter.read(fileName);
            } catch (e) {
                console.log("My Auto Completion: Unable to read " + fileName);
                continue;
            }

            // Each line is a word
            const lines = data.split(NEW_LINE_REGEX);
            for (const line of lines) {
                if (line === "" || line.length < settings.minWordLength)
                    continue;

                let list = this.wordMap.get(line.charAt(0));
                if (!list) {
                    list = [];
                    this.wordMap.set(line.charAt(0), list);
                }

                list.push(line.trim());
            }
        }

        let count = 0;
        // Sort by length
        for (const entry of this.wordMap.entries()) {
            const newValue = SuggestionBlacklist.filterText(entry[1].sort((a, b) => a.length - b.length));
            this.wordMap.set(entry[0], newValue);
            count += newValue.length;
        }

        return count;
    }

    async deleteWordList(vault: Vault, path: string) {
        await vault.adapter.remove(path);
    }

    async importWordList(vault: Vault, name: string, text: string): Promise<boolean> {
        const path = intoMyAutoCompletionPath(vault, WORD_LISTS_FOLDER_PATH, name);
        if (await vault.adapter.exists(path))
            return false;

        await vault.adapter.write(path, text);
        return true;
    }

    /**
     * Returns all files inside of {@link BASE_FOLDER_PATH}. The resulting strings are full paths, relative to the vault
     * root. <br>
     * @example
     * - .obsidian/plugins/my-auto-completion-plugin/wordLists/german.dic
     * - .obsidian/plugins/my-auto-completion-plugin/wordLists/long_words
     * - .obsidian/plugins/my-auto-completion-plugin/wordLists/special_words.txt
     * @param vault
     */
    async getRelativeFilePaths(vault: Vault): Promise<string[]> {
        const path = intoMyAutoCompletionPath(vault, WORD_LISTS_FOLDER_PATH);
        if (!(await vault.adapter.exists(path)))
            await vault.adapter.mkdir(path);

        return (await vault.adapter.list(path)).files;
    }
}

// Export a singleton instance
export const WordList = new WordListSuggestionProvider();
