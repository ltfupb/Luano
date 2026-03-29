import { useState, useEffect, useCallback } from "react"
import { useProjectStore } from "../stores/projectStore"
import { useT } from "../i18n/useT"

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType = "string" | "number" | "boolean" | "table" | "array"

interface SchemaField {
  name: string
  type: FieldType
  default: unknown
  description?: string
  children?: SchemaField[]
}

interface DataStoreSchema {
  name: string
  version: number
  description?: string
  fields: SchemaField[]
}

interface SchemaFile {
  schemas: DataStoreSchema[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "table", "array"]

const TYPE_COLORS: Record<FieldType, string> = {
  string: "#22c55e",
  number: "#3b82f6",
  boolean: "#f59e0b",
  table: "#a855f7",
  array: "#ec4899"
}

const DEFAULT_VALUES: Record<FieldType, unknown> = {
  string: "",
  number: 0,
  boolean: false,
  table: {},
  array: []
}

// ── Field Editor ──────────────────────────────────────────────────────────────

function FieldRow({
  field,
  depth,
  onUpdate,
  onRemove,
  onAddChild
}: {
  field: SchemaField
  depth: number
  onUpdate: (updated: SchemaField) => void
  onRemove: () => void
  onAddChild: () => void
}): JSX.Element {
  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div
        className="flex items-center gap-1.5 py-1 px-1.5 rounded group hover:bg-white/5"
      >
        {/* Type badge */}
        <span
          className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: TYPE_COLORS[field.type] + "20", color: TYPE_COLORS[field.type] }}
        >
          {field.type}
        </span>

        {/* Name */}
        <input
          className="text-[11px] bg-transparent border-none outline-none font-mono flex-1 min-w-0"
          style={{ color: "var(--text-primary)" }}
          value={field.name}
          onChange={(e) => onUpdate({ ...field, name: e.target.value })}
          placeholder="fieldName"
        />

        {/* Type selector */}
        <select
          className="text-[10px] bg-transparent border-none outline-none cursor-pointer"
          style={{ color: "var(--text-muted)" }}
          value={field.type}
          onChange={(e) => {
            const newType = e.target.value as FieldType
            onUpdate({
              ...field,
              type: newType,
              default: DEFAULT_VALUES[newType],
              children: newType === "table" ? (field.children ?? []) : undefined
            })
          }}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Default value */}
        {field.type !== "table" && field.type !== "array" && (
          <input
            className="text-[10px] bg-transparent outline-none w-16 font-mono text-right"
            style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" }}
            value={String(field.default ?? "")}
            onChange={(e) => {
              let val: unknown = e.target.value
              if (field.type === "number") val = Number(val) || 0
              if (field.type === "boolean") val = e.target.value === "true"
              onUpdate({ ...field, default: val })
            }}
            placeholder="default"
          />
        )}

        {/* Add child (table only) */}
        {field.type === "table" && (
          <button
            onClick={onAddChild}
            className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--accent)" }}
            title="Add child field"
          >
            +
          </button>
        )}

        {/* Remove */}
        <button
          onClick={onRemove}
          className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "#f87171" }}
          title="Remove field"
        >
          x
        </button>
      </div>

      {/* Children */}
      {field.type === "table" && field.children?.map((child, ci) => (
        <FieldRow
          key={ci}
          field={child}
          depth={depth + 1}
          onUpdate={(updated) => {
            const newChildren = [...(field.children ?? [])]
            newChildren[ci] = updated
            onUpdate({ ...field, children: newChildren })
          }}
          onRemove={() => {
            const newChildren = (field.children ?? []).filter((_, idx) => idx !== ci)
            onUpdate({ ...field, children: newChildren })
          }}
          onAddChild={() => {
            const newChildren = [...(field.children ?? []), { name: "", type: "string" as FieldType, default: "" }]
            onUpdate({ ...field, children: newChildren })
          }}
        />
      ))}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function DataStorePanel(): JSX.Element {
  const { projectPath, openFile } = useProjectStore()
  const [schemas, setSchemas] = useState<DataStoreSchema[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<DataStoreSchema | null>(null)
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const t = useT()

  const loadSchemas = useCallback(async () => {
    if (!projectPath) return
    const result = await window.api.datastoreLoadSchemas(projectPath) as SchemaFile
    setSchemas(result.schemas)
    if (result.schemas.length > 0 && !selected) {
      setSelected(result.schemas[0].name)
      setEditing(structuredClone(result.schemas[0]))
    }
  }, [projectPath, selected])

  useEffect(() => { loadSchemas() }, [loadSchemas])

  const handleSelectSchema = (name: string) => {
    const schema = schemas.find((s) => s.name === name)
    if (schema) {
      setSelected(name)
      setEditing(structuredClone(schema))
      setGeneratedCode(null)
    }
  }

  const handleNewSchema = () => {
    const newSchema: DataStoreSchema = {
      name: "PlayerData",
      version: 1,
      description: "",
      fields: [
        { name: "coins", type: "number", default: 0 },
        { name: "level", type: "number", default: 1 }
      ]
    }
    setEditing(newSchema)
    setSelected(null)
    setGeneratedCode(null)
  }

  const handleSave = async () => {
    if (!projectPath || !editing) return
    if (!editing.name.trim()) return
    await window.api.datastoreSaveSchema(projectPath, editing)
    await loadSchemas()
    setSelected(editing.name)
  }

  const handleDelete = async () => {
    if (!projectPath || !selected) return
    await window.api.datastoreDeleteSchema(projectPath, selected)
    setSelected(null)
    setEditing(null)
    await loadSchemas()
  }

  const handleGenerate = async () => {
    if (!editing) return
    const code = await window.api.datastoreGenerateCode(editing)
    setGeneratedCode(code)
  }

  const handleExport = async () => {
    if (!projectPath || !editing || !generatedCode) return
    const filePath = `${projectPath}/src/server/${editing.name}.luau`
    await window.api.writeFile(filePath, generatedCode)
    const content = await window.api.readFile(filePath)
    openFile(filePath, content ?? generatedCode)
    setGeneratedCode(null)
  }

  const addField = () => {
    if (!editing) return
    setEditing({
      ...editing,
      fields: [...editing.fields, { name: "", type: "string", default: "" }]
    })
  }

  const updateField = (index: number, updated: SchemaField) => {
    if (!editing) return
    const newFields = [...editing.fields]
    newFields[index] = updated
    setEditing({ ...editing, fields: newFields })
  }

  const removeField = (index: number) => {
    if (!editing) return
    setEditing({ ...editing, fields: editing.fields.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-panel)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t("datastore")}</span>
        <button
          onClick={handleNewSchema}
          className="ml-auto px-2 py-0.5 text-[10px] rounded transition-colors"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {t("newSchema")}
        </button>
      </div>

      {/* Schema list */}
      {schemas.length > 0 && (
        <div className="flex gap-1 px-2 py-1.5 flex-shrink-0 overflow-x-auto" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          {schemas.map((s) => (
            <button
              key={s.name}
              onClick={() => handleSelectSchema(s.name)}
              className="px-2 py-0.5 text-[10px] rounded-md flex-shrink-0 transition-colors"
              style={{
                background: selected === s.name ? "var(--accent)" : "var(--bg-elevated)",
                color: selected === s.name ? "white" : "var(--text-secondary)",
                border: `1px solid ${selected === s.name ? "var(--accent)" : "var(--border)"}`
              }}
            >
              {s.name} <span style={{ opacity: 0.6 }}>v{s.version}</span>
            </button>
          ))}
        </div>
      )}

      {/* Editor */}
      {editing ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Schema meta */}
          <div className="flex gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <input
              className="text-[11px] font-semibold bg-transparent outline-none flex-1 font-mono"
              style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border-subtle)" }}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="SchemaName"
            />
            <input
              className="text-[10px] bg-transparent outline-none w-10 text-center font-mono"
              style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-subtle)" }}
              type="number"
              min={1}
              value={editing.version}
              onChange={(e) => setEditing({ ...editing, version: Number(e.target.value) || 1 })}
            />
          </div>

          {/* Fields */}
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {editing.fields.map((field, i) => (
              <FieldRow
                key={i}
                field={field}
                depth={0}
                onUpdate={(updated) => updateField(i, updated)}
                onRemove={() => removeField(i)}
                onAddChild={() => {
                  const newField = { ...field, children: [...(field.children ?? []), { name: "", type: "string" as FieldType, default: "" }] }
                  updateField(i, newField)
                }}
              />
            ))}

            <button
              onClick={addField}
              className="w-full py-1.5 mt-1 text-[10px] rounded-lg border-dashed transition-colors hover:border-solid"
              style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
            >
              {t("addField")}
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 px-3 py-2 flex-shrink-0" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <button
              onClick={handleSave}
              className="flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-colors"
              style={{ background: "var(--accent)", color: "white" }}
            >
              {t("save")}
            </button>
            <button
              onClick={handleGenerate}
              className="flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-colors"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            >
              {t("generate")}
            </button>
            {selected && (
              <button
                onClick={handleDelete}
                className="px-2 py-1.5 text-[10px] rounded-lg transition-colors"
                style={{ color: "#f87171", border: "1px solid #7f1d1d" }}
              >
                {t("deleteSchema")}
              </button>
            )}
          </div>

          {/* Generated code preview */}
          {generatedCode && (
            <div className="px-3 pb-2 flex-shrink-0">
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center justify-between px-2 py-1" style={{ background: "var(--bg-elevated)" }}>
                  <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>{t("generated")}</span>
                  <button
                    onClick={handleExport}
                    className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
                    style={{ background: "var(--accent)", color: "white" }}
                  >
                    {t("exportTo")}
                  </button>
                </div>
                <pre
                  className="text-[10px] p-2 overflow-auto max-h-40 font-mono"
                  style={{ background: "var(--bg-base)", color: "var(--text-secondary)" }}
                >
                  {generatedCode.slice(0, 800)}
                  {generatedCode.length > 800 && "\n..."}
                </pre>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {t("selectOrCreate")}
          </p>
        </div>
      )}
    </div>
  )
}
