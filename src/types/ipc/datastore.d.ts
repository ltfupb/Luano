// Inline type definitions keep this file ambient (non-module) so DatastoreApi
// is globally visible without any import. The canonical shared types live in
// src/types/datastore.ts for use in renderer components.

interface DatastoreSchemaField {
  name: string
  type: "string" | "number" | "boolean" | "table" | "array" | "Instance" | "CFrame" | "Vector3" | "Color3"
  default: unknown
  description?: string
  children?: DatastoreSchemaField[]
}

interface DatastoreSchema {
  name: string
  version: number
  description?: string
  fields: DatastoreSchemaField[]
}

interface DatastoreSchemaFile {
  schemas: DatastoreSchema[]
  createdAt?: string
  updatedAt?: string
}

interface DatastoreProRequired {
  success: false
  error: "pro_required"
  feature: string
  message: string
}

interface DatastoreApi {
  datastoreLoadSchemas: (projectPath: string) => Promise<DatastoreSchemaFile | DatastoreProRequired>
  datastoreSaveSchema: (projectPath: string, schema: DatastoreSchema) => Promise<DatastoreSchemaFile | { error: string } | DatastoreProRequired>
  datastoreDeleteSchema: (projectPath: string, name: string) => Promise<DatastoreSchemaFile | DatastoreProRequired>
  datastoreGenerateCode: (schema: DatastoreSchema) => Promise<string | { error: string } | DatastoreProRequired>
  datastoreGenerateMigration: (oldSchema: DatastoreSchema, newSchema: DatastoreSchema) => Promise<string | { error: string } | DatastoreProRequired>
}
