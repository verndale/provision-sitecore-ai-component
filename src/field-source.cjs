"use strict";

/** Reviewed SitecoreAI authoring defaults for field types with a house Source. */
const DEFAULT_FIELD_SOURCES = Object.freeze({
  "Rich Text": "query:$xaRichTextProfile",
  Image: "query:$siteMedia",
  "General Link": "query:$linkableHomes",
});

function effectiveFieldSource(field) {
  return field.source || DEFAULT_FIELD_SOURCES[field.sitecoreType] || null;
}

module.exports = { DEFAULT_FIELD_SOURCES, effectiveFieldSource };
