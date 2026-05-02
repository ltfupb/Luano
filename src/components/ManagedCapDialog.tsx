import { useEffect, useState } from "react"
import { useSettingsStore } from "../stores/settingsStore"
import { useT } from "../i18n/useT"
import { ConfirmDialog } from "./ConfirmDialog"
import { toast } from "./Toast"
import { track, Events } from "../analytics"

type ByokProvider = "anthropic" | "openai" | "gemini" | "local"

/**
 * Renders a modal when the main process emits "managed:cap-exceeded" — the
 * Managed Worker has reported the monthly token cap is gone. Offers a single
 * action: switch the active provider back to the user's last BYOK choice (or
 * the first BYOK provider that has credentials, if the saved one is empty).
 *
 * Mounted once at the App level so any chat / agent flow can trigger it.
 */
export function ManagedCapDialog(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const t = useT()
  const apiKey = useSettingsStore((s) => s.apiKey)
  const openaiKey = useSettingsStore((s) => s.openaiKey)
  const geminiKey = useSettingsStore((s) => s.geminiKey)
  const localEndpoint = useSettingsStore((s) => s.localEndpoint)
  const localModel = useSettingsStore((s) => s.localModel)
  const prevByokProvider = useSettingsStore((s) => s.prevByokProvider)
  const setProvider = useSettingsStore((s) => s.setProvider)
  const setModel = useSettingsStore((s) => s.setModel)

  useEffect(() => {
    const off = window.api.onManagedCapExceeded(() => {
      setOpen(true)
      track(Events.MANAGED_CAP_HIT, {})
    })
    return off
  }, [])

  if (!open) return null

  const hasKey = (p: ByokProvider): boolean => {
    if (p === "anthropic") return Boolean(apiKey)
    if (p === "openai") return Boolean(openaiKey)
    if (p === "gemini") return Boolean(geminiKey)
    if (p === "local") return Boolean(localEndpoint && localModel)
    return false
  }

  const resolveTarget = (): ByokProvider | null => {
    const saved = prevByokProvider as ByokProvider
    if (hasKey(saved)) return saved
    const order: ByokProvider[] = ["anthropic", "openai", "gemini", "local"]
    return order.find(hasKey) ?? null
  }

  const onSwitch = async () => {
    const target = resolveTarget()
    if (!target) {
      track(Events.MANAGED_BYOK_FALLBACK, { trigger: "cap_hit", success: false })
      toast(t("managedCapNoKey"), "error")
      setOpen(false)
      return
    }
    const result = await window.api.aiSetProvider(target)
    if (!result.success) {
      track(Events.MANAGED_BYOK_FALLBACK, { trigger: "cap_hit", success: false })
      toast(`Failed to switch: ${result.error ?? "unknown error"}`, "error")
      setOpen(false)
      return
    }
    const pm = await window.api.aiGetProviderModel()
    setProvider(pm.provider)
    setModel(pm.model)
    track(Events.MANAGED_BYOK_FALLBACK, { trigger: "cap_hit", success: true })
    setOpen(false)
  }

  return (
    <ConfirmDialog
      title={t("managedCapTitle")}
      body={t("managedCapBody")}
      confirmLabel={t("managedCapSwitchByok")}
      cancelLabel={t("managedCapClose")}
      onConfirm={onSwitch}
      onCancel={() => setOpen(false)}
      width={420}
    />
  )
}
