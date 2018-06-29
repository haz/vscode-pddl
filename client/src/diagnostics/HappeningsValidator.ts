/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    window, commands, OutputChannel, ExtensionContext, TextDocument, Diagnostic, Uri, DiagnosticSeverity
} from 'vscode';

import * as process from 'child_process';

import { PddlWorkspace } from '../../../common/src/workspace-model';
import { DomainInfo, ProblemInfo } from '../../../common/src/parser';
import { PddlLanguage } from '../../../common/src/FileInfo';
import { HappeningsInfo, Happening, HappeningType } from "../../../common/src/HappeningsInfo";
import { PddlConfiguration, CONF_PDDL, VAL_STEP_PATH } from '../configuration';
import { Util } from '../../../common/src/util';
import { dirname } from 'path';
import { PlanStep } from '../../../common/src/PlanStep';
import { DomainAndProblem, isHappenings, getDomainAndProblemForHappenings } from '../utils';
import { createRangeFromLine, createDiagnostic } from './PlanValidator';

export const PDDL_HAPPENINGS_VALIDATE = 'pddl.happenings.validate';

/**
 * Delegate for parsing and validating Plan Happenings files.
 */
export class HappeningsValidator {

    constructor(private output: OutputChannel, public pddlWorkspace: PddlWorkspace, public plannerConfiguration: PddlConfiguration, context: ExtensionContext) {

        context.subscriptions.push(commands.registerCommand(PDDL_HAPPENINGS_VALIDATE,
            async () => {
                if (window.activeTextEditor && isHappenings(window.activeTextEditor.document)) {
                    if (!this.testConfiguration()) return;
                    try {
                        let outcome = await this.validateTextDocument(window.activeTextEditor.document);
                        if (outcome.getError()) {
                            window.showErrorMessage(outcome.getError());
                        }
                    } catch (ex) {
                        window.showErrorMessage("Happenings validation failed: " + ex);
                        return;
                    }
                } else {
                    window.showErrorMessage("There is no happenings file open.");
                    return;
                }
            }));
    }

    testConfiguration(): boolean {
        let validatePath = this.plannerConfiguration.getValStepPath();
        if (validatePath.length == 0) {
            window.showErrorMessage(`Set the 'valstep' executable path to the '${CONF_PDDL}.${VAL_STEP_PATH}' setting.`);
            return false;
        }
        else {
            return true;
        }

        // if (this.valStepPath == null || this.valStepPath == "") {
        // suggest the user to update the settings
        // var showNever = true;
        // this.pddlConfiguration.suggestValStepConfiguration(showNever);
        // return;
        // }
    }

    async validateTextDocument(planDocument: TextDocument): Promise<HappeningsValidationOutcome> {

        let planFileInfo = <HappeningsInfo>this.pddlWorkspace.upsertAndParseFile(planDocument.uri.toString(), PddlLanguage.PLAN, planDocument.version, planDocument.getText());

        if (!planFileInfo) return HappeningsValidationOutcome.failed(null, new Error("Cannot open or parse plan file."));

        return this.validateAndReportDiagnostics(planFileInfo, true, _ => { }, _ => { });
    }

    async validateAndReportDiagnostics(happeningsInfo: HappeningsInfo, showOutput: boolean, onSuccess: (diagnostics: Map<string, Diagnostic[]>) => void, onError: (error: string) => void): Promise<HappeningsValidationOutcome> {
        if (happeningsInfo.getParsingProblems().length > 0) {
            let diagnostics = happeningsInfo.getParsingProblems()
                .map(problem => new Diagnostic(createRangeFromLine(problem.lineIndex, problem.columnIndex), problem.problem));
            let outcome = HappeningsValidationOutcome.failedWithDiagnostics(happeningsInfo, diagnostics);
            onSuccess(outcome.getDiagnostics());
            return outcome;
        }

        let valStepPath = this.plannerConfiguration.getValStepPath();

        let context: DomainAndProblem = null;

        try {
            context = getDomainAndProblemForHappenings(happeningsInfo, this.pddlWorkspace);
        } catch (err) {
            let outcome = HappeningsValidationOutcome.failed(happeningsInfo, err);
            onSuccess(outcome.getDiagnostics());
            return outcome;
        }

        // are the actions in the plan declared in the domain?
        let actionNameDiagnostics = this.validateActionNames(context.domain, context.problem, happeningsInfo);
        if (actionNameDiagnostics.length) {
            let errorOutcome = HappeningsValidationOutcome.failedWithDiagnostics(happeningsInfo, actionNameDiagnostics);
            onSuccess(errorOutcome.getDiagnostics());
            return errorOutcome;
        }

        // are the actions start times monotonically increasing?
        let actionTimeDiagnostics = this.validateActionTimes(happeningsInfo);
        if (actionTimeDiagnostics.length) {
            let errorOutcome = HappeningsValidationOutcome.failedWithDiagnostics(happeningsInfo, actionTimeDiagnostics);
            onSuccess(errorOutcome.getDiagnostics());
            return errorOutcome;
        }

        // copy editor content to temp files to avoid using out-of-date content on disk
        let domainFilePath = Util.toPddlFile('domain', context.domain.getText());
        let problemFilePath = Util.toPddlFile('problem', context.problem.getText());
        let valSteps = new HappeningsToValStep(happeningsInfo).getExportedText();

        let args = [domainFilePath, problemFilePath];
        let child = process.spawnSync(valStepPath, args, { cwd: dirname(Uri.parse(happeningsInfo.fileUri).fsPath), input: valSteps });

        if (showOutput) this.output.appendLine(valStepPath + ' ' + args.join(' '));

        let output = child.stdout.toString();

        if (showOutput) this.output.appendLine(output);

        if (showOutput && child.stderr) {
            this.output.append('Error:');
            this.output.appendLine(child.stderr.toString());
        }

        let outcome = this.analyzeOutput(happeningsInfo, child.error, output);

        if (child.error) {
            if (showOutput) this.output.appendLine(`Error: name=${child.error.name}, message=${child.error.message}`);
            onError(child.error.name);
        }
        else {
            onSuccess(outcome.getDiagnostics());
        }

        if (showOutput) {
            this.output.appendLine(`Exit code: ${child.status}`);
            this.output.show();
        }

        return outcome;
    }

    analyzeOutput(happeningsInfo: HappeningsInfo, error: Error, output: string): HappeningsValidationOutcome {
        if (error) {
            return HappeningsValidationOutcome.failed(happeningsInfo, error);
        }

        if (output.match("Plan failed to execute") || output.match("Goal not satisfied")) {
            let failurePattern = /Checking next happening \(time (\d+.\d+)\)/g;
            var result: RegExpExecArray;
            var timeStamp = -1;
            while ((result = failurePattern.exec(output)) !== null) {
                timeStamp = parseFloat(result[1]);
            }

            let match = output.match(/Plan Repair Advice:([\s\S]+)Failed plans:/);
            if (match) {
                return HappeningsValidationOutcome.failedAtTime(happeningsInfo, timeStamp, match[1].trim().split('\n'));
            } else {
                return HappeningsValidationOutcome.failedAtTime(happeningsInfo, timeStamp, ["Unidentified error. Run the 'PDDL: Validate plan' command for more info."]);
            }
        }

        if (output.match("Bad plan description!")) {
            return HappeningsValidationOutcome.invalidPlanDescription(happeningsInfo);
        } else if (output.match("Plan valid")) {
            return HappeningsValidationOutcome.valid(happeningsInfo);
        }

        return HappeningsValidationOutcome.valid(happeningsInfo);
    }

    /**
     * Validate that plan steps match domain actions
     * @param domain domain file
     * @param problem problem file
     * @param happeningsInfo happeningsInfo
     */
    validateActionNames(domain: DomainInfo, problem: ProblemInfo, happeningsInfo: HappeningsInfo): Diagnostic[] {
        return happeningsInfo.getHappenings()
            .filter(happening => !this.isDomainAction(domain, problem, happening))
            .map(happening => new Diagnostic(createRangeFromLine(happening.lineIndex), `Action '${happening.getAction()}' not known by the domain ${domain.name}`, DiagnosticSeverity.Error));
    }

    /**
     * Validate that plan step times are monotonically increasing
     * @param domain domain file
     * @param problem problem file
     * @param happeningsInfo happeningsInfo
     */
    validateActionTimes(happeningsInfo: HappeningsInfo): Diagnostic[] {
        return happeningsInfo.getHappenings()
            .slice(1)
            .filter((happening: Happening, index: number) => !this.isTimeMonotonociallyIncreasing(happeningsInfo.getHappenings()[index], happening))
            .map(happening => new Diagnostic(createRangeFromLine(happening.lineIndex), `Action '${happening.getAction()}' time ${happening.getTime()} is before the preceding action time`, DiagnosticSeverity.Error));
    }

    private isDomainAction(domain: DomainInfo, problem: ProblemInfo, happening: Happening): boolean {
        problem;
        return domain.actions.some(a => a.name.toLowerCase() == happening.getAction().toLowerCase());
    }

    private isTimeMonotonociallyIncreasing(first: Happening, second: Happening): boolean {
        return first.getTime() <= second.getTime();
    }
}

class HappeningsValidationOutcome {
    constructor(public happeningsInfo: HappeningsInfo, private diagnostics: Diagnostic[], public error: string = null) {

    }

    getError(): string {
        return this.error;
    }

    getDiagnostics(): Map<string, Diagnostic[]> {
        let diagnostics = new Map<string, Diagnostic[]>();
        diagnostics.set(this.happeningsInfo.fileUri, this.diagnostics);
        return diagnostics;
    }

    static goalNotAttained(happeningsInfo: HappeningsInfo): HappeningsValidationOutcome {
        let errorLine = happeningsInfo.getHappenings().length > 0 ? happeningsInfo.getHappenings().slice(-1).pop().lineIndex + 1 : 0;
        let error = "Plan does not reach the goal.";
        let diagnostics = [createDiagnostic(errorLine, 0, error, DiagnosticSeverity.Warning)];
        return new HappeningsValidationOutcome(happeningsInfo, diagnostics, error);
    }

    /**
     * Creates validation outcomes for invalid plan i.e. plans that do not parse or do not correspond to the domain/problem file.
     */
    static invalidPlanDescription(happeningsInfo: HappeningsInfo): HappeningsValidationOutcome {
        let error = "Invalid plan description.";
        let diagnostics = [createDiagnostic(0, 0, error, DiagnosticSeverity.Error)];
        return new HappeningsValidationOutcome(happeningsInfo, diagnostics, error);
    }

    /**
     * Creates validation outcomes for valid plan, which does not reach the goal.
     */
    static valid(happeningsInfo: HappeningsInfo): HappeningsValidationOutcome {
        return new HappeningsValidationOutcome(happeningsInfo, [], undefined);
    }

    static failed(happeningsInfo: HappeningsInfo, error: Error): HappeningsValidationOutcome {
        let message = "Validate tool failed. " + error.message;
        let diagnostics = [createDiagnostic(0, 0, message, DiagnosticSeverity.Error)];
        return new HappeningsValidationOutcome(happeningsInfo, diagnostics, message);
    }

    static failedWithDiagnostics(happeningsInfo: HappeningsInfo, diagnostics: Diagnostic[]): HappeningsValidationOutcome {
        return new HappeningsValidationOutcome(happeningsInfo, diagnostics);
    }

    static failedAtTime(happeningsInfo: HappeningsInfo, timeStamp: number, repairHints: string[]): HappeningsValidationOutcome {
        let errorLine = 0;
        let stepAtTimeStamp =
            happeningsInfo.getHappenings()
                .find(happening => PlanStep.equalsWithin(happening.getTime(), timeStamp, 1e-4));

        if (stepAtTimeStamp) errorLine = stepAtTimeStamp.lineIndex;

        let diagnostics = repairHints.map(hint => new Diagnostic(createRangeFromLine(errorLine), hint, DiagnosticSeverity.Warning));
        return new HappeningsValidationOutcome(happeningsInfo, diagnostics);
    }

    static unknown(happeningsInfo: HappeningsInfo): HappeningsValidationOutcome {
        let diagnostics = [new Diagnostic(createRangeFromLine(0), "Unknown error.", DiagnosticSeverity.Warning)];
        return new HappeningsValidationOutcome(happeningsInfo, diagnostics, "Unknown error.");
    }
}

class HappeningsToValStep {
    durativeActionCounter = 0;
    durativeActionIndex = new Map<string, Number>();
    valStepText: string[] = [];
    makespan = -1;

    constructor(happenings: HappeningsInfo) {
        happenings.getHappenings()
            .forEach(h => this.happeningToValStep(h));
        this.valStepText.push('x');
        this.valStepText.push('q');
    }

    getExportedText(): string {
        return this.valStepText.join('\n');
    }

    happeningToValStep(h: Happening): void {
        if (h.getTime() > this.makespan && this.makespan >= 0) {
            this.valStepText.push('x');
        }

        switch (h.getType()) {
            case HappeningType.START:
            case HappeningType.INSTANTANEOUS:
                this.durativeActionCounter += 1;
                this.durativeActionIndex.set(this.toOrderedActionName(h), this.durativeActionCounter);
                // ? start key_make_up_wellhead_running_tool casingrun1_sec1_well1 sec1_well1 @ 0
                this.valStepText.push(`start ${h.getFullActionName()} @ ${h.getTime()}`);
                break;

            case HappeningType.END:
                let index = this.durativeActionIndex.get(this.toOrderedActionName(h));
                // ? end 3 @ 4.001
                this.valStepText.push(`end ${index} @ ${h.getTime()}`);
                break;

            default:
                this.valStepText.push('; error exporting: ' + h.toString());
                break;
        }

        // update the plan makespan 
        this.makespan = h.getTime();
    }

    toOrderedActionName(h: Happening): string {
        return h.getFullActionName() + '#' + h.getCounter();
    }
}