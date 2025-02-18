import { App, TFile } from 'obsidian';
import { MemoryService } from './memory_service';

export class FileNavigationService {
    constructor(
        private app: App,
        private memoryService: MemoryService
    ) {}

    async readFileContent(file: TFile): Promise<string> {
        try {
            return await this.app.vault.read(file);
        } catch (error) {
            console.error(`Error reading file ${file.path}:`, error);
            throw error;
        }
    }

    async searchFiles(query: string): Promise<TFile[]> {
        const files = this.app.vault.getMarkdownFiles();
        return files.filter(file => 
            file.path.toLowerCase().includes(query.toLowerCase()) ||
            file.basename.toLowerCase().includes(query.toLowerCase())
        );
    }

    async openFile(file: TFile): Promise<void> {
        try {
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(file);
            this.memoryService.updateArrayMemory('recentFiles', file.path);
        } catch (error) {
            console.error(`Error opening file ${file.path}:`, error);
            throw error;
        }
    }

    async createFile(path: string, content: string): Promise<TFile> {
        try {
            const file = await this.app.vault.create(path, content);
            this.memoryService.updateArrayMemory('recentFiles', file.path);
            return file;
        } catch (error) {
            console.error(`Error creating file ${path}:`, error);
            throw error;
        }
    }

    async modifyFile(file: TFile, content: string): Promise<void> {
        try {
            await this.app.vault.modify(file, content);
        } catch (error) {
            console.error(`Error modifying file ${file.path}:`, error);
            throw error;
        }
    }

    async deleteFile(file: TFile): Promise<void> {
        try {
            await this.app.vault.delete(file);
        } catch (error) {
            console.error(`Error deleting file ${file.path}:`, error);
            throw error;
        }
    }

    notifyFileOpen(file: TFile | null): void {
        if (file) {
            this.memoryService.updateArrayMemory('recentFiles', file.path);
        }
    }

    cleanup(): void {
        // No cleanup needed for this service
    }
} 