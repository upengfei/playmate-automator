# Frame Recording And Keyword Expansion

## Problem Statement

PlayFlow Agent uses Playwright `codegen` to record a user's browser actions and converts those actions into a PlayFlow test case. Today the recorder accepts only main-document `page.*` statements. Actions recorded inside an iframe use `page.frameLocator(...)` and are silently omitted. The Agent runner likewise resolves every element from the main page, so an otherwise valid case cannot act inside a Frame.

The current keyword set also omits several common Playwright interactions and assertions. A case can therefore be partially recorded or manually impossible to express. The product must preserve the user's recorded intent, make Frame navigation explicit in the case, and ensure a keyword means the same thing in the platform and the Agent.

## Solution

Introduce an explicit **Frame 上下文** into a test case. The recorder will detect transitions between the main document and nested `frameLocator` paths, then insert Frame context keywords before the recorded actions. Authors can also insert and edit the same context keywords manually.

The first keyword expansion will cover double-click, checked-state changes, file upload, drag and drop, focus, scrolling an element into view, waiting for a URL, and assertions for checked, enabled, and input-value states. The platform editor, desktop workbench, script generator, Agent runner, APIs, AI case generation, and case-file import/export will recognize the same set.

Unsupported `codegen` statements become **待转换步骤**. They remain visible with their original Playwright source and prevent the draft from being treated as a fully executable or uploadable recorded case. No recording action is silently discarded.

## User Stories

1. As an Agent user, I want an action inside a single iframe to be recorded with its Frame context, so that replay targets the same document.
2. As an Agent user, I want the recorder to detect entering a nested iframe, so that I do not need to reconstruct the nesting manually.
3. As an Agent user, I want the recorder to detect returning from a Frame to its parent or the main document, so that later actions do not stay scoped incorrectly.
4. As a case author, I want to add an “enter Frame” step by hand, so that I can build a case without recording it.
5. As a case author, I want to return to the parent Frame or main document explicitly, so that I can express cross-document workflows clearly.
6. As a case author, I want Frame context steps displayed in the same ordering surface as other steps, so that I can inspect and reorder a case safely.
7. As a case author, I want a clear error when a Frame locator cannot resolve during execution, so that I know which context transition failed.
8. As a case author, I want steps after a Frame transition to use the active Frame automatically, so that I do not repeat a Frame selector on every step.
9. As a case author, I want the generated Playwright script to show the same Frame structure as the visual case, so that exported code remains understandable.
10. As an Agent user, I want a double-click operation preserved from recording, so that rich controls can be replayed.
11. As an Agent user, I want checked and unchecked states represented explicitly, so that checkbox intent is not reduced to a generic click.
12. As a case author, I want to upload one or more files through a keyword, so that file-input workflows are automatable.
13. As a case author, I want a drag-and-drop keyword, so that sortable and drop-zone interactions are supported.
14. As a case author, I want an element-focus keyword, so that keyboard-first workflows can be expressed deterministically.
15. As a case author, I want to scroll an element into view, so that lazy or off-screen controls can be reached predictably.
16. As a case author, I want to wait for a URL condition, so that navigation completion has an explicit assertion point.
17. As a case author, I want checked, enabled, and input-value assertions, so that common form state is verified without custom code.
18. As an Agent user, I want unsupported recorded operations shown with their original Playwright statement, so that I can correct the case rather than lose work.
19. As an Agent user, I want an incomplete recorded draft blocked from execution and upload, so that the platform never stores a falsely complete test case.
20. As a platform user, I want a recorded case to have the same behavior after it is uploaded, downloaded, or reopened in the desktop workbench, so that offline editing does not corrupt Frame semantics.
21. As an AI-assisted case author, I want the AI to use only recognized keywords, so that generated cases remain executable by the Agent.
22. As a test operator, I want per-step logs and failures to retain the original step index and active context, so that Frame failures can be diagnosed from the execution report.

## Implementation Decisions

- A test case retains its existing ordered flat step model. Frame navigation is represented by explicit context keywords instead of adding a Frame selector field to every existing step.
- The context keyword family is: enter Frame, return to parent Frame, and return to main document. The Agent maintains a Frame 栈 while interpreting a case. Entering uses the active document scope; returning removes one scope or resets to the main document.
- Nested iframe recording is supported. The recorder normalizes codegen Frame locator paths, compares the next path with the active Frame 栈, and emits the minimum required exit and entry steps before the action.
- All target-based interaction, wait, condition, and assertion keywords resolve their locator from the active Frame 上下文. Page-only actions, including navigation, URL waiting, screenshots, and keyboard actions without an element target, retain page semantics.
- The first non-Frame capability increment includes double-click, check, uncheck, set input files, drag-and-drop, focus, scroll into view, wait for URL, expect checked, expect enabled, and expect input value. The operation names and input labels must be identical on the platform and desktop workbench.
- The keyword definition is a cross-surface contract. Its identifier, target/value requirements, display metadata, generated script behavior, runtime behavior, schema validation, and AI allow-list change together.
- Recorded codegen syntax outside the supported mapping is represented as a 待转换步骤 carrying the original statement and a conversion reason. A draft containing one cannot be uploaded or executed until the user removes or converts it.
- Existing recorded and platform-authored cases remain compatible. A missing Frame context means main-document scope.
- Generated scripts must explicitly show context changes and restore the main document before using page-only operations that require it.
- Case files preserve all new steps without changing their envelope version unless a new field is required. The import path validates keyword identifiers and required values before allowing the case to run.

## Testing Decisions

- The primary regression seam is an Agent recording-to-execution pipeline test: a representative Playwright codegen script is parsed into steps and those steps are executed against a fake page with nested Frame locators. The test observes frame transitions and resulting interaction calls, never parser internals or component state.
- Add cases for main document to Frame, Frame to parent, Frame to main document, sibling Frame transitions, and nested Frame transitions. Each verifies the generated step order and the final operation scope.
- Add a failure case for an unavailable Frame locator. It must produce a failed step result with the Frame transition context and must not run subsequent operations.
- Add a failure case for unsupported codegen output. It must produce a visible 待转换步骤 and execution/upload validation must reject the incomplete draft rather than silently omit the operation.
- Extend the existing Agent runner test fixture to model `frameLocator`, Frame-local `locator`, and the first-batch operations. Assert externally visible driver calls and status results.
- Add keyword-contract tests that compare serializable metadata and generated script semantics between the platform and desktop keyword registries. This prevents a platform-only keyword or desktop-only keyword from being released.
- Extend API validation tests for new keyword identifiers, required values, and rejected 待转换步骤. Extend case-file tests to demonstrate import/export round-trips for Frame and new interaction steps.
- Keep existing tests for navigation precedence, optional page keyboard input, control-flow validation, loop variables, and install failures unchanged; the new execution context must not alter those behaviors.

## Out of Scope

- Multiple tabs, popup windows, browser contexts, and cross-origin popup coordination.
- Downloads, dialog handling, network interception, request mocking, authentication storage-state management, and arbitrary JavaScript evaluation.
- Executing arbitrary raw Playwright statements preserved from a recording.
- Automatic healing of a changed Frame locator at replay time.
- A global redesign of all test-case loading states; the `/cases` loading-state issue is a separate scope.

## Further Notes

- “Frame” in this feature means an iframe document scope, not a browser page, tab, window, or Agent execution node.
- The existing desktop recorder is based on Playwright codegen, so conversion support must follow emitted codegen forms rather than infer DOM behavior from screenshots.
- The implementation must keep the platform editor and desktop workbench in a working state together. Publishing one side without the other would create non-executable cases.
