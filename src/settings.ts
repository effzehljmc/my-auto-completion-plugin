import { Vault } from "obsidian";

export const enum WordInsertionMode {
    MATCH_CASE_REPLACE = "Match-Case & Replace",
    IGNORE_CASE_REPLACE = "Ignore-Case & Replace",
    IGNORE_CASE_APPEND = "Ignore-Case & Append"
}

export const enum CalloutProviderSource {
    DEFAULT = "Default",
    CALLOUT_MANAGER = "Callout Manager",
}

export interface MyAutoCompletionSettings {
    characterRegex: string,
    maxLookBackDistance: number,
    autoFocus: boolean,
    autoTrigger: boolean,
    minWordLength: number,
    minWordTriggerLength: number,
    wordInsertionMode: WordInsertionMode,
    ignoreDiacriticsWhenFiltering: boolean,
    insertSpaceAfterComplete: boolean,
    insertPeriodAfterSpaces: boolean,
    fileScannerProviderEnabled: boolean,
    fileScannerScanCurrent: boolean,
    wordListProviderEnabled: boolean,
    calloutProviderEnabled: boolean,
    calloutProviderSource: CalloutProviderSource,
}

export const DEFAULT_SETTINGS: MyAutoCompletionSettings = {
    characterRegex: "a-zA-ZöäüÖÄÜß",
    maxLookBackDistance: 50,
    autoFocus: true,
    autoTrigger: true,
    minWordLength: 2,
    minWordTriggerLength: 3,
    wordInsertionMode: WordInsertionMode.IGNORE_CASE_REPLACE,
    ignoreDiacriticsWhenFiltering: false,
    insertSpaceAfterComplete: false,
    insertPeriodAfterSpaces: false,
    fileScannerProviderEnabled: true,
    fileScannerScanCurrent: true,
    wordListProviderEnabled: true,
    calloutProviderEnabled: true,
    calloutProviderSource: CalloutProviderSource.DEFAULT,
}

export function intoMyAutoCompletionPath(vault: Vault, ...path: string[]): string {
    return vault.configDir + "/plugins/my-auto-completion-plugin/" + path.join("/");
}
