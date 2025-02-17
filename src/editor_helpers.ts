import { Editor, EditorPosition } from "obsidian";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function posFromIndex(doc: Text, offset: number): EditorPosition {
    let line = doc.lineAt(offset)
    return { line: line.number - 1, ch: offset - line.from }
}

export function indexFromPos(doc: Text, pos: EditorPosition): number {
    const ch = pos.ch;
    const line = doc.line(pos.line + 1);
    return Math.min(line.from + Math.max(0, ch), line.to)
}

export function editorToCodeMirrorState(editor: Editor): EditorState {
    return (editor as any).cm.state;
}

export function editorToCodeMirrorView(editor: Editor): EditorView {
    return (editor as any).cm;
}

export function maybeLowerCase(str: string, lowerCase: boolean): string {
    return lowerCase ? str.toLowerCase() : str;
}

export function matchWordBackwards(
    editor: Editor,
    cursor: EditorPosition,
    charPredicate: (char: string) => boolean,
    maxLookBackDistance: number = 50
): { query: string, separatorChar: string } {
    let query = "", separatorChar = null;

    // Save some time for very long lines
    let lookBackEnd = Math.max(0, cursor.ch - maxLookBackDistance);
    // Find word in front of cursor
    for (let i = cursor.ch - 1; i >= lookBackEnd; i--) {
        const prevChar = editor.getRange({ ...cursor, ch: i }, { ...cursor, ch: i + 1 });
        if (!charPredicate(prevChar)) {
            separatorChar = prevChar;
            break;
        }

        query = prevChar + query;
    }

    return { query, separatorChar };
}

export class BlockType {
    public static CODE_MULTI = new BlockType("```", true);
    public static CODE_SINGLE = new BlockType("`", false, BlockType.CODE_MULTI);

    static {
        BlockType.CODE_MULTI.otherType0 = BlockType.CODE_SINGLE;
    }

    public static SINGLE_TYPES = [BlockType.CODE_SINGLE];

    constructor(public readonly c: string, public readonly isMultiLine: boolean, private otherType0: BlockType = null) {
    }

    public get isCodeBlock(): boolean {
        return true;
    }

    public get otherType(): BlockType {
        return this.otherType0;
    }
}

function substringMatches(str: string, toMatch: string, from: number): boolean {
    const bound = from + toMatch.length - 1;
    for (let i = from; i < bound; i++) {
        if (str.charAt(i) !== toMatch.charAt(i - from))
            return false;
    }

    return true;
}
