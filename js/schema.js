export const CATALOG_SCHEMA_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;

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

  if (record?.app === "card-supply-catalog" && record.schemaVersion === BACKUP_SCHEMA_VERSION) {
    return CATALOG_SCHEMA_VERSION;
  }

  return 0;
}
