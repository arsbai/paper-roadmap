# Paper Roadmap

English · [中文](README.md)

A Codex skill for turning scientific papers, research plans, and methods into editable research frameworks, technical roadmaps, and method diagrams. **English SVG and PNG preview are the defaults.**

## What it does

- Organizes evidence-backed inputs, transformations, outputs, branches, comparisons, and validation relationships.
- Places useful paper figures inside the relevant stages: input samples, intermediate states, explanation curves, maps, or validation pairs.
- Prefers method schematics, comparison structures, and action pictograms with concise labels and essential conditions; there is no fixed image-to-text ratio.
- Reduces routine implementation detail in study overviews while retaining key filtering, selection, grouping, scale choices, and innovations.
- Uses at most three visual hierarchy levels and three font sizes. Layout, dimensions, colors, and icon choices adapt to the research.
- Supports localized edits against an approved baseline, persistent deletion records, and explicitly requested Chinese or bilingual outputs.

This is a diagramming workflow. It does not reproduce the paper's analysis or fabricate research results.

## Install

Send this in a Codex environment that supports skills:

```text
Use $skill-installer to install paper-roadmap from:
https://github.com/arsbai/paper-roadmap/tree/main/skills/paper-roadmap
```

For manual installation, copy the entire `skills/paper-roadmap` directory to a skill directory recognized by your host. The [official skill documentation](https://developers.openai.com/codex/skills/) lists `~/.agents/skills/` for personal skills and `.agents/skills/` for repository skills. Some installers target `$CODEX_HOME/skills`, defaulting to `~/.codex/skills`; use the location reported by your installer and avoid duplicate installations.

The result should contain `<skill-directory>/paper-roadmap/SKILL.md` and all supporting folders and licenses. Copying only `SKILL.md` is insufficient. Start a new session or restart Codex if the skill does not appear.

## Use

Attach a readable paper PDF. Optionally specify the intended use, display size, research focus, and visual references:

```text
Use $paper-roadmap to create a whole-study framework from the attached paper.
Show the key inputs, transformations, and outputs. Integrate useful paper figures
into the relevant stages. Prefer method schematics and action pictograms with
concise labels, retaining essential conditions. Label self-drawn method
illustrations as Schematic. Choose a suitable layout and palette, use at most
three hierarchy levels, and deliver editable SVG and PNG.
```

Without an explicit language request, the skill creates **English only**, even when the conversation or source material is Chinese. Request “Chinese only” or “matching English and Chinese versions” to override this. Content-locked revisions preserve the existing diagram's language unless a language change is authorized.

For a focused method diagram:

```text
Use $paper-roadmap to expand only Methods 2.3. Emphasize the input, key
transformation, and validation comparisons. Create an English diagram suitable
for a full-width figure in a two-column paper.
```

## Revise an approved diagram

Keep the SVG, content model, and asset directory. Continue in the same conversation, or supply those files in a new one:

```text
Use the approved version as the baseline. Enlarge only the central module's text
and icons. Keep all other wording, numbers, research relationships, and images
unchanged, with at most three font sizes.
```

For a more visual revision:

```text
Replace the method section's explanatory lists with schematics and concise labels.
If matching or DID is in the source, use paired points or group-by-time changes.
Illustrate activity categories with suitable action pictograms. Keep the comparison
conditions, key thresholds, and research relationships; move routine parameters
to the companion notes. Mark self-drawn method illustrations as Schematic and
preserve the meaning of real photographs and result data.
```

Pictograms show representative actions rather than complete category definitions. Schematic point counts, slopes, and spacing do not encode the paper's empirical results.

For deletion persistence, first request a specific deletion and record it, then request a layout edit that keeps deleted content absent.

## Deliverables

| File | Purpose |
|---|---|
| `paper-roadmap-en.svg` | Editable text, connectors, and vector icons; paper photographs may be embedded raster images |
| `paper-roadmap-en.png` | Rendered preview for whole-view and detail inspection |
| `diagram-model.json` | Task-sized record of nodes, relationships, evidence, assets, open questions, and revisions |
| Asset/source records | Paper figure locations, crops, icon origins, and licenses |
| Check records | Separate automated checks, source review, visual inspection, and outstanding limitations |

Names may vary by task. Other languages are delivered when requested; PDF or PPTX can be requested separately. Browser rendering does not establish compatibility with every editing application, and font availability can affect display.

## Runtime and optional check command

Use a Codex environment that can read the input, write files, and inspect images. Finding new icons requires network access. The skill does not depend on a particular drawing library or ImageGen.

The included renderer requires **Node.js, an installed Playwright package, and a working Chromium browser**. Prefer host-provided runtimes when available; otherwise see [Playwright Library](https://playwright.dev/docs/library). The script does not install packages or download browsers.

Run from the repository root on one line, quoting paths that contain spaces:

```text
node skills/paper-roadmap/scripts/render_check.mjs drawing.svg --png preview.png --report qa.json --modules /absolute/path/to/node_modules --browser /absolute/path/to/chromium
```

Omit `--modules` if normal package resolution finds Playwright. Omit `--browser` if Playwright can locate its browser. Use `--help` for options. For a content-locked revision, add `--baseline approved.svg --lock-text`. Text comparison ignores Unicode whitespace, so it cannot prove unchanged word spacing or research meaning.

Automated checks cover font sizes, bounds, and some text issues. They do not assess scientific correctness, image integration, or readability at the intended size. Inspect every delivered language version. If rendering cannot be completed, report that visual verification is incomplete.

## Validation scope

Two urban spatial/transport research papers were used in local diagramming trials. These informed revisions addressing detached figure panels, excessive small print, and omitted selection steps during compression. The revised second-paper diagram also received an English version, automated checks, source review, and whole-view/detail inspection.

A further local revision used a street-view research plan to replace text-heavy matching and change-analysis lists with method schematics and to illustrate activity categories with action pictograms. Research relationships, original photos, and sample counts were checked for preservation, followed by whole-view and detail inspection. This informed the default preference for diagrams that carry the explanation and labels that retain essentials. The instruction update has not received a new independent blind trial.

Cross-disciplinary behavior, editor compatibility, consecutive localized edits, and deletion persistence still require task-specific validation. The default-English configuration was checked but has not received an independent blind invocation test. See [local testing scenarios](skills/paper-roadmap/references/local-testing.md). Paper PDFs and personal trial diagrams are not distributed here.

## Contents and license

The installable skill is in [`skills/paper-roadmap`](skills/paper-roadmap): entry instructions, UI metadata, research/design references, the render helper, and a small set of attributed Tabler icons. Reference design lessons are distributed as text; private screenshots and historical diagrams are excluded.

Original instructions, documentation, and scripts use the [MIT License](LICENSE). Tabler icons retain their upstream MIT notice; see [third-party notices](THIRD_PARTY_NOTICES.md). User-supplied paper images, photographs, and logos retain their own rights. Embedding them in an output does not place them under this project's license.
