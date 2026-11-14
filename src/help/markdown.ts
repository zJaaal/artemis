import { MARKDOWN_FENCE, MARKDOWN_SECTION_START, NEWLINE } from '../constants.js';
import type { MarkdownSectionFn } from '../models.js';

/** Whether each line is outside a code fence, so a `## ` inside an example never ends a section. */
function outsideFences(lines: readonly string[]): boolean[] {
    let inside = false;

    return lines.map((line) => {
        const startsFence = line.startsWith(MARKDOWN_FENCE);
        const outside = !inside && !startsFence;

        inside = startsFence ? !inside : inside;

        return outside;
    });
}

/**
 * The section of a markdown file that starts at an exact heading line and runs to the next `## `
 * heading (or the end). Pure.
 */
export const markdownSection: MarkdownSectionFn = (markdown, heading) => {
    const lines = markdown.split(NEWLINE);
    const outside = outsideFences(lines);
    const start = lines.findIndex((line, index) => outside[index] === true && line === heading);

    if (start === -1) {
        return undefined;
    }

    const next = lines.findIndex(
        (line, index) =>
            index > start && outside[index] === true && line.startsWith(MARKDOWN_SECTION_START)
    );

    return lines
        .slice(start, next === -1 ? lines.length : next)
        .join(NEWLINE)
        .trimEnd();
};
