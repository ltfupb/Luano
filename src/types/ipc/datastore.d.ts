interface DatastoreApi {
  datastoreLoadSchemas: (projectPath: string) => Promise<unknown[]>
  datastoreSaveSchema: (projectPath: string, schema: unknown) => Promise<{ success: boolean }>
  datastoreDeleteSchema: (projectPath: string, name: string) => Promise<{ success: boolean }>
  datastoreGenerateCode: (schema: unknown) => Promise<string>
  datastoreGenerateMigration: (oldSchema: unknown, newSchema: unknown) => Promise<string>
}
