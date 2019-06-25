/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    Uri, Event, TextDocumentContentProvider, CancellationToken, workspace, OutputChannel, EventEmitter,
} from 'vscode';
import { Test } from './Test';
import { join, dirname, basename } from 'path';
import { PddlWorkspace } from '../../../common/src/PddlWorkspace';
import { FileInfo } from '../../../common/src/FileInfo';

/**
 * Content provider for the problem file generated from a template.
 */
export class GeneratedDocumentContentProvider implements TextDocumentContentProvider {

    private _onDidChange: EventEmitter<Uri> = new EventEmitter<Uri>();
    onDidChange?: Event<Uri> = this._onDidChange.event;
    private uriMap: Map<string, Test> = new Map<string, Test>();

    constructor(private outputWindow: OutputChannel, pddlWorkspace: PddlWorkspace) {
        pddlWorkspace.on(PddlWorkspace.UPDATED, (fileInfo: FileInfo) => {
            // if the URI corresponds one that was already rendered from template, fire event
            this.uriMap.forEach((testCase: Test, uri: string) => {
                if (testCase.getProblemUri().toString() === fileInfo.fileUri) {
                    this.changed(Uri.parse(uri));
                }
            });
        });
    }

    changed(uri: Uri): void {
        this._onDidChange.fire(uri);
    }

    mapUri(test: Test): Uri {
        let problemTemplatePath = test.getProblemUri().fsPath;
        let testIdx = test.getUri().fragment;

        let problemPath: string;

        let problemTemplateWithoutExtension = problemTemplatePath.replace('.pddl', '');

        if (test.getLabel()) {
            problemPath = join(problemTemplateWithoutExtension + ` (${test.getLabel()}).pddl`);
        }
        else {
            problemPath = problemTemplateWithoutExtension + ` (${testIdx}).pddl`;
        }

        let uri = Uri.file(problemPath).with({ scheme: 'tpddl' });

        this.uriMap.set(uri.toString(), test);

        return uri;
    }

    async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string> {
        let test = this.uriMap.get(uri.toString());
        if (token.isCancellationRequested) { return ""; }

        let problemDocument = await workspace.openTextDocument(test.getProblemUri());
        let documentText = problemDocument.getText();

        try {
            return await test.getPreProcessor().transform(documentText, dirname(test.getManifest().path), this.outputWindow);
        } catch (ex) {
            return `Problem file '${basename(uri.fsPath)}' failed to generate: ${ex.message}`;
        }
    }
}

