# Change Log

All notable changes to the "pddl" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

Further plan visualization improvements.

Find all references support for _type_.

Auto-completion for constant/object names.

## [2.0.3] - 2017-12-01

Fixed the 'there is no corresponding domain/problem open in the editor' as well as stale PDDL file content while launching the planner.

Planner executable working directory is set to the folder in which the domain and problem files are located.

Entered planner or parser executable/service location is trimmed for whitespace.

## [2.0.2] - 2017-11-23

Plan visualization that features color-coding of actions and swim-lanes for objects per types.

All commands this extension contributes were renamed to start with the 'PDDL:' prefix. That makes them easy to find when pressing _Ctrl + Shift + P_ and is also more consistent with other extensions.

Improved the snippets - they now use 4 character indentation uniformly, which makes it easier to keep the formatting while editing them further.

The `assign` numeric effect was missing in the auto-completion options and was now added.

Clean-up in the code. The .css and .js files needed by the HTML plan preview are now served as static resources from the disk (in the extension installation).

Added Mocha-based unit tests to test the classes in the `common` module.

PDDL parser was extended to pick up the constants and objects from domain/problem file. Those are used in the plan visualization, but not yet in the editor auto-completion for example.

## [2.0.1] - 2017-11-16

New command added to _Configure PDDL Planner_. Added configuration to override the planner command-line syntax.
Added support for solver.planning.domains/solve web service.
Supporting non-auto-saving editor mode by creating temp files for domain/problem when launching the planner.
Fixed an issue with some domains where the extension was hanging (while regexp parsing the types).

## [2.0.0] - 2017-11-10

PDDL Language Server now provides rich PDDL syntax validation, hover info, Go to Definition, Find All References, Jump to symbol, Auto-completion, configuration of custom PDDL parser, planner execution and plan visualization.

## [1.0.2] - 2017-10-16

Simplified snippets and added tabstops/placeholders to them, so they are easy to fill in with content.

## [1.0.1] - 2017-10-06

### Added

- missing PDDL requirements in syntax highlighting: `strips, typing, negative-preconditions, disjunctive-preconditions, equality, existential-preconditions, universal-preconditions, quantified-preconditions, conditional-effects, fluents, numeric-fluents, adl, durative-actions, duration-inequalities, continuous-effects, derived-predicates, timed-initial-literals, preferences, constraints, action-costs, timed-initial-fluents`

### Changed

- fixed parameters to action snippets
- banner color

## 1.0.0 - 2017-04-15

### Added

- Initial release
- PDDL Snippets for `domain`, `problem`, `action` and `durative-action`.
- Syntax highlighting for commonly used PDDL features

[Unreleased]: https://github.com/jan-dolejsi/vscode-pddl/compare/v2.0.3...HEAD
[2.0.3]:https://github.com/jan-dolejsi/vscode-pddl/compare/v2.0.2...v2.0.3
[2.0.2]:https://github.com/jan-dolejsi/vscode-pddl/compare/v2.0.1...v2.0.2
[2.0.1]:https://github.com/jan-dolejsi/vscode-pddl/compare/v2.0.0...v2.0.1
[2.0.0]:https://github.com/jan-dolejsi/vscode-pddl/compare/v1.0.2...v2.0.0
[1.0.2]:https://github.com/jan-dolejsi/vscode-pddl/compare/v1.0.1...v1.0.2
[1.0.1]:https://github.com/jan-dolejsi/vscode-pddl/compare/1.0.0...v1.0.1