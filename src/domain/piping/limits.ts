/**
 * Spec §8 import limits. A leaf module with no imports on purpose: the API's
 * shared helpers read MAX_IMPORT_ROWS, and they are in every field page's
 * chunk (the field header reads the Piping settings), so anything this module
 * imported -- the import parsers, CAM, weeks -- would ship there too.
 */
export const MAX_IMPORT_ROWS = 20_000
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
