const processTagFilter = (tags) => {
  if (!tags) return {};

  // Parse comma-separated tags
  const tagArray = tags.split(",");

  if (tagArray.length === 0) return {};

  const orConditions = [];

  // Special case for POS
  if (tagArray.includes("POS")) {
    orConditions.push({ U_EPOSNo: { $ne: null } }, { CardCode: "C9999" });
  }

  // Handle the standard tags
  const standardTags = tagArray.filter((tag) => tag !== "POS");
  if (standardTags.length > 0) {
    orConditions.push({ tag: { $in: standardTags } });
  }

  // Return the filter if there are conditions
  if (orConditions.length > 0) {
    return { $or: orConditions };
  }

  return {};
};

module.exports = {
  processTagFilter,
};
