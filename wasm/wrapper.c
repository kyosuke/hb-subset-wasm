/*
 * Minimal C wrapper around HarfBuzz subset API for WebAssembly.
 * Exposes only what the JS API layer needs.
 */

#include <stdlib.h>
#include <string.h>
#include "hb.h"
#include "hb-subset.h"
#include "hb-ot.h"

/* --- helpers for JS interop --- */

/* Make a tag from 4 bytes */
static hb_tag_t make_tag(const char *s) {
    return HB_TAG(s[0], s[1], s[2], s[3]);
}

/* --- Exported functions --- */

/*
 * Create an hb_face_t from raw font data.
 * Returns NULL on failure.
 * The caller must keep font_data alive until hb_face_destroy().
 */
__attribute__((used))
hb_face_t* hb_wrapper_face_create(const char *font_data, unsigned int font_size) {
    hb_blob_t *blob = hb_blob_create(font_data, font_size,
                                      HB_MEMORY_MODE_READONLY, NULL, NULL);
    if (!blob) return NULL;

    hb_face_t *face = hb_face_create(blob, 0);
    hb_blob_destroy(blob);

    if (!face || !hb_face_get_glyph_count(face)) {
        if (face) hb_face_destroy(face);
        return NULL;
    }
    return face;
}

__attribute__((used))
void hb_wrapper_face_destroy(hb_face_t *face) {
    if (face) hb_face_destroy(face);
}

/*
 * Perform a subset operation.
 *
 * Parameters:
 *   font_data / font_size: raw font bytes
 *   unicodes / unicodes_len: array of unicode codepoints to keep
 *   glyph_ids / glyph_ids_len: array of glyph IDs to keep
 *   flags: hb_subset_flags_t bitmask
 *   passthrough_tags / passthrough_tags_len: 4-byte tag strings for no-subset tables
 *   drop_tags / drop_tags_len: 4-byte tag strings for tables to drop
 *   axis_tags / axis_values / axis_count: variation axis pinning (fixed values)
 *   axis_range_tags / axis_range_mins / axis_range_maxs / axis_range_defs / axis_range_count: axis ranges
 *   out_data: pointer to output data pointer (caller must free with hb_wrapper_free)
 *   out_size: pointer to output size
 *
 * Returns 0 on success, non-zero error code on failure.
 */
__attribute__((used))
int hb_wrapper_subset(
    const char *font_data, unsigned int font_size,
    const unsigned int *unicodes, unsigned int unicodes_len,
    const unsigned int *glyph_ids, unsigned int glyph_ids_len,
    unsigned int flags,
    const char *passthrough_tags, unsigned int passthrough_tags_len,
    const char *drop_tags, unsigned int drop_tags_len,
    const char *axis_tags, const float *axis_values, unsigned int axis_count,
    const char *axis_range_tags,
    const float *axis_range_mins, const float *axis_range_maxs,
    const float *axis_range_defs,
    unsigned int axis_range_count,
    char **out_data, unsigned int *out_size
) {
    *out_data = NULL;
    *out_size = 0;

    /* Create blob and face */
    hb_blob_t *blob = hb_blob_create(font_data, font_size,
                                      HB_MEMORY_MODE_READONLY, NULL, NULL);
    if (!blob) return 1;

    hb_face_t *face = hb_face_create(blob, 0);
    hb_blob_destroy(blob);
    if (!face) return 2;

    if (!hb_face_get_glyph_count(face)) {
        hb_face_destroy(face);
        return 3;
    }

    /* Create subset input */
    hb_subset_input_t *input = hb_subset_input_create_or_fail();
    if (!input) {
        hb_face_destroy(face);
        return 4;
    }

    /* Set flags */
    hb_subset_input_set_flags(input, flags);

    /* Add unicode codepoints */
    if (unicodes && unicodes_len > 0) {
        hb_set_t *unicode_set = hb_subset_input_unicode_set(input);
        for (unsigned int i = 0; i < unicodes_len; i++) {
            hb_set_add(unicode_set, unicodes[i]);
        }
    }

    /* Add glyph IDs */
    if (glyph_ids && glyph_ids_len > 0) {
        hb_set_t *glyph_set = hb_subset_input_glyph_set(input);
        for (unsigned int i = 0; i < glyph_ids_len; i++) {
            hb_set_add(glyph_set, glyph_ids[i]);
        }
    }

    /* Passthrough tables (no-subset) */
    if (passthrough_tags && passthrough_tags_len > 0) {
        hb_set_t *no_subset = hb_subset_input_set(input, HB_SUBSET_SETS_NO_SUBSET_TABLE_TAG);
        for (unsigned int i = 0; i < passthrough_tags_len; i++) {
            hb_set_add(no_subset, make_tag(passthrough_tags + i * 4));
        }
    }

    /* Drop tables */
    if (drop_tags && drop_tags_len > 0) {
        hb_set_t *drop = hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
        for (unsigned int i = 0; i < drop_tags_len; i++) {
            hb_set_add(drop, make_tag(drop_tags + i * 4));
        }
    }

    /* Pin variation axes to fixed values */
    if (axis_tags && axis_values && axis_count > 0) {
        for (unsigned int i = 0; i < axis_count; i++) {
            hb_tag_t tag = make_tag(axis_tags + i * 4);
            hb_subset_input_pin_axis_location(input, face, tag, axis_values[i]);
        }
    }

    /* Set variation axis ranges */
    if (axis_range_tags && axis_range_mins && axis_range_maxs && axis_range_defs && axis_range_count > 0) {
        for (unsigned int i = 0; i < axis_range_count; i++) {
            hb_tag_t tag = make_tag(axis_range_tags + i * 4);
            hb_subset_input_set_axis_range(input, face, tag,
                                           axis_range_mins[i],
                                           axis_range_maxs[i],
                                           axis_range_defs[i]);
        }
    }

    /* Execute subset */
    hb_face_t *subset_face = hb_subset_or_fail(face, input);
    hb_subset_input_destroy(input);
    hb_face_destroy(face);

    if (!subset_face) return 5;

    /* Serialize result */
    hb_blob_t *result_blob = hb_face_reference_blob(subset_face);
    hb_face_destroy(subset_face);

    if (!result_blob) return 6;

    unsigned int length;
    const char *data = hb_blob_get_data(result_blob, &length);
    if (!data || length == 0) {
        hb_blob_destroy(result_blob);
        return 7;
    }

    /* Copy to output buffer that JS can read */
    char *output = (char *)malloc(length);
    if (!output) {
        hb_blob_destroy(result_blob);
        return 8;
    }
    memcpy(output, data, length);

    *out_data = output;
    *out_size = length;

    hb_blob_destroy(result_blob);
    return 0;
}

/* Free output buffer allocated by hb_wrapper_subset */
__attribute__((used))
void hb_wrapper_free(void *ptr) {
    free(ptr);
}

/* Get number of glyphs in a font */
__attribute__((used))
unsigned int hb_wrapper_face_get_glyph_count(const char *font_data, unsigned int font_size) {
    hb_blob_t *blob = hb_blob_create(font_data, font_size,
                                      HB_MEMORY_MODE_READONLY, NULL, NULL);
    if (!blob) return 0;
    hb_face_t *face = hb_face_create(blob, 0);
    hb_blob_destroy(blob);
    if (!face) return 0;
    unsigned int count = hb_face_get_glyph_count(face);
    hb_face_destroy(face);
    return count;
}
