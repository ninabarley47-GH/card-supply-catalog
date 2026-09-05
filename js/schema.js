export const CATALOG_SCHEMA_VERSION = 4;
export const BACKUP_SCHEMA_VERSION = 3;

export function addCatalogSchemaVersion(record) {
  return {
    ...record,
    schemaVersion: CATALOG_SCHEMA_VERSION
  };
}

export function getCatalogSchemaVersion(record) {
  if (Number.isInteger(record?.catalogSchemaVersion)) {
    return record.catalogSchemaVersion;
  }

  if (record?.app === "card-supply-catalog" && [2, BACKUP_SCHEMA_VERSION].includes(record.schemaVersion)) {
    return CATALOG_SCHEMA_VERSION;
  }

  return 0;
}
