import { EditorPosition, EditorSuggestContext } from "obsidian";
import { MyAutoCompletionSettings } from "../settings";
import { maybeLowerCase } from "../editor_helpers";

export class Suggestion {
    displayName: string;
    replacement: string;
    overrideStart?: EditorPosition;
    overrideEnd?: EditorPosition;
    icon?: string;
    color?: string;
    preview?: string;

    constructor(displayName: string, replacement: string, overrideStart?: EditorPosition, overrideEnd?: EditorPosition, opts?: {
        icon?: string,
        color?: string,
        preview?: string,
    }) {
        this.displayName = displayName;
        this.replacement = replacement;
        this.overrideStart = overrideStart;
        this.overrideEnd = overrideEnd;
        this.icon = opts?.icon;
        this.color = opts?.color;
        this.preview = opts?.preview;
    }

    static fromString(suggestion: string, overrideStart?: EditorPosition): Suggestion {
        return new Suggestion(suggestion, suggestion, overrideStart);
    }

    getDisplayNameLowerCase(lowerCase: boolean): string {
        return maybeLowerCase(this.displayName, lowerCase);
    }

    derive(options: Partial<typeof this>) {
        const derived = new Suggestion(
            options.displayName ?? this.displayName,
            options.replacement ?? this.replacement,
            options.overrideStart ?? this.overrideStart,
            options.overrideEnd ?? this.overrideEnd,
            {
                icon: options.icon ?? this.icon,
                color: options.color ?? this.color,
                preview: options.preview ?? this.preview,
            }
        );

        return derived;
    }
}

export interface SuggestionContext extends EditorSuggestContext {
    separatorChar: string;
}

export interface SuggestionProvider {
    blocksAllOtherProviders?: boolean,

    getSuggestions(context: SuggestionContext, settings: MyAutoCompletionSettings): Suggestion[],
}
