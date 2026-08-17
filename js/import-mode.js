export function createImportPlan(importedRecords = [], existingRecords = [], overwriteExisting = false) {
  const existingIds = new Set(existingRecords.map((record) => record?.id).filter(Boolean));
  const matchingRecords = importedRecords.filter((record) => existingIds.has(record?.id));
  const newRecords = importedRecords.filter((record) => !existingIds.has(record?.id));

  return {
    recordsToImport: overwriteExisting ? [...importedRecords] : newRecords,
    matchingCount: matchingRecords.length,
    newCount: newRecords.length,
    skippedCount: overwriteExisting ? 0 : matchingRecords.length
  };
}
