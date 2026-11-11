import { readTextIfExists, removeFile } from '../../edges/files.js';
import { messageOf } from '../../utils/error-message.js';
import { withLockSync } from './lock.js';
import type { InspectDocumentFn, ParseDocumentTextFn, RemoveDocumentFn } from './models.js';
import { invalidVersionMessage, unwrapVersion } from './versions.js';

// Raw operations on a document file, for the document itself and for `art state`, which has no
// fallback and no version (both live in app code). Not part of the public API of the kit.

/** The JSON a document's text holds, or why it is not JSON. */
export const parseDocumentText: ParseDocumentTextFn = (file, text) => {
    try {
        return { parsed: JSON.parse(text) };
    } catch (error) {
        return { error: `${file} is not valid JSON: ${messageOf(error)}` };
    }
};

/**
 * What a file holds, read as it is: no fallback, no upgrades. A file that is missing, unreadable
 * or not JSON is reported in `error`, never thrown, so a caller can list it and offer to reset it.
 */
export const inspectDocument: InspectDocumentFn = (file) => {
    let text: string | undefined;

    try {
        text = readTextIfExists(file);
    } catch (error) {
        return { error: `${file} cannot be read: ${messageOf(error)}` };
    }

    if (text === undefined) {
        return { error: `${file} does not exist.` };
    }

    const result = parseDocumentText(file, text);

    if ('error' in result) {
        return result;
    }

    const { version, value } = unwrapVersion(result.parsed);
    const invalid = invalidVersionMessage(file, version);

    return invalid ? { error: invalid } : { version, data: value };
};

/**
 * Deletes a document under its lock, without reading it: a corrupt document, or one newer than
 * the code, can always be removed. Taking the lock means it never goes in the middle of an update.
 */
export const removeDocument: RemoveDocumentFn = (file, edges) => {
    withLockSync(file, () => removeFile(file), edges);
};
